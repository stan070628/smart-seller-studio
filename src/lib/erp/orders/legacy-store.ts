// src/lib/erp/orders/legacy-store.ts
// 옛 장부(sale_records) 쓰기. 무엇을 쓸지는 legacy.ts planLegacy가 정한다. 호출자가 트랜잭션을 연다.
// 이미 있는 행(옛 불러오기가 만든 같은 키)은 수량·단가·금액·판매일·무효만 갱신한다 — 상품·쿠폰·배송비는 사람이 고쳤을 수 있다.
// warnings(팔림인데 옛 상품을 못 고름)는 쓰지 않고 그대로 돌려준다 — 수집기가 counts에 실어 크론 알림(Task 6)의 재료로 쓴다.
import type { Db } from '@/lib/erp/ledger/store';
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';
import { bareWingKey } from './keys';
import { planLegacy, type LegacyLine, type LegacyWarning } from './legacy';
import type { OrderChannel, StdStatus } from './types';

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export interface SyncLegacyResult {
  upserted: number;
  inserted: number;
  voided: number;
  warnings: LegacyWarning[];
}

export async function syncLegacySales(db: Db, keys: string[]): Promise<SyncLegacyResult> {
  const out: SyncLegacyResult = { upserted: 0, inserted: 0, voided: 0, warnings: [] };
  if (keys.length === 0) return out;
  const { rows } = await db.query(
    `select legacy_key, channel, status, order_qty, legacy_qty, amount, paid_at, ordered_at, legacy_product_cost_id::text as pc
       from erp.order_lines where legacy_key = any($1::text[])`,
    [keys],
  );
  const lines: LegacyLine[] = rows.map((r) => ({
    legacyKey: String(r.legacy_key),
    channel: r.channel as OrderChannel,
    status: r.status as StdStatus,
    orderQty: Number(r.order_qty),
    legacyQty: r.legacy_qty === null || r.legacy_qty === undefined ? null : Number(r.legacy_qty),
    amount: Number(r.amount),
    paidAt: iso(r.paid_at),
    orderedAt: iso(r.ordered_at) as string,
    productCostId: r.pc ?? null,
  }));
  const plan = planLegacy(lines);
  out.warnings = plan.warnings;
  for (const r of plan.upsert) {
    const res = await db.query(
      `insert into sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
       select pc.user_id, pc.id, $2::date, $3, $4, $5, $6, $7, $8 from product_costs pc where pc.id = $1::uuid
       on conflict (coupang_order_item_id) do update set
         quantity = excluded.quantity, selling_price = excluded.selling_price, sale_amount = excluded.sale_amount,
         sold_at = excluded.sold_at, voided_at = null
       returning id, (xmax = 0) as inserted`,
      [r.productCostId, r.soldAt, r.quantity, r.sellingPrice, r.saleAmount, r.channel, r.key, resolveSaleShippingFee(r.shippingSource)],
    );
    if (res.rows.length === 0) continue; // 그 사이 옛 상품이 지워졌다
    out.upserted++;
    if (res.rows[0].inserted === true) out.inserted++;
    await db.query(`update erp.order_lines set legacy_sale_id = $1 where legacy_key = $2`, [res.rows[0].id, r.key]);
    const bare = bareWingKey(r.key);
    if (bare) {
      const v = await db.query(`update sale_records set voided_at = now() where coupang_order_item_id = $1 and voided_at is null`, [bare]);
      out.voided += v.rowCount ?? 0;
    }
  }
  if (plan.voidKeys.length > 0) {
    const v = await db.query(
      `update sale_records set voided_at = now() where coupang_order_item_id = any($1::text[]) and voided_at is null`,
      [plan.voidKeys],
    );
    out.voided += v.rowCount ?? 0;
  }
  return out;
}
