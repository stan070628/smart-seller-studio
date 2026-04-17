/**
 * costco-pricing.test.ts
 * 코스트코 사입 모델 가격 계산 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  calcCostcoPrice,
  calcRecommendedPrice,
  compareCostcoWithMarket,
  getPriceCompStatus,
  getShippingCost,
  PACKING_COST,
} from '../costco-pricing';
import { CHANNEL_FEE, VAT_RATE } from '../shared/channel-policy';

describe('getShippingCost', () => {
  it('null/0 → 3,500원', () => {
    expect(getShippingCost(null)).toBe(3500);
    expect(getShippingCost(0)).toBe(3500);
  });

  it('< 2kg → 3,500원', () => {
    expect(getShippingCost(1.5)).toBe(3500);
  });

  it('2~5kg → 4,500원', () => {
    expect(getShippingCost(2)).toBe(4500);
    expect(getShippingCost(4.9)).toBe(4500);
  });

  it('5~10kg → 7,000원', () => {
    expect(getShippingCost(5)).toBe(7000);
    expect(getShippingCost(9.9)).toBe(7000);
  });

  it('10kg 이상 → 9,000원', () => {
    expect(getShippingCost(10)).toBe(9000);
    expect(getShippingCost(20)).toBe(9000);
  });
});

describe('calcCostcoPrice — 기본 계산', () => {
  it('TC-01: 건강·뷰티, 네이버, packQty=6 — 추천가·개당 단가·순이익 계산', () => {
    // buyPrice: 23990, category: '건강·뷰티' (targetRate: 0.20), channel: naver
    // shipping: 3500 (null), packing: 500
    // totalCost = 23990 + 3500 + 500 = 27990
    // targetProfit = max(27990 * 0.20, 2000) = 5598
    // deductionRate = 1 - 0.06 - 10/110 ≈ 0.849
    // raw = (27990 + 5598) / 0.849 ≈ 39556 → 100원 단위 반올림
    const result = calcCostcoPrice({
      buyPrice: 23990,
      packQty: 6,
      categoryName: '건강·뷰티',
      channel: 'naver',
    });

    expect(result.recommendedPrice).toBeGreaterThan(30000);
    expect(result.recommendedPrice).toBeLessThan(45000);
    expect(result.recommendedPrice % 100).toBe(0); // 100원 단위
    expect(result.perUnitPrice).toBeGreaterThan(0);
    expect(result.perUnitPrice % 10).toBe(0);      // 10원 단위
    expect(result.netProfit).toBeGreaterThan(0);
    expect(result.totalCost).toBe(23990 + 3500 + PACKING_COST);
  });

  it('perUnitPrice = recommendedPrice / packQty (10원 단위)', () => {
    const r = calcCostcoPrice({ buyPrice: 20000, packQty: 6, categoryName: '생활용품', channel: 'naver' });
    expect(r.perUnitPrice).toBe(Math.round(r.recommendedPrice / 6 / 10) * 10);
  });

  it('packQty=1 이면 perUnitPrice ≈ recommendedPrice', () => {
    const r = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '식품', channel: 'naver' });
    // 10원 단위 반올림이라 완전히 같지 않을 수 있음
    expect(Math.abs(r.perUnitPrice - r.recommendedPrice)).toBeLessThan(10);
  });

  it('쿠팡은 수수료 높아 추천가 > 네이버', () => {
    const base = { buyPrice: 20000, packQty: 1, categoryName: '생활용품' };
    const naver   = calcCostcoPrice({ ...base, channel: 'naver' });
    const coupang = calcCostcoPrice({ ...base, channel: 'coupang' });
    expect(coupang.recommendedPrice).toBeGreaterThan(naver.recommendedPrice);
  });

  it('무거운 상품 (5kg): 배송비 7,000원 반영 (5kg = 5~10kg 구간)', () => {
    // getShippingCost: < 5kg → 4500, < 10kg → 7000
    // weightKg=5 → 5 < 5 false → 5 < 10 true → 7000
    const r = calcCostcoPrice({ buyPrice: 30000, packQty: 1, categoryName: '가구·침구', channel: 'naver', weightKg: 5 });
    expect(r.shippingCost).toBe(7000);
    expect(r.totalCost).toBe(30000 + 7000 + PACKING_COST);
  });

  it('1.4배 로직 미사용 검증 — targetProfit은 총원가×목표마진율', () => {
    const buyPrice = 10000;
    const r = calcCostcoPrice({ buyPrice, packQty: 1, categoryName: '식품', channel: 'naver' });
    // 1.4배 라면 recommendedPrice ≈ 10000 * 1.4 = 14000 수준
    // 식품 목표마진 13%, totalCost=10000+3500+500=14000, targetProfit=14000*0.13=1820
    // → recommendedPrice ≈ (14000+1820)/(1-0.06-10/110) ≈ 18600원
    // 1.4배(14000)보다 훨씬 높음 — 즉, 실질 마진을 보장하는 구조
    expect(r.recommendedPrice).toBeGreaterThan(buyPrice * 1.4);
  });
});

describe('calcCostcoPrice — 시장가 비교', () => {
  it('vsMarket 양수 = 추천가가 시장가보다 저렴', () => {
    const r = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '생활용품', channel: 'naver', marketPrice: 40000 });
    expect(r.vsMarket).not.toBeNull();
    expect(r.vsMarket!).toBeGreaterThan(0);
    expect(r.isOverprice).toBe(false);
  });

  it('vsMarket 음수 = 추천가가 시장가 초과', () => {
    const r = calcCostcoPrice({ buyPrice: 35000, packQty: 1, categoryName: '생활용품', channel: 'naver', marketPrice: 35000 });
    // totalCost=35000+3500+500=39000, 추천가 > 35000이므로 isOverprice
    expect(r.isOverprice).toBe(true);
    expect(r.vsMarket!).toBeLessThan(0);
  });

  it('marketPrice null → vsMarket null', () => {
    const r = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '식품', channel: 'naver' });
    expect(r.vsMarket).toBeNull();
    expect(r.isOverprice).toBe(false);
  });
});

describe('calcCostcoPrice — 순이익률 검증', () => {
  it('순이익률은 shared/channel-policy 공식과 일치', () => {
    const r = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '생활용품', channel: 'naver' });
    // realMarginRate = netProfit / recommendedPrice * 100
    const expected = r.netProfit / r.recommendedPrice * 100;
    expect(Math.abs(r.realMarginRate - expected)).toBeLessThan(0.5);
  });

  it('순이익 > 0 (정상 상품)', () => {
    const r = calcCostcoPrice({ buyPrice: 10000, packQty: 1, categoryName: '건강·뷰티', channel: 'naver' });
    expect(r.netProfit).toBeGreaterThan(0);
  });
});

describe('getPriceCompStatus', () => {
  it('null → 데이터 없음', () => {
    expect(getPriceCompStatus(null)).toBe('데이터 없음');
  });

  it('15%+ → 강력한 경쟁력', () => {
    expect(getPriceCompStatus(15)).toBe('강력한 경쟁력');
    expect(getPriceCompStatus(30)).toBe('강력한 경쟁력');
  });

  it('10~14% → 경쟁력 보통', () => {
    expect(getPriceCompStatus(10)).toBe('경쟁력 보통');
    expect(getPriceCompStatus(14)).toBe('경쟁력 보통');
  });

  it('0~9% → 시장가 근접', () => {
    expect(getPriceCompStatus(0)).toBe('시장가 근접');
    expect(getPriceCompStatus(9)).toBe('시장가 근접');
  });

  it('음수 → 시장가 초과', () => {
    expect(getPriceCompStatus(-1)).toBe('시장가 초과');
    expect(getPriceCompStatus(-20)).toBe('시장가 초과');
  });
});

describe('compareCostcoWithMarket', () => {
  it('양 채널 추천가 + 경쟁력 상태 동시 반환', () => {
    const r = compareCostcoWithMarket(23990, 6, '건강·뷰티', null, 50000, 55000);
    expect(r.naverResult.channel).toBe('naver');
    expect(r.coupangResult.channel).toBe('coupang');
    expect(r.naverStatus).not.toBe('데이터 없음');
    expect(r.coupangStatus).not.toBe('데이터 없음');
  });

  it('시장가 없으면 status = 데이터 없음', () => {
    const r = compareCostcoWithMarket(23990, 1, '식품', null, null, null);
    expect(r.naverStatus).toBe('데이터 없음');
    expect(r.coupangStatus).toBe('데이터 없음');
  });

  it('betterChannel = 순이익률 더 높은 채널 (일반적으로 naver)', () => {
    // 네이버 수수료 6% < 쿠팡 11% → 동일 시장가라면 네이버 마진 유리
    const r = compareCostcoWithMarket(20000, 1, '생활용품', null, 40000, 40000);
    expect(r.betterChannel).toBe('naver');
  });
});

describe('calcRecommendedPrice — 하위 호환 래퍼', () => {
  it('calcCostcoPrice(packQty=1) 결과와 동일', () => {
    const legacy = calcRecommendedPrice(20000, '생활용품', 'naver', null, 40000);
    const v2     = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '생활용품', channel: 'naver', marketPrice: 40000 });
    expect(legacy.recommendedPrice).toBe(v2.recommendedPrice);
    expect(legacy.netProfit).toBe(v2.netProfit);
    expect(legacy.vsMarket).toBe(v2.vsMarket);
  });
});
