// src/lib/erp/orders/karrot.ts
// (1-C2b ③) 당근 직거래 수동 판매. 주문 한 건 + 주문 줄 한 줄(채널 'karrot')로 저장하고, 이후는 수집 채널과 같은 흐름 —
// 옛 장부(sale_records 채널 'karrot', 배송비 0) · 차감(스위치를 따른다, 위치 집). 호출자가 트랜잭션을 연다.
// 재고보다 많이 팔 수 없다: 원장 집 재고 − 차감 대기(스위치 꺼짐 동안 쌓인 판매)보다 많으면 거부한다 — 장부 부족을 판매로 덮지 않는다.
// 같은 요청 id(uuid = 줄 키)를 두 번 보내도 한 번만 쓴다.
// KarrotInput.note는 지금 저장하지 않는다 — 줄에 칸이 없고 개인 문구일 수 있어 product_label·옛 장부에 붙이지 않는다. 검사만 하고 버린다.
import { NextResponse } from 'next/server';
import { lockSku, type Db } from '@/lib/erp/ledger/store';
import type { DeductSummary } from './collect';
import { runDeductions } from './deduct';
import { legacyKeyOf } from './keys';
import type { LegacyWarning } from './legacy';
import { syncLegacySales } from './legacy-store';
import { readCutover, readDeductSetting } from './store';
import { addDays, kstDay } from './window';

export class KarrotError extends Error {
  constructor(readonly code: 'invalid' | 'sku' | 'stock' | 'not_found', message: string) {
    super(message);
    this.name = 'KarrotError';
  }
}

export interface KarrotInput {
  skuId: number;
  qty: number;
  /** 받은 돈 합계(원) */
  amount: number;
  /** KST YYYY-MM-DD */
  soldOn: string;
  note?: string;
  requestId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

export function validateKarrot(b: unknown, today: string): KarrotInput {
  const o = (b ?? {}) as Record<string, unknown>;
  const skuId = int(o.skuId);
  const qty = int(o.qty);
  const amount = int(o.amount);
  const soldOn = typeof o.soldOn === 'string' ? o.soldOn : '';
  if (!(skuId > 0)) throw new KarrotError('invalid', 'SKU를 고른다');
  if (!(qty > 0 && qty <= 1000)) throw new KarrotError('invalid', '수량은 1 이상 정수다');
  if (!(amount >= 0 && amount <= 100_000_000)) throw new KarrotError('invalid', '금액은 0 이상 정수(원)다');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || soldOn > today || soldOn < addDays(today, -31)) throw new KarrotError('invalid', `판매일은 오늘부터 31일 전까지다: ${soldOn}`);
  if (typeof o.requestId !== 'string' || !UUID.test(o.requestId)) throw new KarrotError('invalid', '요청 id는 uuid다');
  const note = typeof o.note === 'string' && o.note.trim() !== '' ? o.note.trim().slice(0, 200) : undefined;
  return { skuId, qty, amount, soldOn, ...(note ? { note } : {}), requestId: o.requestId.toLowerCase() };
}

/** 오늘이면 지금, 지난 날이면 그날 KST 정오 — 결제 시각이 기초 시각 판정·옛 장부 판매일을 정한다 */
export function soldAtIso(soldOn: string, now: Date): string {
  return soldOn === kstDay(now.toISOString()) ? now.toISOString() : new Date(`${soldOn}T12:00:00+09:00`).toISOString();
}

const DUP_SQL = `select id from erp.order_lines where channel = 'karrot' and external_line_id = $1`;

const isUniqueViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

export interface KarrotRecordResult {
  lineId: number;
  outcome: 'recorded' | 'duplicate';
  deduct: DeductSummary | null;
  /** 옛 장부(sale_records) 경고 — 비어 있지 않으면 수익 화면에 잡히지 않는다(이 SKU에 옛 원가 상품 연결이 없다 등) */
  legacyWarnings: LegacyWarning[];
}

export async function recordKarrotSale(db: Db, p: KarrotInput, now: Date): Promise<KarrotRecordResult> {
  await lockSku(db, p.skuId);
  const { rows: dup } = await db.query(DUP_SQL, [p.requestId]);
  if (dup.length > 0) return { lineId: Number(dup[0].id), outcome: 'duplicate', deduct: null, legacyWarnings: [] };
  const { rows: sk } = await db.query('select name, option_label, status, legacy_product_cost_ids::text[] as legacy_product_cost_ids from erp.skus where id = $1', [p.skuId]);
  if (sk.length === 0 || sk[0].status !== 'active') throw new KarrotError('sku', `활성 SKU가 아니다: ${p.skuId}`);
  const at = soldAtIso(p.soldOn, now);
  const cutover = await readCutover(db);
  // 기초 시각 이전 판매는 차감 판정표가 pre_cutover로 빼므로(원장에서 빠지지 않는다) 재고 검사도 하지 않는다
  if (Date.parse(at) >= Date.parse(cutover)) {
    const { rows: oh } = await db.query(`select coalesce(sum(qty), 0)::int as qty from erp.stock_on_hand where sku_id = $1 and location = 'self'`, [p.skuId]);
    const { rows: pd } = await db.query(
      `select coalesce(sum((a->>'qty')::int), 0)::int as qty
         from erp.order_lines l, jsonb_array_elements(l.alloc) a
        where l.deduction_state in ('pending', 'skipped_short') and l.channel <> 'coupang_rg' and (a->>'skuId')::bigint = $1`,
      [p.skuId],
    );
    const onHand = Number(oh[0].qty);
    const pending = Number(pd[0].qty);
    if (p.qty > onHand - pending) {
      throw new KarrotError('stock', `집 재고 ${onHand - pending}개(원장 ${onHand} − 차감 대기 ${pending})보다 많다 — 먼저 재고를 고친다`);
    }
  }
  const label = `${sk[0].name}${sk[0].option_label ? ` · ${sk[0].option_label}` : ''}`;
  const legacyKey = legacyKeyOf({ channel: 'karrot', externalOrderId: `karrot-${p.requestId}`, externalLineId: p.requestId, productId: '' });
  // 잠금은 SKU 단위라 같은 요청 id를 다른 SKU로 동시에 보내면 둘 다 위 중복 검사를 지난다 — 늦은 쪽은 unique 위반(23505).
  // 트랜잭션이 깨지지 않게 savepoint로 감싸 되돌리고 먼저 쓴 줄을 duplicate로 돌려준다
  await db.query('savepoint karrot_ins');
  let lineId: number;
  try {
    const { rows: o } = await db.query(
      `insert into erp.orders (channel, external_order_id, ordered_at, paid_at, status, raw_status) values ('karrot', $1, $2, $2, 'paid', 'KARROT') returning id`,
      [`karrot-${p.requestId}`, at],
    );
    // legacy_qty는 SKU 단위(= 판매 수량)다 — 옛 원가 상품의 단위(묶음 배수)와 다를 수 있다. pickLegacy가 직접 매칭 없이
    // SKU 역참조로 고를 때(alloc 합)와 같은 절충이다
    const { rows: l } = await db.query(
      `insert into erp.order_lines (order_id, channel, external_line_id, sku_id, manual_sku_id, alloc, attribution, order_qty, sku_qty, unit_price, amount,
         status, raw_status, ordered_at, paid_at, product_label, legacy_key, legacy_product_cost_id, legacy_qty, discount_checked_at)
       values ($1, 'karrot', $2, $3, $3, $4::jsonb, 'mapped', $5, $5, $6, $7, 'paid', 'KARROT', $8, $8, $9, $10, $11::uuid, $5, now())
       returning id`,
      [Number(o[0].id), p.requestId, p.skuId, JSON.stringify([{ skuId: p.skuId, qty: p.qty }]), p.qty, Math.round(p.amount / p.qty), p.amount, at, label, legacyKey,
        (sk[0].legacy_product_cost_ids ?? [])[0] ?? null],
    );
    lineId = Number(l[0].id);
    await db.query('release savepoint karrot_ins');
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    await db.query('rollback to savepoint karrot_ins');
    await db.query('release savepoint karrot_ins');
    const { rows: again } = await db.query(DUP_SQL, [p.requestId]);
    if (again.length === 0) throw e;
    return { lineId: Number(again[0].id), outcome: 'duplicate', deduct: null, legacyWarnings: [] };
  }
  const legacy = await syncLegacySales(db, [legacyKey]);
  const setting = await readDeductSetting(db);
  const deduct = await runDeductions(db, { enabled: setting.enabled, cutover, lineIds: [lineId], channel: null, at: now.toISOString(), includeOpen: false });
  return { lineId, outcome: 'recorded', deduct, legacyWarnings: legacy.warnings };
}

export async function cancelKarrotSale(db: Db, lineId: number, now: Date): Promise<void> {
  const { rows } = await db.query(
    `select id, status, legacy_key, order_id from erp.order_lines where id = $1 and channel = 'karrot' for update`,
    [lineId],
  );
  if (rows.length === 0) throw new KarrotError('not_found', `당근 판매가 아니다: ${lineId}`);
  if (rows[0].status === 'canceled') return;
  await db.query(`update erp.order_lines set status = 'canceled', raw_status = 'KARROT/CANCELED', updated_at = now() where id = $1`, [lineId]);
  await db.query(`update erp.orders set status = 'canceled', raw_status = 'KARROT/CANCELED', updated_at = now() where id = $1`, [Number(rows[0].order_id)]);
  await syncLegacySales(db, [String(rows[0].legacy_key)]);
  const setting = await readDeductSetting(db);
  await runDeductions(db, { enabled: setting.enabled, cutover: await readCutover(db), lineIds: [lineId], channel: null, at: now.toISOString(), includeOpen: false });
}

export interface KarrotSaleRow {
  lineId: number;
  skuId: number;
  label: string;
  qty: number;
  amount: number;
  soldAt: string;
  status: string;
  deductionState: string;
}

export async function recentKarrot(db: Db, limit: number): Promise<KarrotSaleRow[]> {
  const { rows } = await db.query(
    `select id, sku_id, product_label, order_qty, amount, paid_at, status, deduction_state from erp.order_lines
      where channel = 'karrot' order by paid_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    lineId: Number(r.id), skuId: Number(r.sku_id), label: String(r.product_label), qty: Number(r.order_qty), amount: Number(r.amount),
    soldAt: (r.paid_at instanceof Date ? r.paid_at : new Date(String(r.paid_at))).toISOString(), status: String(r.status), deductionState: String(r.deduction_state),
  }));
}

/** KarrotError → HTTP(stock = 409 · not_found = 404 · 나머지 400). 그 밖은 null */
export function karrotErrorResponse(e: unknown): NextResponse | null {
  if (!(e instanceof KarrotError)) return null;
  const status = e.code === 'stock' ? 409 : e.code === 'not_found' ? 404 : 400;
  return NextResponse.json({ success: false, code: e.code, error: e.message }, { status });
}
