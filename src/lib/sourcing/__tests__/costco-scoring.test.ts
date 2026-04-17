/**
 * costco-scoring.test.ts
 * 코스트코 사입 모델 7개 항목 + 보너스 종합 점수 테스트
 */

import { describe, it, expect } from 'vitest';
import { calcCostcoScore, COSTCO_SCORE_MAX, type CostcoScoreInput } from '../costco-scoring';

// ─────────────────────────────────────────────────────────────────────────────
// 기본 입력 (정상 상품 — 각 항목 최고점 기준)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_INPUT: CostcoScoreInput = {
  legalStatus:    'safe',       // legalIp: 9
  ipRiskLevel:    'low',        // legalIp: +6 → 15
  vsMarket:       25,           // priceComp: 25
  categoryName:   '생활용품',   // csSafety: low → 10
  realMarginRate: 22,           // margin: 20
  weeklySales:    55,           // demand: s1=10
  dailyAvg:       8,            // demand: s2=5 → 15
  expectedStock:  10,           // turnover: 55/7×10 ≈ 3.6일 → 10
  stockStatus:    'inStock',    // supply: 5
  // baseTotal = 15+25+10+20+15+10+5 = 100
};

describe('calcCostcoScore — 기본 7개 항목 최고점', () => {
  it('모든 항목 최고점: base = 100', () => {
    const r = calcCostcoScore(BASE_INPUT);
    expect(r.legalIp).toBe(15);
    expect(r.priceComp).toBe(25);
    expect(r.csSafety).toBe(10);
    expect(r.margin).toBe(20);
    expect(r.demand).toBe(15);
    expect(r.turnover).toBe(10);
    expect(r.supply).toBe(5);
    expect(r.baseTotal).toBe(100);
  });

  it('title 없으면 보너스 0 → total = baseTotal', () => {
    const r = calcCostcoScore(BASE_INPUT);
    expect(r.maleBonus).toBe(0);
    expect(r.seasonBonus).toBe(0);
    expect(r.asteriskBonus).toBe(0);
    expect(r.total).toBe(r.baseTotal);
  });
});

describe('calcCostcoScore — 가격 경쟁력 (25점)', () => {
  it('vsMarket 20%+ → 25점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 20 }).priceComp).toBe(25);
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 30 }).priceComp).toBe(25);
  });

  it('vsMarket 10~19% → 19점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 10 }).priceComp).toBe(19);
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 19 }).priceComp).toBe(19);
  });

  it('vsMarket 5~9% → 13점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 5 }).priceComp).toBe(13);
  });

  it('vsMarket 0~4% → 6점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 0 }).priceComp).toBe(6);
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: 4 }).priceComp).toBe(6);
  });

  it('vsMarket 음수 (시장가 초과) → 0점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: -5 }).priceComp).toBe(0);
  });

  it('vsMarket null (데이터 없음) → 10점 (중립)', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, vsMarket: null }).priceComp).toBe(10);
  });
});

describe('calcCostcoScore — 마진 안전성 (20점)', () => {
  it('마진 20%+ → 20점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 20 }).margin).toBe(20);
  });

  it('마진 15~19% → 16점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 15 }).margin).toBe(16);
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 19 }).margin).toBe(16);
  });

  it('마진 10~14% → 11점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 10 }).margin).toBe(11);
  });

  it('마진 5~9% → 5점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 5 }).margin).toBe(5);
  });

  it('마진 0~4% → 0점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 3 }).margin).toBe(0);
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: 0 }).margin).toBe(0);
  });

  it('마진 null → 5점 (보수적 중립)', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, realMarginRate: null }).margin).toBe(5);
  });
});

describe('calcCostcoScore — 재고 회전 속도 (10점, 신규 항목)', () => {
  it('weeklySales=0 → 0점 (판매 없음)', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, weeklySales: 0, dailyAvg: 0 }).turnover).toBe(0);
  });

  it('2주 내 소진 (daysToSell ≤ 14) → 10점', () => {
    // expectedStock=10, weeklySales=10 → 10/10*7 = 7일
    const r = calcCostcoScore({ ...BASE_INPUT, weeklySales: 10, dailyAvg: 1.4, expectedStock: 10 });
    expect(r.turnover).toBe(10);
  });

  it('1개월 내 소진 (14 < days ≤ 30) → 8점', () => {
    // expectedStock=10, weeklySales=3 → 10/3*7 ≈ 23일
    const r = calcCostcoScore({ ...BASE_INPUT, weeklySales: 3, dailyAvg: 0.4, expectedStock: 10 });
    expect(r.turnover).toBe(8);
  });

  it('2개월 내 소진 (30 < days ≤ 60) → 5점', () => {
    // expectedStock=10, weeklySales=1 → 70일... 아니다 weeklySales=2 → 35일
    const r = calcCostcoScore({ ...BASE_INPUT, weeklySales: 2, dailyAvg: 0.3, expectedStock: 10 });
    expect(r.turnover).toBe(5);
  });

  it('3개월+ 적체 위험 → 0점', () => {
    // expectedStock=10, weeklySales=0.5 → 140일
    const r = calcCostcoScore({ ...BASE_INPUT, weeklySales: 0.5, dailyAvg: 0.07, expectedStock: 10 });
    expect(r.turnover).toBe(0);
  });
});

describe('calcCostcoScore — 공급 안정성 (5점)', () => {
  it('inStock → 5점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, stockStatus: 'inStock' }).supply).toBe(5);
  });

  it('lowStock → 2점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, stockStatus: 'lowStock' }).supply).toBe(2);
  });

  it('outOfStock → 0점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, stockStatus: 'outOfStock' }).supply).toBe(0);
  });
});

describe('calcCostcoScore — CS 안전성 (10점)', () => {
  it('생활용품 → low → 10점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, categoryName: '생활용품' }).csSafety).toBe(10);
  });

  it('화장품(건강·뷰티) → medium → 6점', () => {
    expect(calcCostcoScore({ ...BASE_INPUT, categoryName: '건강·뷰티' }).csSafety).toBe(6);
  });

  it('식품 → high → 0점 + blockedReason 설정', () => {
    const r = calcCostcoScore({ ...BASE_INPUT, categoryName: '식품' });
    expect(r.csSafety).toBe(0);
    expect(r.csRiskLevel).toBe('high');
    expect(r.blockedReason).toMatch(/고위험 CS/);
  });
});

describe('calcCostcoScore — 남성/시즌 보너스 + 별표 보너스 + 110점 캡', () => {
  it('남성 high 타겟: maleBonus = 5', () => {
    // 낚시 카테고리(+30) + 낚시 키워드(+10) = 40 → high
    const r = calcCostcoScore({
      ...BASE_INPUT,
      categoryName: '낚시',
      title: '낚시 낚싯대 루어세트',
    });
    expect(r.maleBonus).toBe(5);
    expect(r.maleTier).toBe('high');
  });

  it('별표 상품: asteriskBonus = 5', () => {
    const r = calcCostcoScore({ ...BASE_INPUT, hasAsterisk: true });
    expect(r.asteriskBonus).toBe(5);
    expect(r.total).toBe(Math.min(100 + 5, 110));
  });

  it('110점 캡: base 100 + bonus 합 > 110 → 총점 110', () => {
    // 크리스마스 시즌 활성 + 남성 high + 별표
    const r = calcCostcoScore({
      ...BASE_INPUT,
      categoryName: '낚시',
      title: '크리스마스 낚시대 선물세트 남성용',
      today: new Date(2026, 11, 10), // 크리스마스 시즌
      hasAsterisk: true,
    });
    expect(r.total).toBeLessThanOrEqual(110);
    // maleBonus(5) + seasonBonus(10) + asteriskBonus(5) = 20 → base+20 > 110 → cap 110
    expect(r.total).toBe(110);
  });

  it('법적 금지 키워드 → blockedReason 설정', () => {
    const r = calcCostcoScore({
      ...BASE_INPUT,
      title: '발렌타인 위스키 선물세트',
    });
    expect(r.blockedReason).toBe('법적 통신판매 금지 키워드 포함');
  });
});

describe('calcCostcoScore — 등급 반환', () => {
  it('100점 → S등급', () => {
    const r = calcCostcoScore(BASE_INPUT);
    expect(r.gradeInfo.grade).toBe('S');
  });

  it('낮은 점수 → D등급', () => {
    const r = calcCostcoScore({
      ...BASE_INPUT,
      vsMarket: -10,
      realMarginRate: 2,
      weeklySales: 0,
      dailyAvg: 0,
      stockStatus: 'outOfStock',
      legalStatus: 'blocked',
    });
    expect(['D', 'C']).toContain(r.gradeInfo.grade);
  });
});

describe('calcCostcoScore — 도매꾹과 가중치 차이 검증', () => {
  it('가격경쟁력 max = 25 (도매꾹 20보다 높음)', () => {
    expect(COSTCO_SCORE_MAX.priceComp).toBe(25);
  });

  it('마진 max = 20 (도매꾹 15보다 높음)', () => {
    expect(COSTCO_SCORE_MAX.margin).toBe(20);
  });

  it('법적IP max = 15 (도매꾹 20보다 낮음)', () => {
    expect(COSTCO_SCORE_MAX.legalIp).toBe(15);
  });

  it('CS안전성 max = 10 (도매꾹 15보다 낮음)', () => {
    expect(COSTCO_SCORE_MAX.csSafety).toBe(10);
  });

  it('재고회전 max = 10 (도매꾹에 없는 신규 항목)', () => {
    expect(COSTCO_SCORE_MAX.turnover).toBe(10);
  });

  it('공급안정성 max = 5 (도매꾹 10보다 낮음)', () => {
    expect(COSTCO_SCORE_MAX.supply).toBe(5);
  });

  it('모든 항목 합 = 100', () => {
    const total = Object.values(COSTCO_SCORE_MAX).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
