// src/lib/erp/stock/queries.ts
// 재고 화면 조회(읽기 전용). 쓰기는 ledger/adjust-store.ts · ledger/opening-import.ts.
import type { Db } from '@/lib/erp/ledger/store';
import type { Location } from '@/lib/erp/ledger/fifo';
import type { LedgerKind, Reason } from '@/lib/erp/ledger/plan';
import type { OpeningIssue } from '@/lib/erp/ledger/opening';
import { isReversibleKey } from '@/lib/erp/ledger/adjust';

export interface StockListRow {
  skuId: number;
  key: string;
  name: string;
  option: string;
  legacyProductCostIds: string[];
  self: number;
  rgInbound: number;
  rg: number;
  /** 원장 평가액(lot 단가 × 수량 합) */
  value: number;
  /** 원장 전표가 하나라도 있다 */
  hasLedger: boolean;
  /** 최근 lot 단가(위치 무관, 되돌린 lot 제외) */
  lotCost: number | null;
  /** 옛 cost_entries 최근 단가. 기준 단위가 정해진 SKU는 null(옛 입고는 다른 단위일 수 있다) */
  legacyCost: number | null;
  /** 미리 채울 단가가 없다(최근 lot도, 쓸 수 있는 옛 입고도 없다) — 재고를 늘리려면 사람이 단가를 적는다 */
  costNeedsInput: boolean;
  /** 집 위치 원장 평가액 — 오늘 셀 목록의 금액 순서 */
  selfValue: number;
  /** 집 마지막 실사(센 기록, erp.stock_counts) 시각. 한 번도 안 셌으면 null */
  lastCountedAt: string | null;
}

export interface HistoryRow {
  id: number;
  location: Location;
  qty: number;
  kind: LedgerKind;
  reason: Reason | null;
  note: string | null;
  occurredAt: string;
  idemKey: string;
  /** 순번(#…)을 뗀 원 멱등키 — 되돌리기 단위 */
  baseKey: string;
  refType: string | null;
  refId: string | null;
  /** lot 단가(차감·이동 전표는 그 lot의 단가) */
  unitCost: number | null;
  reversed: boolean;
  reversible: boolean;
}

export interface RecentAdjust {
  requestId: string;
  skuId: number;
  name: string;
  option: string;
  location: Location;
  /** 그 요청의 순증감(되돌렸으면 0) */
  qty: number;
  reason: Reason | null;
  occurredAt: string;
}

export interface RgReconResponse {
  fetchedAt: string;
  rows: { skuId: number; ledger: number; actual: number }[];
  issues: OpeningIssue[];
  inactive: { skuId: number; qty: number }[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export async function listStock(db: Db): Promise<StockListRow[]> {
  const { rows } = await db.query(
    `select s.id, s.key, s.name, s.option_label, s.base_unit_label, s.legacy_product_cost_ids::text[] as legacy,
            coalesce(sum(h.qty) filter (where h.location = 'self'), 0)::int as self,
            coalesce(sum(h.qty) filter (where h.location = 'rg_inbound'), 0)::int as rg_inbound,
            coalesce(sum(h.qty) filter (where h.location = 'rg'), 0)::int as rg,
            coalesce(sum(h.value), 0)::bigint as value,
            coalesce(sum(h.value) filter (where h.location = 'self'), 0)::bigint as self_value,
            (select max(c.counted_at) from erp.stock_counts c where c.sku_id = s.id and c.location = 'self') as last_counted_at,
            exists (select 1 from erp.stock_ledger x where x.sku_id = s.id) as has_ledger,
            (select l.unit_cost from erp.stock_ledger l
              where l.sku_id = s.id and l.lot_id is null
                and not exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id)
              order by l.occurred_at desc, l.id desc limit 1) as lot_cost,
            (select round(ce.unit_cost)::int from cost_entries ce
              where ce.product_cost_id = any(s.legacy_product_cost_ids)
              order by ce.received_at desc nulls last, ce.created_at desc nulls last limit 1) as legacy_cost
       from erp.skus s
       left join erp.stock_on_hand h on h.sku_id = s.id
      where s.status = 'active'
      group by s.id
      order by s.name, s.option_label, s.id`,
  );
  return rows.map((r) => {
    // adjust-store legacyUnitCost와 같은 규칙: 기준 단위가 정해진 SKU는 옛 입고 단가를 쓰지 않는다
    const legacyCost = r.base_unit_label === null || r.base_unit_label === undefined ? num(r.legacy_cost) : null;
    const lotCost = num(r.lot_cost);
    return {
      skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '', legacyProductCostIds: r.legacy ?? [],
      self: Number(r.self), rgInbound: Number(r.rg_inbound), rg: Number(r.rg), value: Number(r.value),
      hasLedger: r.has_ledger === true, lotCost, legacyCost, costNeedsInput: lotCost === null && legacyCost === null,
      selfValue: Number(r.self_value), lastCountedAt: r.last_counted_at ? iso(r.last_counted_at) : null,
    };
  });
}

export async function skuHistory(db: Db, skuId: number, limit = 300): Promise<HistoryRow[]> {
  const { rows } = await db.query(
    `select l.id, l.location, l.qty, l.kind, l.reason, l.note, l.occurred_at, l.idem_key, l.ref_type, l.ref_id,
            h.unit_cost,
            exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id) as reversed
       from erp.stock_ledger l join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
      where l.sku_id = $1
      order by l.occurred_at desc, l.id desc
      limit $2`,
    [skuId, limit],
  );
  const mapped = rows.map((r) => ({
    id: Number(r.id), location: r.location as Location, qty: Number(r.qty), kind: r.kind as LedgerKind,
    reason: (r.reason ?? null) as Reason | null, note: r.note ?? null, occurredAt: iso(r.occurred_at),
    idemKey: String(r.idem_key), baseKey: String(r.idem_key).split('#')[0], refType: r.ref_type ?? null, refId: r.ref_id ?? null,
    unitCost: num(r.unit_cost), reversed: r.reversed === true, reversible: false,
  }));
  const reversedKeys = new Set(mapped.filter((m) => m.reversed).map((m) => m.baseKey));
  return mapped.map((m) => ({ ...m, reversible: m.kind !== 'reversal' && isReversibleKey(m.baseKey) && !reversedKeys.has(m.baseKey) }));
}

export async function recentAdjustments(db: Db, limit: number): Promise<RecentAdjust[]> {
  const { rows } = await db.query(
    `select l.ref_id, l.sku_id, s.name, s.option_label, l.location, sum(l.qty)::int as qty,
            max(l.reason) as reason, max(l.occurred_at) as occurred_at
       from erp.stock_ledger l join erp.skus s on s.id = l.sku_id
      where l.ref_type = 'adjust'
      group by l.ref_id, l.sku_id, s.name, s.option_label, l.location
      order by max(l.id) desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    requestId: String(r.ref_id), skuId: Number(r.sku_id), name: r.name, option: r.option_label ?? '', location: r.location as Location,
    qty: Number(r.qty), reason: (r.reason ?? null) as Reason | null, occurredAt: iso(r.occurred_at),
  }));
}

export async function rgLedgerBySku(db: Db): Promise<Map<number, number>> {
  const { rows } = await db.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg'`);
  return new Map(rows.map((r) => [Number(r.sku_id), Number(r.qty)]));
}

export async function activeSkuIds(db: Db): Promise<Set<number>> {
  const { rows } = await db.query(`select id from erp.skus where status = 'active'`);
  return new Set(rows.map((r) => Number(r.id)));
}

export async function stockedSkuIds(db: Db): Promise<Set<number>> {
  const { rows } = await db.query('select distinct sku_id from erp.stock_ledger');
  return new Set(rows.map((r) => Number(r.sku_id)));
}
