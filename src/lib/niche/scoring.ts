/**
 * 니치점수 계산 엔진
 * 총점 100점 만점, 7개 지표를 가중합산하여 S~D 등급 부여
 */

import type { NicheScoreInput, NicheScoreResult } from '@/types/niche';

// ─────────────────────────────────────────────
// ① 로켓배송 비진출 추정 (최대 30점)
// ─────────────────────────────────────────────

/**
 * A) 평균 판매가 기반 점수 (0~12점)
 * 고가일수록 로켓배송 물류 처리가 어려워 비진출 가능성 높음
 */
function scoreByAvgPrice(avgPrice: number): number {
  if (avgPrice < 30_000) return 0;
  if (avgPrice < 100_000) {
    // 3만~10만: 선형 보간 1~3점
    const ratio = (avgPrice - 30_000) / (100_000 - 30_000);
    return Math.round(1 + ratio * 2); // 1~3
  }
  if (avgPrice < 300_000) {
    // 10만~30만: 4~6점
    const ratio = (avgPrice - 100_000) / (300_000 - 100_000);
    return Math.round(4 + ratio * 2); // 4~6
  }
  if (avgPrice < 1_000_000) {
    // 30만~100만: 7~9점
    const ratio = (avgPrice - 300_000) / (1_000_000 - 300_000);
    return Math.round(7 + ratio * 2); // 7~9
  }
  if (avgPrice < 3_000_000) return 10; // 100만~300만
  return 12;                            // 300만 이상
}

/**
 * B) 키워드 시그널 (0 또는 8점)
 */
function scoreByKeywordSignal(hasLargeSizeKeyword: boolean): number {
  return hasLargeSizeKeyword ? 8 : 0;
}

/**
 * C) 카테고리 시그널 (0 또는 6점)
 */
function scoreByCategorySignal(hasBulkyCategory: boolean): number {
  return hasBulkyCategory ? 6 : 0;
}

/**
 * D) 공식스토어 비율 역수 (0~4점)
 * 공식스토어 비율이 낮을수록 진입 여지가 많음
 */
function scoreByOfficialStoreInverse(officialStoreBrandRatio: number): number {
  const clamped = Math.max(0, Math.min(1, officialStoreBrandRatio));
  return Math.round((1 - clamped) * 4);
}

/**
 * 로켓배송 비진출 추정 합산 (최대 30점)
 */
function calcRocketNonEntry(input: NicheScoreInput): number {
  const a = scoreByAvgPrice(input.avgPrice);
  const b = scoreByKeywordSignal(input.hasLargeSizeKeyword);
  const c = scoreByCategorySignal(input.hasBulkyCategory);
  const d = scoreByOfficialStoreInverse(input.officialStoreBrandRatio);
  return Math.min(30, a + b + c + d);
}

// ─────────────────────────────────────────────
// ② 상품수 경쟁도 (최대 20점)
// ─────────────────────────────────────────────

/**
 * 총 상품수 기반 경쟁도 점수
 * 100~500개 구간이 최적 (틈새이면서 수요 존재)
 */
function calcCompetitionLevel(totalProductCount: number): number {
  if (totalProductCount < 20) return 2;
  if (totalProductCount < 50) return 4;
  if (totalProductCount < 100) return 12;
  if (totalProductCount <= 500) return 20;  // 최적 구간
  if (totalProductCount <= 1_000) return 14;
  if (totalProductCount <= 3_000) return 6;
  if (totalProductCount <= 10_000) return 2;
  return 0;
}

// ─────────────────────────────────────────────
// ③ 판매자 다양성 (최대 15점)
// ─────────────────────────────────────────────

/**
 * unique 판매자 수 / 샘플 수 비율로 판매자 분산도 측정
 * 높을수록 특정 판매자 독점 없음 → 진입 유리
 */
function calcSellerDiversity(uniqueSellerCount: number, sampleSize: number): number {
  if (sampleSize === 0) return 0;
  const ratio = Math.min(1, uniqueSellerCount / sampleSize);

  if (ratio >= 0.7) return 15;
  if (ratio >= 0.5) {
    // 0.5~0.7: 10~14점 선형 보간
    const t = (ratio - 0.5) / (0.7 - 0.5);
    return Math.round(10 + t * 4);
  }
  if (ratio >= 0.3) {
    // 0.3~0.5: 5~9점 선형 보간
    const t = (ratio - 0.3) / (0.5 - 0.3);
    return Math.round(5 + t * 4);
  }
  // 0~0.3: 0~4점 선형 보간
  const t = ratio / 0.3;
  return Math.round(t * 4);
}

// ─────────────────────────────────────────────
// ④ 독점도 (최대 10점)
// ─────────────────────────────────────────────

/**
 * 상위 3 판매자 상품 수 / 샘플 수로 독점도 측정
 * 낮을수록 독점 없음 → 신규 진입자에게 유리
 */
function calcMonopolyLevel(top3SellerProductCount: number, sampleSize: number): number {
  if (sampleSize === 0) return 0;
  const top3Ratio = Math.min(1, top3SellerProductCount / sampleSize);

  if (top3Ratio < 0.3) return 10;
  if (top3Ratio < 0.5) {
    // 0.3~0.5: 6~9점 선형 보간
    const t = (top3Ratio - 0.3) / (0.5 - 0.3);
    return Math.round(9 - t * 3); // 9→6
  }
  if (top3Ratio < 0.7) {
    // 0.5~0.7: 3~5점 선형 보간
    const t = (top3Ratio - 0.5) / (0.7 - 0.5);
    return Math.round(5 - t * 2); // 5→3
  }
  // 0.7 이상: 0~2점 선형 보간
  const t = Math.min(1, (top3Ratio - 0.7) / 0.3);
  return Math.round(2 - t * 2); // 2→0
}

// ─────────────────────────────────────────────
// ⑤ 브랜드 비율 (최대 10점)
// ─────────────────────────────────────────────

/**
 * 브랜드 상품 비율이 낮을수록 일반 판매자 진입 여지가 많음
 */
function calcBrandRatio(brandProductCount: number, sampleSize: number): number {
  if (sampleSize === 0) return 0;
  const ratio = Math.min(1, brandProductCount / sampleSize);

  if (ratio < 0.2) return 10;
  if (ratio < 0.5) {
    // 0.2~0.5: 5~9점 선형 보간
    const t = (ratio - 0.2) / (0.5 - 0.2);
    return Math.round(9 - t * 4); // 9→5
  }
  if (ratio < 0.8) {
    // 0.5~0.8: 2~4점 선형 보간
    const t = (ratio - 0.5) / (0.8 - 0.5);
    return Math.round(4 - t * 2); // 4→2
  }
  // 0.8 이상: 0~1점 선형 보간
  const t = Math.min(1, (ratio - 0.8) / 0.2);
  return Math.round(1 - t); // 1→0
}

// ─────────────────────────────────────────────
// ⑥ 가격 마진실현성 (최대 10점)
// ─────────────────────────────────────────────

/**
 * 중간 판매가 기반 마진 실현 가능성 점수
 * 너무 저가이면 마진 확보 불가, 적정 가격대일수록 높은 점수
 */
function calcPriceMarginViability(medianPrice: number): number {
  if (medianPrice < 5_000) return 0;
  if (medianPrice < 10_000) return 2;
  if (medianPrice < 20_000) return 5;
  if (medianPrice < 50_000) return 7;
  if (medianPrice < 100_000) return 8;
  if (medianPrice < 500_000) return 9;
  return 10;
}

// ─────────────────────────────────────────────
// ⑦ 국내 희소성 (최대 5점)
// ─────────────────────────────────────────────

/**
 * 샘플 내 unique 판매자 수 절대값으로 국내 희소성 판단
 * 판매자가 적을수록 블루오션에 가까움
 */
function calcDomesticRarity(uniqueSellerCount: number): number {
  if (uniqueSellerCount <= 5) return 5;
  if (uniqueSellerCount <= 10) return 4;
  if (uniqueSellerCount <= 20) return 3;
  if (uniqueSellerCount <= 50) return 2;
  if (uniqueSellerCount <= 100) return 1;
  return 0;
}

// ─────────────────────────────────────────────
// 등급 산정
// ─────────────────────────────────────────────

function calcGrade(totalScore: number): NicheScoreResult['grade'] {
  if (totalScore >= 80) return 'S';
  if (totalScore >= 65) return 'A';
  if (totalScore >= 50) return 'B';
  if (totalScore >= 35) return 'C';
  return 'D';
}

// ─────────────────────────────────────────────
// 시그널 문구 생성
// ─────────────────────────────────────────────

/**
 * 점수 breakdown과 입력값을 바탕으로 사용자에게 보여줄 시그널 해석 문구 생성
 */
export function generateSignals(
  input: NicheScoreInput,
  breakdown: NicheScoreResult['breakdown'],
): string[] {
  const signals: string[] = [];

  // 로켓배송 비진출 시그널
  if (breakdown.rocketNonEntry >= 20) {
    signals.push('로켓배송 비진출 가능성이 매우 높습니다.');
  } else if (breakdown.rocketNonEntry >= 12) {
    signals.push('로켓배송 비진출 가능성이 있는 카테고리입니다.');
  }

  if (input.hasLargeSizeKeyword) {
    signals.push('대형·업소용 키워드가 감지되어 쿠팡 물류 처리가 어려울 수 있습니다.');
  }

  if (input.hasBulkyCategory) {
    signals.push('부피가 크거나 무거운 카테고리로 로켓배송 입점이 제한될 가능성이 높습니다.');
  }

  if (input.officialStoreBrandRatio > 0.5) {
    signals.push('공식스토어·직영 비율이 높아 브랜드 경쟁이 치열합니다.');
  } else if (input.officialStoreBrandRatio < 0.1) {
    signals.push('공식스토어·직영이 거의 없어 일반 판매자에게 유리한 시장입니다.');
  }

  // 경쟁도 시그널
  if (breakdown.competitionLevel === 20) {
    signals.push('상품 수가 100~500개로 틈새 수요가 확인된 최적 경쟁 구간입니다.');
  } else if (input.totalProductCount < 50) {
    signals.push('상품 수가 매우 적어 수요 존재 여부를 추가로 검증하세요.');
  } else if (input.totalProductCount > 10_000) {
    signals.push('상품 수가 1만 개를 초과하여 경쟁이 매우 치열합니다.');
  }

  // 판매자 다양성 시그널
  const sellerRatio = input.sampleSize > 0 ? input.uniqueSellerCount / input.sampleSize : 0;
  if (sellerRatio >= 0.7) {
    signals.push('판매자 분산도가 높아 특정 판매자에 의한 독점이 없습니다.');
  } else if (sellerRatio < 0.3) {
    signals.push('소수 판매자가 시장을 장악하고 있어 신규 진입이 어려울 수 있습니다.');
  }

  // 독점도 시그널
  const top3Ratio = input.sampleSize > 0 ? input.top3SellerProductCount / input.sampleSize : 0;
  if (top3Ratio >= 0.7) {
    signals.push('상위 3개 판매자가 시장의 70% 이상을 점유하고 있습니다.');
  } else if (top3Ratio < 0.3) {
    signals.push('상위 판매자 집중도가 낮아 신규 판매자도 노출 기회가 있습니다.');
  }

  // 브랜드 비율 시그널
  const brandRatio = input.sampleSize > 0 ? input.brandProductCount / input.sampleSize : 0;
  if (brandRatio >= 0.8) {
    signals.push('브랜드 상품 비율이 80% 이상으로 브랜드 파워 경쟁이 필요합니다.');
  } else if (brandRatio < 0.2) {
    signals.push('브랜드 비율이 낮아 자체 브랜딩 없이도 경쟁 가능한 시장입니다.');
  }

  // 마진실현성 시그널
  if (input.medianPrice >= 100_000) {
    signals.push(`중간 판매가 ${(input.medianPrice / 10_000).toFixed(0)}만원으로 마진 실현 가능성이 높습니다.`);
  } else if (input.medianPrice < 10_000) {
    signals.push('중간 판매가가 1만원 미만으로 마진 확보가 매우 어렵습니다.');
  }

  // 국내 희소성 시그널
  if (input.uniqueSellerCount <= 5) {
    signals.push('국내 판매자가 5명 이하인 극희소 블루오션 키워드입니다.');
  } else if (input.uniqueSellerCount <= 20) {
    signals.push('국내 판매자가 적어 선점 효과를 기대할 수 있습니다.');
  } else if (input.uniqueSellerCount > 100) {
    signals.push('국내 판매자가 충분히 많아 희소성이 낮습니다.');
  }

  return signals;
}

// ─────────────────────────────────────────────
// 메인 스코어링 함수
// ─────────────────────────────────────────────

/**
 * 니치점수를 계산하고 등급·breakdown·시그널을 반환
 * @param input  NicheScoreInput — 네이버 쇼핑 API 응답에서 집계한 지표값
 * @returns NicheScoreResult
 */
export function calcNicheScore(input: NicheScoreInput): NicheScoreResult {
  const breakdown: NicheScoreResult['breakdown'] = {
    rocketNonEntry:       calcRocketNonEntry(input),
    competitionLevel:     calcCompetitionLevel(input.totalProductCount),
    sellerDiversity:      calcSellerDiversity(input.uniqueSellerCount, input.sampleSize),
    monopolyLevel:        calcMonopolyLevel(input.top3SellerProductCount, input.sampleSize),
    brandRatio:           calcBrandRatio(input.brandProductCount, input.sampleSize),
    priceMarginViability: calcPriceMarginViability(input.medianPrice),
    domesticRarity:       calcDomesticRarity(input.uniqueSellerCount),
  };

  const totalScore = Math.min(
    100,
    breakdown.rocketNonEntry +
    breakdown.competitionLevel +
    breakdown.sellerDiversity +
    breakdown.monopolyLevel +
    breakdown.brandRatio +
    breakdown.priceMarginViability +
    breakdown.domesticRarity,
  );

  const grade = calcGrade(totalScore);
  const signals = generateSignals(input, breakdown);

  return { totalScore, grade, breakdown, signals };
}
