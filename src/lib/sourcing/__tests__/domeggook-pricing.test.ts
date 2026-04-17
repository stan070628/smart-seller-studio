/**
 * domeggook-pricing.test.ts
 * MOQ 기반 드롭쉬핑 가격 계산 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  calcBundleMinPrice,
  calcPerUnitPrice,
  calcPriceGapRate,
  getPriceCompStatus,
  getMoqStrategy,
  compareWithMarket,
  calcAllScenarios,
} from '../domeggook-pricing';

// DEDUCTION_RATE = 1 - 0.10 - 0.10 = 0.80

describe('getMoqStrategy', () => {
  it('MOQ 1 → single', () => {
    expect(getMoqStrategy(1)).toBe('single');
  });

  it('MOQ 2 → 1+1', () => {
    expect(getMoqStrategy(2)).toBe('1+1');
  });

  it('MOQ 3 → 2+1', () => {
    expect(getMoqStrategy(3)).toBe('2+1');
  });

  it('MOQ 4 → null (드롭쉬핑 불가)', () => {
    expect(getMoqStrategy(4)).toBeNull();
  });

  it('MOQ 10 → null', () => {
    expect(getMoqStrategy(10)).toBeNull();
  });

  it('MOQ 0 → null', () => {
    expect(getMoqStrategy(0)).toBeNull();
  });
});

describe('calcBundleMinPrice', () => {
  it('MOQ 1, 무료배송: ceil(10000 / 0.8) = 12500', () => {
    expect(calcBundleMinPrice({ priceDome: 10000, deliWho: 'S', deliFee: 3000, moq: 1 })).toBe(12500);
  });

  it('MOQ 1, 구매자 배송비 3000원: ceil((10000 + 3000) / 0.8) = 16250', () => {
    expect(calcBundleMinPrice({ priceDome: 10000, deliWho: 'B', deliFee: 3000, moq: 1 })).toBe(16250);
  });

  it('MOQ 2, 무료배송: ceil(10000 * 2 / 0.8) = 25000', () => {
    expect(calcBundleMinPrice({ priceDome: 10000, deliWho: 'S', deliFee: null, moq: 2 })).toBe(25000);
  });

  it('MOQ 3, 배송비 3000원: ceil((8000 * 3 + 3000) / 0.8) = 33750', () => {
    expect(calcBundleMinPrice({ priceDome: 8000, deliWho: 'P', deliFee: 3000, moq: 3 })).toBe(33750);
  });

  it('deliFee null 처리: ceil((10000 + 0) / 0.8)', () => {
    expect(calcBundleMinPrice({ priceDome: 10000, deliWho: null, deliFee: null, moq: 1 })).toBe(12500);
  });
});

describe('calcPerUnitPrice', () => {
  it('MOQ 1: 12500 / 1 = 12500', () => {
    expect(calcPerUnitPrice(12500, 1)).toBe(12500);
  });

  it('MOQ 2: 25000 / 2 = 12500', () => {
    expect(calcPerUnitPrice(25000, 2)).toBe(12500);
  });

  it('MOQ 3, 소수점 올림: ceil(33750 / 3) = 11250', () => {
    expect(calcPerUnitPrice(33750, 3)).toBe(11250);
  });

  it('나누어 떨어지지 않으면 올림: ceil(10001 / 3) = 3334', () => {
    expect(calcPerUnitPrice(10001, 3)).toBe(3334);
  });
});

describe('calcPriceGapRate', () => {
  it('perUnitPrice 12500, 시장가 20000: (20000 - 12500) / 20000 * 100 = 37.5', () => {
    expect(calcPriceGapRate(12500, 20000)).toBe(37.5);
  });

  it('perUnitPrice === 시장가: 격차율 0', () => {
    expect(calcPriceGapRate(20000, 20000)).toBe(0);
  });

  it('perUnitPrice > 시장가: 음수 반환 (시장가 초과)', () => {
    expect(calcPriceGapRate(25000, 20000)).toBe(-25);
  });
});

describe('getPriceCompStatus', () => {
  it('null → 데이터 없음', () => {
    expect(getPriceCompStatus(null)).toBe('데이터 없음');
  });

  it('30% 이상 → 강력한 경쟁력', () => {
    expect(getPriceCompStatus(30)).toBe('강력한 경쟁력');
    expect(getPriceCompStatus(50)).toBe('강력한 경쟁력');
  });

  it('20~29% → 경쟁력 보통', () => {
    expect(getPriceCompStatus(20)).toBe('경쟁력 보통');
    expect(getPriceCompStatus(29)).toBe('경쟁력 보통');
  });

  it('5~19% → 시장가 근접', () => {
    expect(getPriceCompStatus(5)).toBe('시장가 근접');
    expect(getPriceCompStatus(15)).toBe('시장가 근접');
  });

  it('0~4% → 시장가 근접', () => {
    expect(getPriceCompStatus(0)).toBe('시장가 근접');
    expect(getPriceCompStatus(4)).toBe('시장가 근접');
  });

  it('음수 → 시장가 초과', () => {
    expect(getPriceCompStatus(-1)).toBe('시장가 초과');
    expect(getPriceCompStatus(-25)).toBe('시장가 초과');
  });
});

describe('compareWithMarket', () => {
  it('TC-01: MOQ 1, 단품, 강력한 경쟁력', () => {
    // priceDome: 10000, MOQ: 1, 무료배송, 시장가 25000
    // bundleMinPrice = ceil(10000 / 0.8) = 12500
    // perUnitPrice = 12500
    // priceGapRate = (25000 - 12500) / 25000 * 100 = 50%
    const result = compareWithMarket(10000, 1, 'S', null, 25000);
    expect(result.bundleMinPrice).toBe(12500);
    expect(result.perUnitPrice).toBe(12500);
    expect(result.priceGapRate).toBe(50);
    expect(result.status).toBe('강력한 경쟁력');
  });

  it('TC-02: MOQ 3, 2+1 묶음 perUnitPrice 기준 비교', () => {
    // priceDome: 8000, MOQ: 3, 배송비 3000, 시장가 15000
    // bundleMinPrice = ceil((8000*3 + 3000) / 0.8) = ceil(27000/0.8) = ceil(33750) = 33750
    // perUnitPrice = ceil(33750 / 3) = 11250
    // priceGapRate = (15000 - 11250) / 15000 * 100 = 25%
    const result = compareWithMarket(8000, 3, 'P', 3000, 15000);
    expect(result.bundleMinPrice).toBe(33750);
    expect(result.perUnitPrice).toBe(11250);
    expect(result.priceGapRate).toBe(25);
    expect(result.status).toBe('경쟁력 보통');
  });

  it('TC-04: 시장가 초과 (드롭쉬핑 단가 > 시장가)', () => {
    // priceDome: 20000, MOQ: 1, 무료배송, 시장가 22000
    // bundleMinPrice = ceil(20000 / 0.8) = 25000
    // perUnitPrice = 25000
    // priceGapRate = (22000 - 25000) / 22000 * 100 ≈ -13.6%
    const result = compareWithMarket(20000, 1, 'S', null, 22000);
    expect(result.perUnitPrice).toBe(25000);
    expect(result.priceGapRate).toBeLessThan(0);
    expect(result.status).toBe('시장가 초과');
  });

  it('시장가 null → 데이터 없음', () => {
    const result = compareWithMarket(10000, 1, 'S', null, null);
    expect(result.priceGapRate).toBeNull();
    expect(result.marginRate).toBeNull();
    expect(result.status).toBe('데이터 없음');
  });
});

describe('calcAllScenarios', () => {
  it('TC-03: MOQ 1~3 시나리오 비교 — 최적 isRecommended 마킹', () => {
    // priceDome: 10000, 무료배송, 시장가 20000
    // MOQ1: bundleMinPrice=12500, perUnit=12500, gap=37.5% ← 최대
    // MOQ2: bundleMinPrice=25000, perUnit=12500, gap=37.5%
    // MOQ3: bundleMinPrice=37500, perUnit=12500, gap=37.5%
    const scenarios = calcAllScenarios(10000, 'S', null, 20000);
    expect(scenarios).toHaveLength(3);
    expect(scenarios[0].moq).toBe(1);
    expect(scenarios[0].strategy).toBe('single');
    expect(scenarios[1].strategy).toBe('1+1');
    expect(scenarios[2].strategy).toBe('2+1');

    // 동률일 경우 첫 번째 시나리오에 isRecommended
    const recommended = scenarios.filter((s) => s.isRecommended);
    expect(recommended).toHaveLength(1);
  });

  it('배송비 있을 때 MOQ 높을수록 개당 단가 유리', () => {
    // priceDome: 5000, 배송비 3000, 시장가 10000
    // MOQ1: (5000+3000)/0.8 = 10000, perUnit=10000, gap=0%
    // MOQ2: (10000+3000)/0.8 = 16250, perUnit=8125, gap=18.75%
    // MOQ3: (15000+3000)/0.8 = 22500, perUnit=7500, gap=25% ← 최대
    const scenarios = calcAllScenarios(5000, 'P', 3000, 10000);
    expect(scenarios[2].isRecommended).toBe(true);
    expect(scenarios[2].perUnitPrice).toBeLessThan(scenarios[1].perUnitPrice!);
  });

  it('시장가 null이면 모든 시나리오 status = 데이터 없음', () => {
    const scenarios = calcAllScenarios(10000, 'S', null, null);
    scenarios.forEach((s) => {
      expect(s.priceCompStatus).toBe('데이터 없음');
      expect(s.priceGapRate).toBeNull();
      expect(s.isRecommended).toBeUndefined();
    });
  });
});
