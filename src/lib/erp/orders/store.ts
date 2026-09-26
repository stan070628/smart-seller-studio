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

/** 주문·라인 upsert. 반환 ids는 넘긴 라인 순서 그대로 */
export async function upsertOrderLines(db: Db, lines: ResolvedLine[]): Promise<{ ids: number[]; inserted: number; updated: number }> {
  const byOrder = new Map<string, ResolvedLine[]>();
  for (const l of lines) {
    const g = byOrder.get(l.externalOrderId) ?? [];
    g.push(l);
    byOrder.set(l.externalOrderId, g);
  }
  const idOf = new Map<string, number>();
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
           product_label, legacy_key, legacy_product_cost_id, legacy_qty)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::uuid, $23)
         on conflict (channel, external_line_id) do update set
           order_id = excluded.order_id, listing_id = excluded.listing_id, sku_id = excluded.sku_id, alloc = excluded.alloc,
           attribution = excluded.attribution, unattributed_reason = excluded.unattributed_reason,
           order_qty = excluded.order_qty, sku_qty = excluded.sku_qty, unit_price = excluded.unit_price, amount = excluded.amount,
           status = case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end,
           raw_status = excluded.raw_status, paid_at = coalesce(excluded.paid_at, erp.order_lines.paid_at),
           product_id = excluded.product_id, option_key = excluded.option_key, alt_product_id = excluded.alt_product_id,
           product_label = excluded.product_label, legacy_key = excluded.legacy_key,
           legacy_product_cost_id = excluded.legacy_product_cost_id, legacy_qty = excluded.legacy_qty, updated_at = now()
         returning id, (xmax = 0) as inserted`,
        [
          orderPk, l.channel, l.externalLineId, l.resolution.listingId, alloc.length === 1 ? alloc[0].skuId : null, JSON.stringify(alloc),
          l.resolution.attribution, l.resolution.reason, l.qty, alloc.reduce((s, a) => s + a.qty, 0), l.unitPrice, l.amount,
          l.status, l.rawStatus, l.orderedAt, l.paidAt, l.productId, l.optionKey, l.altProductId, l.productLabel,
          l.legacyKey, l.legacy?.productCostId ?? null, l.legacy?.qty ?? null,
        ],
      );
      idOf.set(l.externalLineId, Number(rows[0].id));
      if (rows[0].inserted === true) inserted++;
    }
  }
  const ids = lines.map((l) => idOf.get(l.externalLineId) as number);
  return { ids, inserted, updated: ids.length - inserted };
}

/** 응답이 비었을 가능성: 사라진 라인이 5건 이상이고 이번에 받은 라인보다 많다 */
export const absenceSuspicious = (absent: number, seen: number): boolean => absent >= 5 && absent > seen;

/**
 * cover 구간(API가 실제로 거른 구간)에서 이번 응답에 없는 라인 = 취소(쿠팡 판매자배송·RG). 호출자는 채널을 끝까지 받은 경우에만 부른다.
 * 되살아나면(다음 응답에 다시 나오면) upsert가 상태를 되돌리고 차감이 @n으로 다시 뺀다.
 */
export async function markAbsentCanceled(
  db: Db,
  ch: OrderChannel,
  cover: NonNullable<FetchResult['cover']>,
  seen: string[],
): Promise<{ ids: number[]; legacyKeys: string[] }> {
  const col = cover.field === 'paid_at' ? 'paid_at' : 'ordered_at';
  const { rows } = await db.query(
    `select id, legacy_key from erp.order_lines
      where channel = $1 and ${col} >= $2 and ${col} < $3 and status <> 'canceled'
        and not (external_line_id = any($4::text[]))`,
    [ch, cover.from, cover.to, seen],
  );
  if (rows.length === 0) return { ids: [], legacyKeys: [] };
  if (absenceSuspicious(rows.length, seen.length)) {
    throw new Error(`사라진 라인 ${rows.length}건 > 받은 라인 ${seen.length}건 — 응답이 비었을 수 있어 멈춘다(${ch})`);
  }
  const ids = rows.map((r) => Number(r.id));
  const { rows: upd } = await db.query(
    `update erp.order_lines set status = 'canceled', raw_status = 'ABSENT', updated_at = now()
      where id = any($1::bigint[]) returning order_id`,
    [ids],
  );
  await db.query(
    `update erp.orders o set status = 'canceled', updated_at = now()
      where o.id = any($1::bigint[])
        and not exists (select 1 from erp.order_lines x where x.order_id = o.id and x.status <> 'canceled')`,
    [[...new Set(upd.map((r) => Number(r.order_id)))]],
  );
  return { ids, legacyKeys: rows.map((r) => r.legacy_key).filter((k): k is string => typeof k === 'string') };
}

export interface ReEvalResult {
  /** 이번에 unknown → 다른 상태로 바뀐 라인 id */
  ids: number[];
  /** 바뀐 라인의 옛 장부 키(옛 장부를 다시 계산해야 한다) */
  legacyKeys: string[];
  /** 이 재판정 뒤에도 남은 unknown 라인 수(채널 기준) — 크론 알림 문턱(Task 6) */
  remaining: number;
}

/**
 * (설계 해석 #23) status='unknown'인 채널의 라인을 저장된 raw_status로 다시 판정한다. 채널 API를 다시 부르지 않는다 —
 * 매핑표(status.ts)가 사람이 새 값을 추가해 갱신되면 다음 수집에서 조용히 반영된다. 안 바뀐 라인은 쓰지 않는다.
 */
export async function reevaluateUnknownLines(db: Db, ch: OrderChannel): Promise<ReEvalResult> {
  const { rows } = await db.query(
    `select id, raw_status, legacy_key from erp.order_lines where channel = $1 and status = 'unknown'`,
    [ch],
  );
  const ids: number[] = [];
  const legacyKeys: string[] = [];
  for (const r of rows) {
    const next = statusFromRaw(ch, String(r.raw_status));
    if (next === 'unknown') continue;
    await db.query(`update erp.order_lines set status = $2, updated_at = now() where id = $1`, [Number(r.id), next]);
    ids.push(Number(r.id));
    if (typeof r.legacy_key === 'string') legacyKeys.push(r.legacy_key);
  }
  const { rows: cnt } = await db.query(
    `select count(*)::int as n from erp.order_lines where channel = $1 and status = 'unknown'`,
    [ch],
  );
  return { ids, legacyKeys, remaining: Number(cnt[0].n) };
}
