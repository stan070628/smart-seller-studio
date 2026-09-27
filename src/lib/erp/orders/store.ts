// src/lib/erp/orders/store.ts
// 주문 수집의 DB 읽기·쓰기. 호출자가 트랜잭션을 연다(collect.ts). 구매자 정보 칸은 표에도 SQL에도 없다.
import type { Db } from '@/lib/erp/ledger/store';
import type { LegacyIndex, LegacyTarget } from './legacy';
import { ListingIndex, type LinkMode, type Resolution } from './resolve';
import { statusFromRaw } from './status';
import type { FetchResult, OrderChannel, OrderLine, StdStatus } from './types';

export interface ResolvedLine extends OrderLine {
  resolution: Resolution;
  legacyKey: string;
  legacy: LegacyTarget | null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function loadListingIndex(db: Db): Promise<ListingIndex> {
  const { rows } = await db.query(
    `select l.id, l.channel, l.external_product_id, l.external_option_key, l.link_mode,
            coalesce(json_agg(json_build_object('skuId', ls.sku_id, 'multiplier', ls.multiplier) order by ls.sku_id)
                     filter (where ls.sku_id is not null), '[]'::json) as skus
       from erp.channel_listings l
       left join erp.listing_skus ls on ls.listing_id = l.id
      where l.active
      group by l.id`,
  );
  return new ListingIndex(rows.map((r) => ({
    listingId: Number(r.id),
    channel: r.channel as OrderChannel,
    productId: String(r.external_product_id),
    optionKey: String(r.external_option_key ?? ''),
    linkMode: r.link_mode as LinkMode,
    skus: (r.skus as { skuId: number | string; multiplier: number | string }[]).map((s) => ({ skuId: Number(s.skuId), multiplier: Number(s.multiplier) })),
  })));
}

export async function loadLegacyIndex(db: Db): Promise<LegacyIndex> {
  const skus = await db.query(`select id, legacy_product_cost_ids::text[] as legacy from erp.skus`);
  const pcc = await db.query(
    `select channel_type, external_id::text as external_id, product_cost_id::text as product_cost_id, unit_multiplier
       from product_cost_channels where channel_type in ('coupang_wing', 'coupang_rg')`,
  );
  const pcs = await db.query(
    `select id::text as id, vendor_item_id::text as vid, naver_channel_product_no::text as naver from product_costs`,
  );
  const idx: LegacyIndex = { skuLegacy: new Map(), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() };
  for (const r of skus.rows) idx.skuLegacy.set(Number(r.id), (r.legacy ?? []) as string[]);
  for (const r of pcc.rows) {
    const k = `${r.channel_type}:${r.external_id}`;
    const list = idx.pcc.get(k) ?? [];
    list.push({ productCostId: String(r.product_cost_id), multiplier: Number(r.unit_multiplier) >= 1 ? Number(r.unit_multiplier) : 1 });
    idx.pcc.set(k, list);
  }
  for (const r of pcs.rows) {
    if (r.vid) idx.pcByVendorItem.set(String(r.vid), String(r.id));
    if (r.naver) idx.pcByNaverChannelNo.set(String(r.naver), String(r.id));
  }
  return idx;
}

/**
 * (1-C2b ①) 사람이 정한 SKU — external_line_id → sku_id. 수집 판정이 이 값을 먼저 본다(applyManualSku).
 * externalLineIds로 이번에 받은 라인만 좁힌다 — 채널 전체를 긁지 않는다. 비어 있으면 조회하지 않는다.
 */
export async function loadManualSkus(db: Db, ch: OrderChannel, externalLineIds: string[]): Promise<Map<string, number>> {
  if (externalLineIds.length === 0) return new Map();
  const { rows } = await db.query(
    `select external_line_id, manual_sku_id from erp.order_lines
      where channel = $1 and manual_sku_id is not null and external_line_id = any($2::text[])`,
    [ch, externalLineIds],
  );
  return new Map(rows.map((r) => [String(r.external_line_id), Number(r.manual_sku_id)]));
}

/** 기초재고 시각 — 수집 시작점이자 차감 기준. 없으면 던진다(기초재고 전에는 주문을 수집하지 않는다) */
export async function readCutover(db: Db): Promise<string> {
  const { rows } = await db.query(`select cursor_at from erp.sync_cursors where name = 'ledger_cutover'`);
  if (rows.length === 0) throw new Error('ledger_cutover가 없다 — 기초재고 전에는 주문을 수집하지 않는다');
  return iso(rows[0].cursor_at);
}

export const cursorName = (ch: OrderChannel): string => `orders:${ch}`;

export async function readCursor(db: Db, ch: OrderChannel): Promise<string | null> {
  const { rows } = await db.query(`select cursor_at from erp.sync_cursors where name = $1`, [cursorName(ch)]);
  return rows.length === 0 ? null : iso(rows[0].cursor_at);
}

/**
 * 커서 행이 없으면 기초 시각으로 만든다 — 임대(lease)는 이 행에 건다. 기초 시각 커서는 커서 없음과 같은 구간을 준다
 * (windowFor: max(기초, min(기초 − 48h, …)) = 기초).
 */
export async function ensureCursorRow(db: Db, ch: OrderChannel, cutover: string): Promise<void> {
  await db.query(`insert into erp.sync_cursors (name, cursor_at) values ($1, $2) on conflict (name) do nothing`, [cursorName(ch), cutover]);
}

/**
 * 채널 수집 임대(설계 해석 #24) — autocommit으로 부른다. 비었거나 만료된 임대만 잡고, 잡으면 DB 시각(= 수집 시작 시각)을 돌려준다.
 * 세션 advisory lock은 Supavisor 트랜잭션 풀러에서 문장마다 다른 백엔드에 붙을 수 있어 쓰지 않는다. 마이그레이션 119 칸.
 */
export async function takeLease(db: Db, ch: OrderChannel, owner: string): Promise<{ ok: boolean; at: string | null }> {
  const { rows } = await db.query(
    `update erp.sync_cursors set lease_until = now() + interval '10 min', lease_owner = $2
      where name = $1 and (lease_until is null or lease_until < now())
      returning now() as at`,
    [cursorName(ch), owner],
  );
  return rows.length === 0 ? { ok: false, at: null } : { ok: true, at: iso(rows[0].at) };
}

/** 임대 반납 — 주인일 때만(만료 뒤 다른 실행이 가져갔으면 건드리지 않는다) */
export async function releaseLease(db: Db, ch: OrderChannel, owner: string): Promise<void> {
  await db.query(
    `update erp.sync_cursors set lease_until = null, lease_owner = null where name = $1 and lease_owner = $2`,
    [cursorName(ch), owner],
  );
}

/** 수집 커서. 겹친 실행이 커서를 뒤로 돌리지 않게 더 늦은 쪽만 남긴다 */
export async function advanceCursor(db: Db, ch: OrderChannel, at: string): Promise<void> {
  await db.query(
    `insert into erp.sync_cursors (name, cursor_at) values ($1, $2)
     on conflict (name) do update set cursor_at = greatest(erp.sync_cursors.cursor_at, excluded.cursor_at), updated_at = now()`,
    [cursorName(ch), at],
  );
}

export interface DeductSetting {
  enabled: boolean;
  enabledAt: string | null;
  by: string | null;
}

/** 차감 스위치(erp.settings 'deduct_enabled'). forUpdate = 켜는 트랜잭션이 행을 잡는다 */
export async function readDeductSetting(db: Db, forUpdate = false): Promise<DeductSetting> {
  const { rows } = await db.query(`select value from erp.settings where name = 'deduct_enabled'${forUpdate ? ' for update' : ''}`);
  if (rows.length === 0) throw new Error('erp.settings에 deduct_enabled가 없다 — 마이그레이션 117 확인');
  const v = (rows[0].value ?? {}) as { enabled?: boolean; enabledAt?: string; by?: string };
  return { enabled: v.enabled === true, enabledAt: v.enabledAt ?? null, by: v.by ?? null };
}

export async function writeDeductEnabled(db: Db, p: { by: string; at: string }): Promise<void> {
  await db.query(
    `update erp.settings set value = jsonb_build_object('enabled', true, 'enabledAt', $1::text, 'by', $2::text), updated_at = now()
      where name = 'deduct_enabled'`,
    [p.at, p.by],
  );
}

/** 주문 표준 상태: 라인이 모두 같으면 그 값, 섞이면 mixed */
export function orderStatusOf(statuses: StdStatus[]): StdStatus | 'mixed' {
  return new Set(statuses).size === 1 ? statuses[0] : 'mixed';
}

export interface UpsertResult {
  /** 넘긴 라인 순서 그대로의 라인 id(안 바뀐 라인 포함) */
  ids: number[];
  /** 새로 들어왔거나 바뀐 라인 id — 차감 대상(M3). 안 바뀐 라인은 쓰지도 세지도 않는다 */
  changedIds: number[];
  inserted: number;
  updated: number;
  unchanged: number;
}

/** 라인 upsert에서 바뀌었는지 견주는 칸들(updated_at 제외). 왼쪽 = 저장된 값, 오른쪽 = 이번에 쓸 값 */
const LINE_CMP_OLD = `erp.order_lines.order_id, erp.order_lines.listing_id, erp.order_lines.sku_id, erp.order_lines.alloc,
           erp.order_lines.attribution, erp.order_lines.unattributed_reason, erp.order_lines.order_qty, erp.order_lines.sku_qty,
           erp.order_lines.unit_price, erp.order_lines.amount, erp.order_lines.status, erp.order_lines.raw_status, erp.order_lines.paid_at,
           erp.order_lines.product_id, erp.order_lines.option_key, erp.order_lines.alt_product_id, erp.order_lines.product_label,
           erp.order_lines.legacy_key, erp.order_lines.legacy_product_cost_id, erp.order_lines.legacy_qty,
           erp.order_lines.status_unmapped, erp.order_lines.absent_since`;
const LINE_STATUS = `case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end`;
const LINE_PAID = `coalesce(excluded.paid_at, erp.order_lines.paid_at)`;
const LINE_CMP_NEW = `excluded.order_id, excluded.listing_id, excluded.sku_id, excluded.alloc,
           excluded.attribution, excluded.unattributed_reason, excluded.order_qty, excluded.sku_qty,
           excluded.unit_price, excluded.amount, ${LINE_STATUS}, excluded.raw_status, ${LINE_PAID},
           excluded.product_id, excluded.option_key, excluded.alt_product_id, excluded.product_label,
           excluded.legacy_key, excluded.legacy_product_cost_id, excluded.legacy_qty,
           excluded.status_unmapped, null::timestamptz`;

/**
 * 주문·라인 upsert. 반환 ids는 넘긴 라인 순서 그대로.
 * - 매핑표에 없는 상태(unknown)는 기존 상태를 지키고 status_unmapped = true(I3) — 재판정·알림은 이 칸으로 센다.
 * - 이번에 보인 라인은 absent_since를 지운다(I1 — 두 번 연속 사라져야 취소).
 * - 안 바뀐 라인은 쓰지 않는다(M3 — returning이 비면 id만 다시 읽는다).
 */
export async function upsertOrderLines(db: Db, lines: ResolvedLine[]): Promise<UpsertResult> {
  const byOrder = new Map<string, ResolvedLine[]>();
  for (const l of lines) {
    const g = byOrder.get(l.externalOrderId) ?? [];
    g.push(l);
    byOrder.set(l.externalOrderId, g);
  }
  const idOf = new Map<string, number>();
  const changed = new Set<string>();
  let inserted = 0;
  for (const [orderId, ls] of byOrder) {
    const first = ls[0];
    const paid = ls.map((l) => l.paidAt).filter((x): x is string => x !== null).sort()[0] ?? null;
    const ordered = ls.map((l) => l.orderedAt).sort()[0];
    const { rows: o } = await db.query(
      `insert into erp.orders (channel, external_order_id, ordered_at, paid_at, status, raw_status)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel, external_order_id) do update set
         paid_at = coalesce(excluded.paid_at, erp.orders.paid_at), status = excluded.status,
         raw_status = excluded.raw_status, updated_at = now()
       returning id`,
      [first.channel, orderId, ordered, paid, orderStatusOf(ls.map((l) => l.status)), [...new Set(ls.map((l) => l.rawStatus))].join(',')],
    );
    const orderPk = Number(o[0].id);
    for (const l of ls) {
      const alloc = l.resolution.alloc;
      const { rows } = await db.query(
        `insert into erp.order_lines (order_id, channel, external_line_id, listing_id, sku_id, alloc, attribution, unattributed_reason,
           order_qty, sku_qty, unit_price, amount, status, raw_status, ordered_at, paid_at, product_id, option_key, alt_product_id,
           product_label, legacy_key, legacy_product_cost_id, legacy_qty, status_unmapped)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::uuid, $23, $24)
         on conflict (channel, external_line_id) do update set
           order_id = excluded.order_id, listing_id = excluded.listing_id, sku_id = excluded.sku_id, alloc = excluded.alloc,
           attribution = excluded.attribution, unattributed_reason = excluded.unattributed_reason,
           order_qty = excluded.order_qty, sku_qty = excluded.sku_qty, unit_price = excluded.unit_price, amount = excluded.amount,
           status = ${LINE_STATUS},
           raw_status = excluded.raw_status, paid_at = ${LINE_PAID},
           product_id = excluded.product_id, option_key = excluded.option_key, alt_product_id = excluded.alt_product_id,
           product_label = excluded.product_label, legacy_key = excluded.legacy_key,
           legacy_product_cost_id = excluded.legacy_product_cost_id, legacy_qty = excluded.legacy_qty,
           status_unmapped = excluded.status_unmapped, absent_since = null, updated_at = now()
         where (${LINE_CMP_OLD}) is distinct from (${LINE_CMP_NEW})
         returning id, (xmax = 0) as inserted`,
        [
          orderPk, l.channel, l.externalLineId, l.resolution.listingId, alloc.length === 1 ? alloc[0].skuId : null, JSON.stringify(alloc),
          l.resolution.attribution, l.resolution.reason, l.qty, alloc.reduce((s, a) => s + a.qty, 0), l.unitPrice, l.amount,
          l.status, l.rawStatus, l.orderedAt, l.paidAt, l.productId, l.optionKey, l.altProductId, l.productLabel,
          l.legacyKey, l.legacy?.productCostId ?? null, l.legacy?.qty ?? null, l.status === 'unknown',
        ],
      );
      if (rows.length === 0) {
        // 안 바뀌었다 — 쓰지 않았으니 id만 읽는다
        const { rows: ex } = await db.query(
          `select id from erp.order_lines where channel = $1 and external_line_id = $2`,
          [l.channel, l.externalLineId],
        );
        idOf.set(l.externalLineId, Number(ex[0].id));
        continue;
      }
      idOf.set(l.externalLineId, Number(rows[0].id));
      changed.add(l.externalLineId);
      if (rows[0].inserted === true) inserted++;
    }
  }
  const ids = lines.map((l) => idOf.get(l.externalLineId) as number);
  const changedIds = [...new Set(lines.filter((l) => changed.has(l.externalLineId)).map((l) => idOf.get(l.externalLineId) as number))];
  return { ids, changedIds, inserted, updated: changedIds.length - inserted, unchanged: ids.length - changedIds.length };
}

/** 응답이 비었을 가능성: 사라진 라인이 5건 이상이고 이번에 받은 라인보다 많다 */
export const absenceSuspicious = (absent: number, seen: number): boolean => absent >= 5 && absent > seen;

/** 사라진 라인이 cover 행의 20%를 넘는다. 1건은 걸지 않는다 — 한가한 주의 진짜 취소 1건이 cover를 벗어날 때까지 막히지 않게 */
export const absenceOverRatio = (absent: number, coverRows: number): boolean => absent >= 2 && absent > coverRows * 0.2;

export type AbsenceSeen = Pick<OrderLine, 'externalLineId' | 'orderedAt' | 'paidAt'>;

export interface AbsenceRefusal {
  reason: 'empty_fetch' | 'more_absent_than_seen' | 'over_20pct';
  absent: number;
  seenInCover: number;
  coverRows: number;
}

export interface AbsenceResult {
  /** 이번에 취소한 라인(두 번째로 사라짐) */
  ids: number[];
  legacyKeys: string[];
  /** 이번에 처음 사라져 absent_since만 적은 라인 수 */
  marked: number;
  /** 사라진 라인 수(판정 대상) */
  absent: number;
  /** 의심스러워 아무것도 바꾸지 않았다 — 수집기가 보고서에 실어 알린다 */
  refused: AbsenceRefusal | null;
}

/**
 * cover 구간(API가 실제로 거른 구간)에서 이번 응답에 없는 라인 = 취소(쿠팡 판매자배송·RG). 호출자는 채널을 끝까지 받은 경우에만 부른다.
 * (설계 해석 #24)
 * - 대상은 이번 수집 시작 전에 처음 본 라인뿐(first_seen_at < fetchStartedAt) — 겹친 실행이 방금 넣은 라인을 사라짐으로 오판하지 않는다.
 * - 두 번 연속: 처음 사라지면 absent_since만 적고(상태 그대로), 이미 absent_since가 있는(이전 수집에서도 없던) 라인만 취소한다.
 *   다시 보이면 upsert가 absent_since를 지우고 상태를 되돌리며 차감이 @n으로 다시 뺀다.
 * - 의심이면 아무것도 바꾸지 않고 refused로 돌려준다: cover 안에서 받은 라인 0건 · 사라짐 ≥ 5이고 받은 수보다 많음 · 사라짐이 cover 행의 20% 초과(2건 이상).
 */
export async function markAbsentCanceled(
  db: Db,
  ch: OrderChannel,
  cover: NonNullable<FetchResult['cover']>,
  seen: AbsenceSeen[],
  fetchStartedAt: string,
): Promise<AbsenceResult> {
  const col = cover.field === 'paid_at' ? 'paid_at' : 'ordered_at';
  const { rows } = await db.query(
    `select id, legacy_key, absent_since, external_line_id from erp.order_lines
      where channel = $1 and ${col} >= $2 and ${col} < $3 and status <> 'canceled' and first_seen_at < $4`,
    [ch, cover.from, cover.to, fetchStartedAt],
  );
  const seenIds = new Set(seen.map((l) => l.externalLineId));
  const lo = Date.parse(cover.from);
  const hi = Date.parse(cover.to);
  const seenInCover = seen.filter((l) => {
    const at = cover.field === 'paid_at' ? l.paidAt : l.orderedAt;
    const t = at === null ? NaN : Date.parse(at);
    return t >= lo && t < hi;
  }).length;
  const absentRows = rows.filter((r) => !seenIds.has(String(r.external_line_id)));
  const none: AbsenceResult = { ids: [], legacyKeys: [], marked: 0, absent: absentRows.length, refused: null };
  if (absentRows.length === 0) return none;
  const refuse = (reason: AbsenceRefusal['reason']): AbsenceResult =>
    ({ ...none, refused: { reason, absent: absentRows.length, seenInCover, coverRows: rows.length } });
  if (seenInCover === 0) return refuse('empty_fetch');
  if (absenceSuspicious(absentRows.length, seenInCover)) return refuse('more_absent_than_seen');
  if (absenceOverRatio(absentRows.length, rows.length)) return refuse('over_20pct');

  const first = absentRows.filter((r) => r.absent_since === null || r.absent_since === undefined).map((r) => Number(r.id));
  const again = absentRows.filter((r) => r.absent_since !== null && r.absent_since !== undefined);
  if (first.length > 0) {
    await db.query(`update erp.order_lines set absent_since = now() where id = any($1::bigint[])`, [first]);
  }
  if (again.length === 0) return { ...none, marked: first.length };
  const ids = again.map((r) => Number(r.id));
  const { rows: upd } = await db.query(
    `update erp.order_lines set status = 'canceled', raw_status = 'ABSENT', status_unmapped = false, updated_at = now()
      where id = any($1::bigint[]) returning order_id`,
    [ids],
  );
  await db.query(
    `update erp.orders o set status = 'canceled', updated_at = now()
      where o.id = any($1::bigint[])
        and not exists (select 1 from erp.order_lines x where x.order_id = o.id and x.status <> 'canceled')`,
    [[...new Set(upd.map((r) => Number(r.order_id)))]],
  );
  return {
    ids, marked: first.length, absent: absentRows.length, refused: null,
    legacyKeys: again.map((r) => r.legacy_key).filter((k): k is string => typeof k === 'string'),
  };
}

export interface ReEvalResult {
  /** 이번에 매핑돼 status가 새로 정해진 라인 id */
  ids: number[];
  /** 바뀐 라인의 옛 장부 키(옛 장부를 다시 계산해야 한다) */
  legacyKeys: string[];
  /** 이 재판정 뒤에도 남은 매핑 안 된(status_unmapped) 라인 수(채널 기준) — 크론 알림 문턱(Task 6) */
  remaining: number;
}

/**
 * (설계 해석 #23·#24) 매핑되지 않은(status_unmapped) 채널의 라인을 저장된 raw_status로 다시 판정한다. 채널 API를 다시 부르지 않는다 —
 * 매핑표(status.ts)가 사람이 새 값을 추가해 갱신되면 다음 수집에서 조용히 반영된다. 안 바뀐 라인은 쓰지 않는다.
 * status='unknown'으로 고르지 않는다: 이미 있던 라인은 unknown이 와도 이전 상태를 지키므로 status로는 찾을 수 없다(I3).
 */
export async function reevaluateUnknownLines(db: Db, ch: OrderChannel): Promise<ReEvalResult> {
  const { rows } = await db.query(
    `select id, raw_status, legacy_key from erp.order_lines where channel = $1 and status_unmapped`,
    [ch],
  );
  const ids: number[] = [];
  const legacyKeys: string[] = [];
  for (const r of rows) {
    const next = statusFromRaw(ch, String(r.raw_status));
    if (next === 'unknown') continue;
    await db.query(`update erp.order_lines set status = $2, status_unmapped = false, updated_at = now() where id = $1`, [Number(r.id), next]);
    ids.push(Number(r.id));
    if (typeof r.legacy_key === 'string') legacyKeys.push(r.legacy_key);
  }
  const { rows: cnt } = await db.query(
    `select count(*)::int as n from erp.order_lines where channel = $1 and status_unmapped`,
    [ch],
  );
  return { ids, legacyKeys, remaining: Number(cnt[0].n) };
}
