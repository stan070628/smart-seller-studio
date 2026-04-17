/**
 * domeggook-scoring.test.ts
 * 드롭쉬핑 7개 항목 종합 점수 + 보너스 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { calcScore, getScoreGrade, type ScoreInput } from '../domeggook-scoring';

// ─────────────────────────────────────────────────────────────────────────────
// 기본 입력 (단품, 정상 상품)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_INPUT: ScoreInput = {
  legalStatus: 'safe',      // legalIp: 12
  ipRiskLevel: 'low',       // legalIp: +8 → 20
  priceGapRate: 35,         // priceComp: 20
  categoryName: '생활용품', // csSafety: low → 15
  marginRate: 22,           // margin: 15
  sales7d: 55,              // demand: 15
  latestInventory: 600,     // supply: 10
  moq: 1,                   // moqFit: 5
  // base = 100, 보너스 없음
};

describe('calcScore — 기본 7개 항목', () => {
  it('모든 항목 최고점: base = 100', () => {
    const result = calcScore(BASE_INPUT);
    expect(result.baseTotal).toBe(100);
    expect(result.legalIp).toBe(20);
    expect(result.priceComp).toBe(20);
    expect(result.csSafety).toBe(15);
    expect(result.margin).toBe(15);
    expect(result.demand).toBe(15);
    expect(result.supply).toBe(10);
    expect(result.moqFit).toBe(5);
  });

  it('title 없으면 보너스 0 → total = baseTotal', () => {
    const result = calcScore(BASE_INPUT);
    expect(result.maleBonus).toBe(0);
    expect(result.seasonBonus).toBe(0);
    expect(result.total).toBe(result.baseTotal);
  });

  it('법적 차단(blocked): legalIp = 0', () => {
    const result = calcScore({ ...BASE_INPUT, legalStatus: 'blocked', ipRiskLevel: null });
    expect(result.legalIp).toBe(0 + 2); // blocked(0) + unchecked(2)
    expect(result.blockedReason).toBe('법적 검토: 차단 상태');
  });

  it('IP 고위험: ipScore = 0', () => {
    const result = calcScore({ ...BASE_INPUT, ipRiskLevel: 'high' });
    expect(result.legalIp).toBe(12 + 0); // safe(12) + high(0)
  });
});

describe('calcScore — MOQ 점수', () => {
  it('MOQ 1: moqFit = 5', () => {
    expect(calcScore({ ...BASE_INPUT, moq: 1 }).moqFit).toBe(5);
  });

  it('MOQ 2: moqFit = 3', () => {
    expect(calcScore({ ...BASE_INPUT, moq: 2 }).moqFit).toBe(3);
  });

  it('MOQ 3: moqFit = 3', () => {
    expect(calcScore({ ...BASE_INPUT, moq: 3 }).moqFit).toBe(3);
  });

  it('TC-07: MOQ 4 → blockedReason 설정', () => {
    const result = calcScore({ ...BASE_INPUT, moq: 4 });
    expect(result.moqFit).toBe(0);
    expect(result.blockedReason).toBe('MOQ 4개 이상 (위탁 부적합)');
  });
});

describe('calcScore — 마진 점수', () => {
  it('마진 20%+ → 15점', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: 20 }).margin).toBe(15);
  });

  it('마진 15~19% → 12점', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: 15 }).margin).toBe(12);
  });

  it('마진 10~14% → 8점', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: 10 }).margin).toBe(8);
  });

  it('마진 5~9% → 4점', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: 5 }).margin).toBe(4);
  });

  it('마진 0~4% → 0점', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: 2 }).margin).toBe(0);
  });

  it('마진 null → 3점 (데이터 없음)', () => {
    expect(calcScore({ ...BASE_INPUT, marginRate: null }).margin).toBe(3);
  });
});

describe('calcScore — 수요 점수', () => {
  it('7일 판매 50+ → 15점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 50 }).demand).toBe(15);
  });

  it('7일 판매 20~49 → 12점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 20 }).demand).toBe(12);
  });

  it('7일 판매 10~19 → 8점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 10 }).demand).toBe(8);
  });

  it('7일 판매 5~9 → 5점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 5 }).demand).toBe(5);
  });

  it('7일 판매 1~4 → 2점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 1 }).demand).toBe(2);
  });

  it('7일 판매 0 → 0점', () => {
    expect(calcScore({ ...BASE_INPUT, sales7d: 0 }).demand).toBe(0);
  });
});

describe('calcScore — TC-05: 고위험 카테고리 차단', () => {
  it('식품 카테고리 → CS high → blockedReason 설정', () => {
    const result = calcScore({ ...BASE_INPUT, categoryName: '식품' });
    expect(result.csSafety).toBe(0); // high risk
    expect(result.csRiskLevel).toBe('high');
    expect(result.blockedReason).toMatch(/고위험 CS/);
  });

  it('유아용품 카테고리 → CS high', () => {
    const result = calcScore({ ...BASE_INPUT, categoryName: '유아용품' });
    expect(result.csRiskLevel).toBe('high');
    expect(result.csSafety).toBe(0);
  });
});

describe('calcScore — 남성/시즌 보너스 + 110pt 캡', () => {
  it('남성 high 타겟: maleBonus = 5', () => {
    // 낚시 카테고리(+30) + 낚시 키워드(+10) = 40점 → high
    const result = calcScore({
      ...BASE_INPUT,
      categoryName: '낚시',
      title: '낚시 낚싯대 루어세트 민물',
    });
    expect(result.maleBonus).toBe(5);
    expect(result.maleTier).toBe('high');
  });

  it('남성 mid 타겟: maleBonus = 3', () => {
    // 아웃도어 카테고리(+15) + 다용도 키워드(+5) = 20점 → mid
    const result = calcScore({
      ...BASE_INPUT,
      categoryName: '아웃도어',
      title: '아웃도어 다용도 멀티포켓 바지',
    });
    expect(result.maleBonus).toBe(3);
    expect(result.maleTier).toBe('mid');
  });

  it('110점 캡: base 100 + bonus 15 → total 110', () => {
    const result = calcScore({
      ...BASE_INPUT,
      title: '크리스마스 낚시대 선물세트 남성용',
      today: new Date(2026, 11, 10), // 크리스마스 시즌 활성
    });
    expect(result.maleBonus).toBeGreaterThan(0);
    expect(result.seasonBonus).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(110);
    // base=100, maleBonus≥5, seasonBonus≥10 → 합이 110 초과하므로 캡 적용
    expect(result.total).toBe(110);
  });

  it('TC-06: 법적 차단 키워드(위스키) → legalBlocked = true', () => {
    const result = calcScore({
      ...BASE_INPUT,
      title: '발렌타인 위스키 선물세트',
    });
    expect(result.blockedReason).toBe('법적 통신판매 금지 키워드 포함');
  });
});

describe('getScoreGrade — 110pt 기준 등급', () => {
  it('85점 이상 → S', () => {
    expect(getScoreGrade(85).label).toBe('S');
    expect(getScoreGrade(110).label).toBe('S');
  });

  it('70~84점 → A', () => {
    expect(getScoreGrade(70).label).toBe('A');
    expect(getScoreGrade(84).label).toBe('A');
  });

  it('55~69점 → B', () => {
    expect(getScoreGrade(55).label).toBe('B');
    expect(getScoreGrade(69).label).toBe('B');
  });

  it('40~54점 → C', () => {
    expect(getScoreGrade(40).label).toBe('C');
    expect(getScoreGrade(54).label).toBe('C');
  });

  it('40점 미만 → D', () => {
    expect(getScoreGrade(39).label).toBe('D');
    expect(getScoreGrade(0).label).toBe('D');
  });
});
