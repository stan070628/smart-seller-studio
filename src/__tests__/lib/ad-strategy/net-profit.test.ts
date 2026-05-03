import { describe, it, expect } from 'vitest';
import {
  calcNetProfit,
  calcBreakEvenRoas,
  calcMarginPerUnit,
} from '@/lib/ad-strategy/net-profit';

describe('calcMarginPerUnit', () => {
  it('판매가 30000, 원가 18000, 수수료 10.8%', () => {
    // 30000 × (1 - 0.108) - 18000 = 26760 - 18000 = 8760
    expect(calcMarginPerUnit(30000, 18000, 0.108)).toBe(8760);
  });

  it('원가가 판매가보다 크면 음수 마진', () => {
    expect(calcMarginPerUnit(10000, 12000, 0.108)).toBeLessThan(0);
  });
});

describe('calcBreakEvenRoas', () => {
  it('판매가 30000, 마진 8760 → (30000/8760)×1.1×100 ≈ 376', () => {
    const result = calcBreakEvenRoas(30000, 8760);
    expect(result).toBeCloseTo(376.7, 0);
  });

  it('마진 0이면 Infinity', () => {
    expect(calcBreakEvenRoas(30000, 0)).toBe(Infinity);
  });
});

describe('calcNetProfit', () => {
  it('월 판매 10건, 월 광고비 5000원, 마진 8760원/건', () => {
    // 건당 광고비 = 5000/10 = 500
    // 건당 순이익 = 8760 - 500 = 8260
    // 월 순이익 = 8260 × 10 = 82600
    const result = calcNetProfit({
      monthlySales: 10,
      monthlyAdSpend: 5000,
      marginPerUnit: 8760,
    });
    expect(result.perUnit).toBe(8260);
    expect(result.monthly).toBe(82600);
  });

  it('판매량 0이면 광고비 계산 불가 → perUnit = marginPerUnit', () => {
    const result = calcNetProfit({
      monthlySales: 0,
      monthlyAdSpend: 5000,
      marginPerUnit: 8760,
    });
    expect(result.perUnit).toBe(8760);
    expect(result.monthly).toBe(0);
  });
});
