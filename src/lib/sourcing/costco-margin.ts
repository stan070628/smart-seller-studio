/**
 * costco-margin.ts — v2 (하위 호환 레이어)
 *
 * ⚠ DEPRECATED: 신규 코드는 costco-pricing.ts의 calcCostcoPrice() 사용
 *
 * 1.4x 빠른 판단 규칙 완전 삭제.
 * market-price/route.ts 하위 호환을 위해 최소 인터페이스만 유지.
 */

import { calcCostcoPrice, getShippingCost, type Channel } from './costco-pricing';

export type { Channel };
export { getShippingCost };

export interface MarginResult {
  purchasePrice: number;
  sellPrice: number;      // 시장가 = 실제 판매 기준
  netProfit: number;
  marginRate: number;     // 0~1
  marginRatePct: number;  // 소수점 1자리
  isViable: boolean;
}

/**
 * 시장가 기준 마진 계산 (하위 호환)
 * @deprecated calcCostcoPrice() 사용 권장
 */
export function calculateMargin(input: {
  purchasePrice: number;
  sellPrice: number;
  channel?: Channel;
}): MarginResult {
  const channel = input.channel ?? 'naver';
  const result = calcCostcoPrice({
    buyPrice: input.purchasePrice,
    packQty: 1,
    categoryName: null,
    channel,
    marketPrice: input.sellPrice,
  });

  const marginRate = result.netProfit / input.sellPrice;
  return {
    purchasePrice: input.purchasePrice,
    sellPrice: input.sellPrice,
    netProfit: result.netProfit,
    marginRate,
    marginRatePct: Math.round(marginRate * 1000) / 10,
    isViable: result.netProfit > 0,
  };
}
