// src/lib/erp/orders/legacy-store.ts
// 옛 장부(sale_records) 쓰기. 무엇을 쓸지는 legacy.ts planLegacy가 정한다. 호출자가 트랜잭션을 연다.
// 이미 있는 행(옛 불러오기가 만든 같은 키)은 수량·단가·금액·판매일·무효만 갱신한다 — 상품·배송비는 사람이 고쳤을 수 있다.
// (1-C2b ②) 쿠폰(coupon_discount)은 키의 살아 있는 줄이 모두 할인을 확인했을 때만 덮는다. 하나라도 모르면 기존 값 유지.
// warnings(팔림인데 옛 상품을 못 고름 · 다른 곳에서 무효화한 행)는 그대로 돌려준다 — 수집기가 counts에 실어 크론 알림(Task 6)의 재료로 쓴다.
// 무효 출처(설계 해석 #24): 수집기는 자기가 무효화한 행만 되살린다(order_lines.legacy_voided_at — 마이그레이션 119).
import type { Db } from '@/lib/erp/ledger/store';
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';
import { bareWingKey } from './keys';
import { planLegacy, type LegacyLine, type LegacyWarning } from './legacy';
import type { OrderChannel, StdStatus } from './types';

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/**
 * (1-C2b ②) 줄의 확인된 할인. null = 모른다 — 아직 확인 전(discount_checked_at null)이거나 쿠팡 조회 3회 실패로 닫힌 줄(coupang_fms_error).
 * 모르는 줄이 하나라도 있는 키는 옛 장부 coupon_discount를 건드리지 않는다(planLegacy).
 */
function discountOf(r: Record<string, unknown>): number | null {
  if (r.discount_checked_at === null || r.discount_checked_at === undefined) return null;
  if (r.discount_source === 'coupang_fms_error') return null;
  return Number(r.discount_amount) || 0;
}

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
    `select legacy_key, channel, status, order_qty, legacy_qty, amount, paid_at, ordered_at, legacy_product_cost_id::text as pc,
            discount_amount, discount_source, discount_checked_at
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
    discount: discountOf(r),
  }));
  const plan = planLegacy(lines);
  out.warnings = [...plan.warnings];
  for (const r of plan.upsert) {
    // (I6) 무효를 푸는 것은 수집기가 무효화한 행뿐 — 그때 라인에 남긴 시각(legacy_voided_at)과 행의 voided_at이 같아야 한다.
    // 사람·옛 불러오기가 무효화한 행은 그대로 두고 voided_elsewhere 경고로 돌려준다.
    const res = await db.query(
      `insert into sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee, coupon_discount)
       select pc.user_id, pc.id, $2::date, $3, $4, $5, $6, $7, $8, coalesce($9::int, 0) from product_costs pc where pc.id = $1::uuid
       on conflict (coupang_order_item_id) do update set
         quantity = excluded.quantity, selling_price = excluded.selling_price, sale_amount = excluded.sale_amount,
         coupon_discount = coalesce($9::int, sale_records.coupon_discount),
         sold_at = excluded.sold_at,
         voided_at = case
           when sale_records.voided_at is not null and exists (
             select 1 from erp.order_lines x
              where x.legacy_key = excluded.coupang_order_item_id and x.legacy_voided_at = sale_records.voided_at)
           then null else sale_records.voided_at end
       returning id, (xmax = 0) as inserted, (voided_at is not null) as still_voided`,
      [r.productCostId, r.soldAt, r.quantity, r.sellingPrice, r.saleAmount, r.channel, r.key, resolveSaleShippingFee(r.shippingSource), r.couponDiscount],
    );
    if (res.rows.length === 0) continue; // 그 사이 옛 상품이 지워졌다
    out.upserted++;
    if (res.rows[0].inserted === true) out.inserted++;
    const stillVoided = res.rows[0].still_voided === true;
    if (stillVoided) out.warnings.push({ key: r.key, reason: 'voided_elsewhere' });
    await db.query(
      `update erp.order_lines set legacy_sale_id = $1, legacy_voided_at = case when $3::boolean then legacy_voided_at else null end
        where legacy_key = $2`,
      [res.rows[0].id, r.key, stillVoided],
    );
    const bare = bareWingKey(r.key);
    if (bare) {
      const v = await db.query(`update sale_records set voided_at = now() where coupang_order_item_id = $1 and voided_at is null`, [bare]);
      out.voided += v.rowCount ?? 0;
    }
  }
  if (plan.voidKeys.length > 0) {
    const v = await db.query(
      `update sale_records set voided_at = now() where coupang_order_item_id = any($1::text[]) and voided_at is null
       returning coupang_order_item_id as key`,
      [plan.voidKeys],
    );
    const keys = v.rows.map((x) => String(x.key));
    out.voided += keys.length;
    // 수집기가 무효화했다는 표시 — 같은 트랜잭션의 now()라 행의 voided_at과 같다. 다시 팔림이 되면 이 행만 되살린다
    if (keys.length > 0) {
      await db.query(`update erp.order_lines set legacy_voided_at = now() where legacy_key = any($1::text[])`, [keys]);
    }
  }
  return out;
}
