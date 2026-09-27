import { describe, it, expect } from 'vitest';
import { minViablePrice, marginVerdict, breakEvenPrice } from '@/lib/sourcing/coupang-price';

describe('minViablePrice', () => {
  it('마진율 30% 조건만 쓴다 — 실효원가 2,861원·소형이면 12,097원', () => {
    // 2,861 = ¥5 × 217 + 국제배송 추정 1,323 + 관세 8% + 수입부가세 (2026-09-27 앱 상수)
    expect(minViablePrice(2861, 'small')).toBe(12097);
  });

  it('breakEvenPrice보다 낮다 — 물류비 1.5배 조건이 빠졌기 때문', () => {
    expect(minViablePrice(2861, 'small')).toBeLessThan(breakEvenPrice(2861, 'small'));
  });
});

describe('marginVerdict', () => {
  it('핸들 토시 #3: 14,390원·실효원가 3,944원 → 4,533원·31.5%, 마진율 통과·물류비 1.5배 미달', () => {
    const v = marginVerdict(14390, 3944, 'small');
    expect(v.margin).toBe(4533);
    expect(v.marginRate).toBeCloseTo(0.315, 3);
    expect(v.passRate).toBe(true);
    expect(v.passAmount).toBe(false);
    expect(v.pass).toBe(false);
  });
});
