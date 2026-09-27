// src/lib/erp/orders/discounts.ts
// (1-C2b ②) 쿠팡(판매자배송·RG) 즉시할인 쿠폰을 주문마다 한 번 조회해 줄에 적는다. 네이버는 어댑터가 응답에서 바로 적는다.
// 순서: 할인을 모르는 줄(discount_checked_at is null · 시도 3회 미만 · 미결제·취소 제외)을 최근 결제순으로 주문 limitOrders개까지
//   → 주문마다 조회(트랜잭션 밖 — 주문당 수백 ms) → 한 트랜잭션[채널 잠금 7102 오름차순 → 줄 기록 · 실패 시도 횟수 → 옛 장부 coupon_discount].
// 배분(2026-09-27 B1 실측): 쿠폰 항목에 vendorItemId가 있으면 그 품목 줄(product_id)에 붙인다. 금액은 개당이다
//   (수량 2 주문도 discount 1650 한 항목 · Wing 최종구매가 12,450 = 14,100 − 1,650) → 줄 할인 = Σ(그 품목 항목) × 줄 수량.
//   vendorItemId가 없는 항목만 주문 줄 금액 비율로 나눈다(splitDiscount).
// 조회 실패한 주문은 discount_attempts + 1(다음 수집에서 다시). 3회째 실패면 discount_source = 'coupang_fms_error'로 닫는다 —
//   B1 실측에서 재시도해도 계속 500인 주문이 있었다. 닫힌 줄은 할인 모름(legacy-store가 coupon_discount를 건드리지 않는다).
// RATE(율) 쿠폰은 금액을 몰라 기록하지 않고 센다 — 사람이 본다.
import type { Connectable } from './collect';
import { CHANNEL_LOCK, LOCK_NS } from './collect';
import { syncLegacySales } from './legacy-store';
import type { OrderChannel } from './types';

export type CouponEntry = Record<string, unknown>;

/** 조회 실패가 이 횟수에 이르면 줄을 coupang_fms_error로 닫는다(마이그레이션 121 부분 색인과 같은 값) */
export const MAX_DISCOUNT_ATTEMPTS = 3;

const isAppliedPrice = (e: CouponEntry): boolean => e.status === 'APPLIED' && e.type === 'PRICE' && Number(e.discount) > 0;

export function couponTotal(entries: CouponEntry[]): { total: number; rate: boolean } {
  let total = 0;
  let rate = false;
  for (const e of entries) {
    if (e.status !== 'APPLIED') continue;
    if (e.type === 'RATE') { rate = true; continue; }
    if (isAppliedPrice(e)) total += Math.round(Number(e.discount));
  }
  return { total, rate };
}

export interface CouponByItem {
  /** vendorItemId → 개당 할인 합계(원) */
  byItem: Map<string, number>;
  /** vendorItemId가 없는 항목의 합계 — 주문 줄 금액 비율로 나눈다 */
  unassigned: number;
  rate: boolean;
}

/** PRICE · APPLIED 항목을 품목(vendorItemId)별로 모은다. 품목이 없는 항목은 unassigned */
export function couponByItem(entries: CouponEntry[]): CouponByItem {
  const out: CouponByItem = { byItem: new Map(), unassigned: 0, rate: false };
  for (const e of entries) {
    if (e.status !== 'APPLIED') continue;
    if (e.type === 'RATE') { out.rate = true; continue; }
    if (!isAppliedPrice(e)) continue;
    const d = Math.round(Number(e.discount));
    const vid = e.vendorItemId === undefined || e.vendorItemId === null || String(e.vendorItemId) === '' ? null : String(e.vendorItemId);
    if (vid === null) out.unassigned += d;
    else out.byItem.set(vid, (out.byItem.get(vid) ?? 0) + d);
  }
  return out;
}

/** 주문 할인을 줄 금액 비율로 나눈다. 원 단위 내림, 남는 원은 마지막 줄. 금액이 전부 0이면 균등 */
export function splitDiscount(total: number, lines: { id: number; amount: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const sum = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  let used = 0;
  lines.forEach((l, i) => {
    if (i === lines.length - 1) { out.set(l.id, total - used); return; }
    const share = sum > 0 ? Math.floor((total * Math.max(0, l.amount)) / sum) : Math.floor(total / lines.length);
    out.set(l.id, share);
    used += share;
  });
  return out;
}

export interface DiscountLine {
  id: number;
  amount: number;
  /** 쿠팡 vendorItemId(= order_lines.product_id) */
  productId: string;
  /** 채널 판매 단위 수량(order_lines.order_qty) */
  qty: number;
}

/**
 * 줄 할인 = Σ(그 품목 쿠폰, 개당) × 줄 수량 + 품목 없는 쿠폰의 금액 비율 몫.
 * 조회 대상 줄에 없는 품목의 쿠폰(취소됐거나 이미 확인한 줄)은 다른 줄에 옮기지 않는다.
 */
export function lineDiscounts(c: CouponByItem, lines: DiscountLine[]): Map<number, number> {
  const split = splitDiscount(c.unassigned, lines);
  return new Map(lines.map((l) => [l.id, (c.byItem.get(l.productId) ?? 0) * l.qty + (split.get(l.id) ?? 0)]));
}

export interface EnrichResult {
  orders: number;
  /** 할인을 기록한 줄 */
  checked: number;
  /** 그중 할인이 0보다 큰 줄 */
  discounted: number;
  /** 조회 실패한 주문 */
  errors: number;
  /** 그중 3회째 실패로 coupang_fms_error로 닫은 주문 */
  errorsClosed: number;
  /** RATE 쿠폰이라 기록하지 않은 주문 */
  rate: number;
}

interface TodoLine extends DiscountLine {
  key: string | null;
}

export async function enrichCoupangDiscounts(
  pool: Connectable,
  fetchCoupons: (orderId: string) => Promise<CouponEntry[]>,
  opts: { limitOrders: number },
): Promise<EnrichResult> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `with todo as (
         select o.id as order_pk, max(l.paid_at) as p from erp.order_lines l join erp.orders o on o.id = l.order_id
          where l.channel in ('coupang_wing', 'coupang_rg') and l.discount_checked_at is null and l.discount_attempts < ${MAX_DISCOUNT_ATTEMPTS}
            and l.status not in ('unpaid', 'canceled')
          group by o.id order by max(l.paid_at) desc nulls last limit $1)
       select l.id, o.id as order_pk, l.channel, o.external_order_id, l.amount, l.product_id, l.order_qty, l.legacy_key
         from todo t join erp.orders o on o.id = t.order_pk join erp.order_lines l on l.order_id = o.id
        where l.discount_checked_at is null and l.discount_attempts < ${MAX_DISCOUNT_ATTEMPTS} and l.status not in ('unpaid', 'canceled')
        order by t.p desc nulls last, o.id, l.id`,
      [opts.limitOrders],
    );
    const byOrder = new Map<string, { orderId: string; channel: OrderChannel; lines: TodoLine[] }>();
    for (const r of rows) {
      const k = String(r.order_pk);
      const g = byOrder.get(k) ?? { orderId: String(r.external_order_id), channel: r.channel as OrderChannel, lines: [] };
      g.lines.push({
        id: Number(r.id), amount: Number(r.amount), productId: String(r.product_id ?? ''), qty: Number(r.order_qty),
        key: typeof r.legacy_key === 'string' ? r.legacy_key : null,
      });
      byOrder.set(k, g);
    }
    const out: EnrichResult = { orders: byOrder.size, checked: 0, discounted: 0, errors: 0, errorsClosed: 0, rate: 0 };
    const writes: { channel: OrderChannel; id: number; amount: number; key: string | null }[] = [];
    const failed: { channel: OrderChannel; ids: number[] }[] = [];
    for (const g of byOrder.values()) {
      let entries: CouponEntry[];
      try {
        entries = await fetchCoupons(g.orderId);
      } catch {
        out.errors++;
        failed.push({ channel: g.channel, ids: g.lines.map((l) => l.id) });
        continue;
      }
      const coupons = couponByItem(entries);
      if (coupons.rate) { out.rate++; continue; }
      const disc = lineDiscounts(coupons, g.lines);
      for (const l of g.lines) writes.push({ channel: g.channel, id: l.id, amount: disc.get(l.id) ?? 0, key: l.key });
    }
    if (writes.length === 0 && failed.length === 0) return out;
    await c.query('BEGIN');
    try {
      const channels = new Set([...writes.map((w) => w.channel), ...failed.map((f) => f.channel)]);
      for (const ch of [...channels].sort((a, b) => CHANNEL_LOCK[a] - CHANNEL_LOCK[b])) {
        await c.query('select pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, CHANNEL_LOCK[ch]]);
      }
      for (const w of writes) {
        const res = await c.query(
          `update erp.order_lines set discount_amount = $2, discount_source = 'coupang_fms', discount_checked_at = now(), updated_at = now()
            where id = $1 and discount_checked_at is null`,
          [w.id, w.amount],
        );
        if ((res.rowCount ?? 0) > 0) { out.checked++; if (w.amount > 0) out.discounted++; }
      }
      for (const f of failed) {
        // 시도 횟수 + 1 — 3회째면 할인 모름으로 닫는다(discount_amount 0 · 출처 coupang_fms_error). 잠금 사이에 확인된 줄은 건드리지 않는다
        const { rows: att } = await c.query(
          `update erp.order_lines set discount_attempts = discount_attempts + 1,
                  discount_checked_at = case when discount_attempts + 1 >= ${MAX_DISCOUNT_ATTEMPTS} then now() else null end,
                  discount_source = case when discount_attempts + 1 >= ${MAX_DISCOUNT_ATTEMPTS} then 'coupang_fms_error' else discount_source end,
                  discount_amount = case when discount_attempts + 1 >= ${MAX_DISCOUNT_ATTEMPTS} then 0 else discount_amount end,
                  updated_at = now()
            where id = any($1::bigint[]) and discount_checked_at is null
            returning id, (discount_checked_at is not null) as closed`,
          [f.ids],
        );
        if (att.some((r) => r.closed === true)) out.errorsClosed++;
      }
      const keys = [...new Set(writes.map((w) => w.key).filter((k): k is string => k !== null))];
      // 실패·닫힘 줄은 할인 모름 그대로라 옛 장부를 다시 계산할 것이 없다
      if (keys.length > 0) await syncLegacySales(c, keys);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
    return out;
  } finally {
    c.release();
  }
}
