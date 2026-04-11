/**
 * channel-policy.ts
 * 채널별 수수료·VAT 정책 및 판매가 역산 공식
 *
 * 코스트코 사입 / 도매꾹 드롭쉬핑 양쪽에서 공용
 */

// ─────────────────────────────────────────────────────────────────────────────
// 채널 수수료
// ─────────────────────────────────────────────────────────────────────────────

/** 채널별 마켓플레이스 수수료율 */
export const CHANNEL_FEE: Record<Channel, number> = {
  naver:   0.06,   // 결제 3.74% + 매출연동 2% + 채널수수료
  coupang: 0.11,   // 카테고리 평균 + 안전결제
};

/**
 * 판매가 내 VAT (부가가치세)
 * 판매가에서 VAT를 공제할 때: 판매가 × (10 / 110) ≈ 0.0909
 */
export const VAT_RATE = 10 / 110; // ≈ 0.0909

// ─────────────────────────────────────────────────────────────────────────────
// 마진 정책 기본값
// ─────────────────────────────────────────────────────────────────────────────

/** 도매꾹 드롭쉬핑 목표 순이익률 (회전 우선) */
export const DOMEGGOOK_TARGET_MARGIN_RATE = 0.10;

/** 코스트코 사입 목표 순이익률 (안정 마진) */
export const COSTCO_TARGET_MARGIN_RATE = 0.13;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export type Channel = 'naver' | 'coupang';

// ─────────────────────────────────────────────────────────────────────────────
// 판매가 역산 공식
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 최소 판매가 계산 (break-even 기준)
 * 원가를 커버하는 최소 판매가 → 드롭쉬핑 번들 최저가에 사용
 *
 * 공식: costTotal / (1 - channelFee - VAT)
 *
 * 예) 도매가 2,000원 × MOQ 3 + 배송비 2,500원 = 8,500원, 네이버
 *     → 8,500 / (1 - 0.06 - 0.0909) ≈ 9,871원
 */
export function calcMinSalePrice(costTotal: number, channel: Channel): number {
  const deductionRate = 1 - CHANNEL_FEE[channel] - VAT_RATE;
  return Math.ceil(costTotal / deductionRate);
}

/**
 * 목표 마진 포함 추천 판매가 계산 (10원 단위 반올림)
 * 원가 + 목표이익을 커버하는 판매가 → 추천가 표시에 사용
 *
 * 공식: (costTotal + targetProfit) / (1 - channelFee - VAT)
 *
 * @param costTotal   원가 합계 (도매가 × MOQ + 배송비 등)
 * @param targetProfit 목표 순이익 (원)
 * @param channel     판매 채널
 */
export function calcRecommendedSalePrice(
  costTotal: number,
  targetProfit: number,
  channel: Channel,
): number {
  const deductionRate = 1 - CHANNEL_FEE[channel] - VAT_RATE;
  return Math.round((costTotal + targetProfit) / deductionRate / 10) * 10;
}

/**
 * 실질 순이익 계산
 *
 * 공식: salePrice × (1 - channelFee - VAT) - costTotal
 */
export function calcNetProfit(salePrice: number, costTotal: number, channel: Channel): number {
  const netRevenue = salePrice * (1 - CHANNEL_FEE[channel] - VAT_RATE);
  return Math.round(netRevenue - costTotal);
}

/**
 * 실질 순이익률 계산
 * 순이익 / 판매가
 */
export function calcNetMarginRate(salePrice: number, costTotal: number, channel: Channel): number {
  const netProfit = calcNetProfit(salePrice, costTotal, channel);
  return salePrice > 0 ? Math.round((netProfit / salePrice) * 10000) / 100 : 0;
}
