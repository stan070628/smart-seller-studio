/**
 * coupang-price.ts
 * 쿠팡 실판매가 추정과 로켓그로스 손익 계산.
 *
 * 근거 문서:
 *   20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28  — 마진 기준
 *   20-wiki/sources/로켓그로스 요금표 2026-07-28        — 물류비
 */

import type { LogisticsSize } from '@/types/shortlist';

/** 쿠팡 판매수수료 */
export const COMMISSION_RATE = 0.108;

/** 로켓그로스 입출고비+배송비 (원). 판매된 상품에만 부과된다. */
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: 1725, // 입출고 600 + 배송 1,125
  small: 1900,  // 입출고 650 + 배송 1,250
  medium: 2740, // 입출고 1,240 + 배송 1,500
};

/** 목표 마진율 — 광고 손익분기 ROAS 333% 이하를 만드는 하한 */
const TARGET_MARGIN_RATE = 0.3;

/** 개당 마진이 물류비의 몇 배 이상이어야 하는가 — 요율 인상 완충 */
const MARGIN_TO_LOGISTICS = 1.5;

/**
 * 진입 가능한 최소 판매가(원).
 *
 * 두 조건을 모두 만족해야 하므로 큰 쪽을 취한다.
 *   ① 마진율 30% 이상
 *   ② 개당 마진 ≥ 물류비 × 1.5
 *
 * 원가가 낮을수록 ②가, 높을수록 ①이 지배한다.
 */
export function breakEvenPrice(effectiveCost: number, size: LogisticsSize): number {
  const logi = LOGISTICS_FEE[size];
  const byRate = (effectiveCost + logi) / (1 - COMMISSION_RATE - TARGET_MARGIN_RATE);
  const byAmount = (effectiveCost + logi * (1 + MARGIN_TO_LOGISTICS)) / (1 - COMMISSION_RATE);
  return Math.ceil(Math.max(byRate, byAmount));
}

/** 개당 마진(원). 음수면 적자다. */
export function marginOf(
  sellingPrice: number,
  effectiveCost: number,
  size: LogisticsSize,
): number {
  return Math.round(
    sellingPrice * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - effectiveCost,
  );
}
