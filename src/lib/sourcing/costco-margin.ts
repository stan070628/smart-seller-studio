/**
 * costco-margin.ts
 * 코스트코 상품 마진 계산 유틸리티
 *
 * 3가지 숨은 비용:
 *   1. 마켓플레이스 수수료: 판매가의 10%
 *   2. 물류비 (택배비 포함): 3,500원 고정
 *   3. 부가세 (매입 시): 매입가의 10%
 *
 * 순이익 공식:
 *   netProfit = (0.90 × sellPrice - purchasePrice - 3,500) / 1.10
 *
 * 1.4x 빠른 판단 규칙:
 *   purchasePrice × 1.4 = 최소 목표 판매가
 */

import { MARGIN_CONSTANTS } from './costco-constants';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface MarginInput {
  purchasePrice: number;  // 코스트코 매입가 (원)
  sellPrice: number;      // 목표 판매가 (원)
}

export interface MarginResult {
  purchasePrice: number;
  sellPrice: number;
  targetSellPrice: number;  // purchasePrice × 1.4 (빠른 판단 목표가)
  marketplaceFee: number;   // 판매가 × 10%
  logisticsFee: number;     // 3,500원 고정
  vatOnPurchase: number;    // 매입가 × 10%
  netProfit: number;        // 순이익
  marginRate: number;       // 순이익 / 판매가 (0~1)
  marginRatePct: number;    // marginRate × 100 (소수점 1자리)
  isViable: boolean;        // 순이익 > 0
  passesQuickRule: boolean; // sellPrice >= purchasePrice × 1.4
}

// ─────────────────────────────────────────────────────────────────────────────
// 마진 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 순이익 계산
 * netProfit = (0.90 × S - C - 3500) / 1.10
 * 여기서 S = sellPrice, C = purchasePrice
 */
export function calculateMargin(input: MarginInput): MarginResult {
  const { purchasePrice, sellPrice } = input;
  const { MARKETPLACE_FEE_RATE, LOGISTICS_FEE, TAX_RATE, QUICK_MULTIPLIER } =
    MARGIN_CONSTANTS;

  const marketplaceFee = sellPrice * MARKETPLACE_FEE_RATE;
  const logisticsFee = LOGISTICS_FEE;
  const vatOnPurchase = purchasePrice * TAX_RATE;

  // 대수적으로 정리된 순이익 공식
  const netProfit =
    (sellPrice * (1 - MARKETPLACE_FEE_RATE) - purchasePrice - logisticsFee) /
    (1 + TAX_RATE);

  const marginRate = sellPrice > 0 ? netProfit / sellPrice : 0;
  const targetSellPrice = Math.ceil(purchasePrice * QUICK_MULTIPLIER);

  return {
    purchasePrice,
    sellPrice,
    targetSellPrice,
    marketplaceFee: Math.round(marketplaceFee),
    logisticsFee,
    vatOnPurchase: Math.round(vatOnPurchase),
    netProfit: Math.round(netProfit),
    marginRate,
    marginRatePct: Math.round(marginRate * 1000) / 10, // 소수점 1자리
    isViable: netProfit > 0,
    passesQuickRule: sellPrice >= targetSellPrice,
  };
}

/**
 * 빠른 판단: 시장가가 1.4x 규칙을 통과하는지 확인
 */
export function quickRuleCheck(
  purchasePrice: number,
  marketPrice: number,
): boolean {
  return marketPrice >= purchasePrice * MARGIN_CONSTANTS.QUICK_MULTIPLIER;
}

/**
 * 마진 스코어 계산 (0~100)
 * 시장가가 없으면 0 반환
 * 순이익률 기준:
 *   >= 30% → 100점
 *   >= 20% → 80점
 *   >= 10% → 60점
 *   >= 5%  → 40점
 *   > 0%   → 20점
 *   <= 0%  → 0점
 */
export function calculateMarginScore(
  purchasePrice: number,
  marketPrice: number | null,
): number {
  if (!marketPrice || marketPrice <= 0) return 0;

  const result = calculateMargin({ purchasePrice, sellPrice: marketPrice });
  const pct = result.marginRatePct;

  if (pct >= 30) return 100;
  if (pct >= 20) return 80;
  if (pct >= 10) return 60;
  if (pct >= 5) return 40;
  if (pct > 0) return 20;
  return 0;
}

/**
 * 시장가가 있을 때 마진율 문자열 반환 (없으면 '-')
 */
export function formatMarginRate(
  purchasePrice: number,
  marketPrice: number | null,
): string {
  if (!marketPrice || marketPrice <= 0) return '-';
  const result = calculateMargin({ purchasePrice, sellPrice: marketPrice });
  return `${result.marginRatePct}%`;
}
