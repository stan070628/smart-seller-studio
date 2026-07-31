/**
 * coupang-price.ts
 * 쿠팡 실판매가 추정과 로켓그로스 손익 계산.
 *
 * 근거 문서:
 *   20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28  — 마진 기준
 *   20-wiki/sources/로켓그로스 요금표 2026-07-28        — 물류비
 */

import type { LogisticsSize } from '@/types/shortlist';
import { getRgShippingFee, type RgSizeType } from '@/lib/roi/rg-fees';

/**
 * 쿠팡 판매수수료.
 * 주의: 이 값이 calculator/coupang-fees.ts 등 여러 곳에 각각 하드코딩되어 있다.
 * 정식 소스를 만드는 일은 별도 정리 과제로 둔다.
 *
 * export하는 이유: 수수료는 쿠팡이라는 외부 플랫폼의 사실이라 이 모듈 밖에서도
 * 재사용될 여지가 있다. 반면 TARGET_MARGIN_RATE·MARGIN_TO_LOGISTICS는 이
 * 모듈이 내리는 정책적 판단이라 캡슐화한다.
 */
export const COMMISSION_RATE = 0.108;

/**
 * 쇼트리스트의 사이즈 값 → 로켓그로스 요율표(rg-fees.ts) 키.
 * 값이 다른 이유: 쇼트리스트 쪽은 DB CHECK 제약에 'xsmall'로 박혀 있고,
 * 요율표 쪽은 대형 이상까지 다루느라 'extra_small' 표기를 쓴다.
 */
const RG_SIZE_KEY: Record<LogisticsSize, RgSizeType> = {
  xsmall: 'extra_small',
  small: 'small',
  medium: 'medium',
};

/**
 * 로켓그로스 입출고비+배송비 (원). 판매된 상품에만 부과된다.
 * 값은 rg-fees.ts에서 파생한다 — 요율표가 바뀌면 그 파일만 고치면 된다.
 */
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: getRgShippingFee(RG_SIZE_KEY.xsmall),
  small: getRgShippingFee(RG_SIZE_KEY.small),
  medium: getRgShippingFee(RG_SIZE_KEY.medium),
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
  // logi * (1 + MARGIN_TO_LOGISTICS): 물류비 자체를 회수(logi)하고,
  // 그 위에 물류비의 MARGIN_TO_LOGISTICS배를 마진으로 더 얹는다.
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
