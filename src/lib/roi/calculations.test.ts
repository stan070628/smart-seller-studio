// src/lib/roi/calculations.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
  calcStockTurnover,
  calcRequiredRevenue,
} from './calculations';

describe('calcMargin', () => {
  it('마진액 = 판매가 - 원가 - 수수료 - 배송비 - 매출세액', () => {
    // 9,900 − 4,200 − 990 − 2,500 − 149(매출세액 1.5%) = 2,061
    expect(calcMargin({ sellingPrice: 9900, costPrice: 4200, feeRate: 0.10, deliveryFee: 2500 })).toBe(2061);
  });
  it('수수료율 0이어도 매출세액은 차감된다', () => {
    // 10,000 − 3,000 − 150 = 6,850. 매출세액은 수수료와 무관하게 판매로 발생한다.
    expect(calcMargin({ sellingPrice: 10000, costPrice: 3000, feeRate: 0 })).toBe(6850);
  });
  it('판매자 부담 할인은 정산 기준가를 낮추고, 수수료도 할인 후 금액에 붙는다', () => {
    // 실측(2026-08-13): 12,800원 상품에 SELLER_FREE_EXPOSURE 680원이 걸려
    // 수수료가 12,120원의 10%인 1,212원으로 부과됐다.
    const withDiscount = calcMargin({
      sellingPrice: 12800, costPrice: 0, feeRate: 0.10, sellerDiscount: 680,
    });
    // 12,120 − 1,212 − 182 = 10,726
    expect(withDiscount).toBe(10726);
  });
  it('할인이 마진에 미치는 영향은 할인액보다 크다', () => {
    // 할인 680원은 정산가·수수료·매출세액을 함께 끌어내려 실제 손실이 680원을 넘지 않는다 —
    // 수수료와 세액이 같이 줄기 때문이다. 방향만 검증한다.
    const base = calcMargin({ sellingPrice: 12800, costPrice: 5000, feeRate: 0.11 });
    const discounted = calcMargin({ sellingPrice: 12800, costPrice: 5000, feeRate: 0.11, sellerDiscount: 680 });
    expect(base - discounted).toBeGreaterThan(0);
    expect(base - discounted).toBeLessThan(680);
  });
});

describe('calcBreakevenRoas', () => {
  it('간이과세자: (판매가 / 마진액) * 100', () => {
    expect(calcBreakevenRoas(9900, 2061)).toBeCloseTo(480, 0);
  });
  it('마진액 0이면 Infinity 반환', () => {
    expect(calcBreakevenRoas(9900, 0)).toBe(Infinity);
  });
});

describe('calcAdjustedRoas', () => {
  it('보정 ROAS = (attributed_sales - cancelled) / adSpend * 100', () => {
    expect(calcAdjustedRoas(500000, 50000, 100000)).toBe(450);
  });
  it('광고비 0이면 Infinity', () => {
    expect(calcAdjustedRoas(500000, 50000, 0)).toBe(Infinity);
  });
});

describe('isWinner', () => {
  it('4개 모두 충족하면 winner', () => {
    expect(isWinner(150, 2.0, 300, 10)).toBe('winner');
  });
  it('3개 충족하면 watch', () => {
    expect(isWinner(80, 2.0, 300, 10)).toBe('watch');
  });
  it('2개 이하면 normal', () => {
    expect(isWinner(50, 1.0, 200, 3)).toBe('normal');
  });
  it('경계값: 정확히 기준값이면 충족', () => {
    expect(isWinner(100, 1.5, 250, 5)).toBe('winner');
  });
  it('2개 충족하면 normal', () => {
    // clicks❌(50<100), conversionRate❌(1.0<1.5), roas✅(300≥250), salesCount✅(10≥5) → 2개 충족
    expect(isWinner(50, 1.0, 300, 10)).toBe('normal');
  });
});

describe('calcStockTurnover', () => {
  it('7일 미만이면 danger', () => {
    const result = calcStockTurnover(5, 1);
    expect(result).toEqual({ days: 5, status: 'danger' });
  });
  it('7~14일이면 warning', () => {
    const result = calcStockTurnover(10, 1);
    expect(result).toEqual({ days: 10, status: 'warning' });
  });
  it('15일 이상이면 ok', () => {
    const result = calcStockTurnover(30, 1);
    expect(result).toEqual({ days: 30, status: 'ok' });
  });
  it('일평균 0이면 days Infinity, status ok', () => {
    const result = calcStockTurnover(100, 0);
    expect(result.status).toBe('ok');
    expect(result.days).toBe(Infinity);
  });
});

describe('calcRequiredRevenue', () => {
  it('500만원 / 0.3 = 16,666,667', () => {
    expect(Math.round(calcRequiredRevenue(5000000, 0.3))).toBe(16666667);
  });
  it('마진율 0이면 Infinity', () => {
    expect(calcRequiredRevenue(5000000, 0)).toBe(Infinity);
  });
});
