// src/lib/erp/orders/deduct.ts
// 판매 차감 실행. 무엇을 할지는 deduct-plan.ts decideDeduction이 정하고, 여기서는 원장(1-B store.ts)에 쓴다. 호출자가 트랜잭션을 연다.
// 순서: 대상 라인 행 잠금(for update — 크론과 「차감 켜기」가 겹쳐도 한 라인을 두 번 처리하지 않는다) → 판정
//   → 관련 SKU 오름차순 lockSku(1-B 인계) → 라인마다 [역전표 → savepoint 안에서 SKU별 postConsume] → 라인 상태.
// 재고 부족(InsufficientStockError · 지연 제약 「음수가 된다」)은 그 라인만 savepoint로 되돌리고 skipped_short — 다음 수집에서 다시 시도한다.
import { InsufficientStockError } from '@/lib/erp/ledger/fifo';
import { lockSku, postConsume, reverse, type Db } from '@/lib/erp/ledger/store';
import type { DeductSummary } from './collect';
import { decideDeduction, type DeductInput, type DeductionState, type PostedItem } from './deduct-plan';
import type { AllocItem } from './resolve';
import { readCutover, readDeductSetting, writeDeductEnabled } from './store';
import { CHANNEL_LABEL, ORDER_CHANNELS, locationOf, type OrderChannel, type StdStatus } from './types';

interface LineRow extends DeductInput {
  id: number;
  externalOrderId: string;
  note: string | null;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function toRow(r: Record<string, unknown>): LineRow {
  return {
    id: Number(r.id),
    channel: r.channel as OrderChannel,
    externalLineId: String(r.external_line_id),
    externalOrderId: String(r.external_order_id ?? ''),
    status: r.status as StdStatus,
    attribution: r.attribution as 'mapped' | 'unattributed',
    alloc: ((r.alloc ?? []) as AllocItem[]).map((a) => ({ skuId: Number(a.skuId), qty: Number(a.qty) })),
    paidAt: iso(r.paid_at),
    state: r.deduction_state as DeductionState,
    note: (r.deduction_note ?? null) as string | null,
    version: Number(r.ledger_version),
    posted: ((r.posted ?? []) as PostedItem[]).map((p) => ({ skuId: Number(p.skuId), qty: Number(p.qty), idemKey: String(p.idemKey) })),
  };
}

const LINE_COLS = `l.id, l.channel, l.external_line_id, o.external_order_id, l.status, l.attribution, l.alloc, l.paid_at,
            l.deduction_state, l.deduction_note, l.ledger_version, l.posted`;

async function loadLines(db: Db, p: { lineIds: number[]; channel: OrderChannel | null; includeOpen: boolean }): Promise<LineRow[]> {
  const { rows } = await db.query(
    `select ${LINE_COLS}
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where (l.id = any($1::bigint[]) or ($3::boolean and l.deduction_state in ('pending', 'skipped_short')))
        and ($2::text is null or l.channel = $2)
      order by l.paid_at nulls last, l.id
      for update of l`,
    [p.lineIds, p.channel, p.includeOpen],
  );
  return rows.map(toRow);
}

export const isShortError = (e: unknown): boolean =>
  e instanceof InsufficientStockError || (e instanceof Error && /음수가 된다/.test(e.message));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param lineIds 이번 수집이 건드린 라인(상태가 바뀌었을 수 있다)
 * @param includeOpen true(기본) = pending·skipped_short 라인도 함께(재고를 고치면 풀린다 · 켜는 순간 소급)
 */
export async function runDeductions(
  db: Db,
  p: { enabled: boolean; cutover: string; lineIds: number[]; channel: OrderChannel | null; at: string; includeOpen?: boolean },
): Promise<DeductSummary> {
  const lines = await loadLines(db, { lineIds: p.lineIds, channel: p.channel, includeOpen: p.includeOpen ?? true });
  const planned = lines.map((l) => ({ l, plan: decideDeduction(l, { enabled: p.enabled, cutover: p.cutover }) }));

  const skus = new Set<number>();
  for (const { l, plan } of planned) {
    if (plan.reverse.length > 0) for (const x of l.posted) skus.add(x.skuId);
    for (const it of plan.post?.items ?? []) skus.add(it.skuId);
  }
  for (const id of [...skus].sort((a, b) => a - b)) await lockSku(db, id);

  const sum: DeductSummary = { posted: 0, reversed: 0, short: 0, pending: 0, unchanged: 0 };
  for (const { l, plan } of planned) {
    const label = `${CHANNEL_LABEL[l.channel]} 주문 ${l.externalOrderId}`;
    let state: DeductionState = plan.state;
    let note: string | null = plan.note;
    let posted: PostedItem[] = l.posted;
    let version = l.version;
    let deducted = false;

    if (plan.reverse.length > 0) {
      // 역전표는 재고를 늘리므로 부족으로 실패하지 않는다 — 먼저 쓴다
      for (const k of plan.reverse) await reverse(db, k, { occurredAt: p.at, note: `${label} 취소·반품` });
      posted = [];
      sum.reversed++;
    }
    if (plan.post) {
      await db.query('savepoint erp_sale');
      try {
        for (const it of plan.post.items) {
          await postConsume(db, {
            skuId: it.skuId, location: locationOf(l.channel), qty: it.qty, kind: 'sale', occurredAt: l.paidAt ?? p.at,
            idemKey: it.idemKey, refType: 'order_line', refId: String(l.id), note: label,
          });
        }
        await db.query('release savepoint erp_sale');
        posted = plan.post.items;
        version = plan.post.version;
        deducted = true;
        sum.posted++;
      } catch (e) {
        await db.query('rollback to savepoint erp_sale');
        await db.query('release savepoint erp_sale');
        if (!isShortError(e)) throw e;
        state = 'skipped_short';
        note = `재고 부족 — ${(e as Error).message}`.slice(0, 200);
        sum.short++;
      }
    } else if (plan.reverse.length === 0) {
      if (state === 'pending') sum.pending++;
      else sum.unchanged++;
    }

    if (state === l.state && note === l.note && version === l.version && same(posted, l.posted)) continue;
    await db.query(
      `update erp.order_lines set deduction_state = $2, deduction_note = $3, posted = $4::jsonb, ledger_version = $5,
              deducted_at = case when $6::boolean then now() else deducted_at end, updated_at = now()
        where id = $1`,
      [l.id, state, note, JSON.stringify(posted), version, deducted],
    );
  }
  return sum;
}

export interface BackfillShortage {
  skuId: number;
  name: string;
  option: string;
  location: 'self' | 'rg';
  need: number;
  have: number;
}

export interface BackfillPreview {
  cutover: string;
  /** 켜면 빼는 라인 수(확인 창이 이 값을 expectedLines로 되돌려 보낸다) */
  lines: number;
  skus: number;
  /** 집에서 빠지는 수량 합 */
  self: number;
  /** RG에서 빠지는 수량 합 */
  rg: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  byChannel: Record<OrderChannel, number>;
  /** 원장 재고보다 많이 빼야 하는 (SKU·위치) — 켜면 그 라인들은 skipped_short로 남는다 */
  shortages: BackfillShortage[];
}

/** 「차감 켜기」 확인 창의 숫자 — 켜면 무엇이 빠지는지(읽기 전용) */
export async function previewBackfill(db: Db): Promise<BackfillPreview> {
  const cutover = await readCutover(db);
  const { rows } = await db.query(
    `select l.id, l.channel, l.external_line_id, o.external_order_id, l.status, l.attribution, l.alloc, l.paid_at,
            l.deduction_state, l.deduction_note, l.ledger_version, l.posted
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where l.deduction_state in ('pending', 'skipped_short')
      order by l.paid_at nulls last, l.id`,
  );
  const byChannel = Object.fromEntries(ORDER_CHANNELS.map((c) => [c, 0])) as Record<OrderChannel, number>;
  const need = new Map<string, { skuId: number; location: 'self' | 'rg'; qty: number }>();
  const paid: string[] = [];
  let lines = 0;
  let self = 0;
  let rg = 0;
  for (const l of rows.map(toRow)) {
    const plan = decideDeduction(l, { enabled: true, cutover });
    if (!plan.post) continue;
    lines++;
    byChannel[l.channel]++;
    if (l.paidAt) paid.push(l.paidAt);
    const location = locationOf(l.channel) === 'rg' ? 'rg' : 'self';
    for (const it of plan.post.items) {
      const k = `${it.skuId}:${location}`;
      const cur = need.get(k) ?? { skuId: it.skuId, location, qty: 0 };
      cur.qty += it.qty;
      need.set(k, cur);
      if (location === 'rg') rg += it.qty;
      else self += it.qty;
    }
  }
  const skuIds = [...new Set([...need.values()].map((n) => n.skuId))].sort((a, b) => a - b);
  const shortages: BackfillShortage[] = [];
  if (skuIds.length > 0) {
    const { rows: have } = await db.query(
      `select sku_id, location, qty from erp.stock_on_hand where sku_id = any($1::bigint[])`, [skuIds],
    );
    const haveOf = new Map(have.map((h) => [`${Number(h.sku_id)}:${h.location}`, Number(h.qty)]));
    const { rows: names } = await db.query(`select id, name, option_label from erp.skus where id = any($1::bigint[])`, [skuIds]);
    const nameOf = new Map(names.map((n) => [Number(n.id), { name: String(n.name), option: String(n.option_label ?? '') }]));
    for (const n of [...need.values()].sort((a, b) => a.skuId - b.skuId || a.location.localeCompare(b.location))) {
      const h = haveOf.get(`${n.skuId}:${n.location}`) ?? 0;
      if (n.qty > h) shortages.push({ skuId: n.skuId, ...(nameOf.get(n.skuId) ?? { name: `SKU ${n.skuId}`, option: '' }), location: n.location, need: n.qty, have: h });
    }
  }
  paid.sort();
  return {
    cutover, lines, skus: skuIds.length, self, rg, firstPaidAt: paid[0] ?? null, lastPaidAt: paid[paid.length - 1] ?? null, byChannel, shortages,
  };
}

export class DeductSwitchError extends Error {
  constructor(public readonly code: 'already' | 'stale', message: string) {
    super(message);
    this.name = 'DeductSwitchError';
  }
}

/**
 * 「차감 켜기」 — 호출자가 연 트랜잭션 안에서. 설정 행을 잡고(for update), 화면이 본 소급 라인 수와 지금 수가 같을 때만 켜고
 * 모든 채널의 대기 라인을 결제 시각 순으로 소급한다(기초 이전 결제는 판정표가 뺀다). 끄는 길은 없다.
 */
export async function enableDeduction(
  db: Db,
  p: { expectedLines: number; by: string; at: string },
): Promise<{ preview: BackfillPreview; summary: DeductSummary }> {
  const setting = await readDeductSetting(db, true);
  if (setting.enabled) throw new DeductSwitchError('already', `이미 켜져 있다(${setting.enabledAt ?? '시각 모름'})`);
  const preview = await previewBackfill(db);
  if (preview.lines !== p.expectedLines) {
    throw new DeductSwitchError('stale', `소급할 라인이 바뀌었다 — 화면 ${p.expectedLines}건, 지금 ${preview.lines}건. 창을 다시 연다`);
  }
  await writeDeductEnabled(db, { by: p.by, at: p.at });
  const summary = await runDeductions(db, { enabled: true, cutover: preview.cutover, lineIds: [], channel: null, at: p.at });
  return { preview, summary };
}
