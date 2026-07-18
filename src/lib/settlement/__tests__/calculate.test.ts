import { describe, it, expect } from 'vitest';
import { computeDailySettlement } from '../calculate';

const noEntries: never[] = [];
const noExpenses: never[] = [];

describe('computeDailySettlement', () => {
  it('매출은 sale_amount 우선, 수수료는 (매출-쿠폰)×수수료율 건별 반올림', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 30000, selling_price: 30000, quantity: 2, coupon_discount: 0, shipping_fee: 3500, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    const r = rows[0];
    expect(r.date).toBe('2026-07-16');
    expect(r.revenue).toBe(30000);
    expect(r.platformFee).toBe(3000);
    expect(r.parcelFee).toBe(3500);
    expect(r.netProfit).toBe(23500);
  });

  it('sale_amount 없으면 selling_price × quantity 폴백', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: null, selling_price: 20000, quantity: 3, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows[0].revenue).toBe(60000);
    expect(rows[0].platformFee).toBe(6000);
  });

  it('쿠폰은 수수료 계산 전 차감 (건별)', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 40000, selling_price: 40000, quantity: 2, coupon_discount: 6000, shipping_fee: 0, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows[0].couponDiscount).toBe(6000);
    expect(rows[0].platformFee).toBe(3400);
    expect(rows[0].netProfit).toBe(40000 - 6000 - 3400);
  });

  it('상품별 수수료율이 다르면 건별 계산 후 합산', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.108 },
      { sold_at: '2026-07-16', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.05 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows[0].platformFee).toBe(1580);
    expect(rows[0].revenue).toBe(20000);
  });

  it('매입은 received_at 기준 quantity×(unit_cost+배송비들), 소수 수량 최종 반올림', () => {
    const entries = [
      { received_at: '2026-07-15', quantity: 2.5, unit_cost: 10000, unit_shipping_fee: 800, unit_rg_shipping_fee: 200 },
    ];
    const { rows } = computeDailySettlement([], entries, noExpenses);
    expect(rows[0].date).toBe('2026-07-15');
    expect(rows[0].purchase).toBe(27500);
    expect(rows[0].netProfit).toBe(-27500);
  });

  it('수동 비용: 광고비·박스비 차감, 택배비 정산차 가산(음수 가능)', () => {
    const expenses = [
      { expense_date: '2026-07-16', ad_spend: 85000, box_cost: 120000, parcel_adjustment: -5000 },
    ];
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 300000, selling_price: 300000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, expenses);
    expect(rows[0].adSpend).toBe(85000);
    expect(rows[0].boxCost).toBe(120000);
    expect(rows[0].parcelAdjustment).toBe(-5000);
    expect(rows[0].netProfit).toBe(90000);
  });

  it('여러 날짜를 날짜 내림차순으로, monthTotal은 전체 합산', () => {
    const sales = [
      { sold_at: '2026-07-15', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
      { sold_at: '2026-07-16', sale_amount: 20000, selling_price: 20000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
    ];
    const { rows, monthTotal } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows.map((r) => r.date)).toEqual(['2026-07-16', '2026-07-15']);
    expect(monthTotal.revenue).toBe(30000);
    expect(monthTotal.netProfit).toBe(30000);
  });

  it('빈 입력 → 빈 rows, monthTotal 0', () => {
    const { rows, monthTotal } = computeDailySettlement([], [], []);
    expect(rows).toHaveLength(0);
    expect(monthTotal.revenue).toBe(0);
    expect(monthTotal.netProfit).toBe(0);
  });
});
