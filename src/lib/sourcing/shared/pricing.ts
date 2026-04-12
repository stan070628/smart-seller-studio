/**
 * shared/pricing.ts
 * 공통 판매가 역산 공식 — channel-policy.ts 핵심 함수 re-export
 *
 * 도매꾹 드롭쉬핑과 코스트코 사입 양쪽에서 공용
 */

export {
  CHANNEL_FEE,
  VAT_RATE,
  DOMEGGOOK_TARGET_MARGIN_RATE,
  COSTCO_TARGET_MARGIN_RATE,
  calcMinSalePrice,
  calcRecommendedSalePrice,
  calcNetProfit,
  calcNetMarginRate,
  type Channel,
} from './channel-policy';
