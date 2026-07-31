/**
 * 부가가치세 처리 — 판매 수수료의 실질 부담률을 결정한다.
 *
 * 쿠팡 판매 수수료는 **VAT 별도**로 고지된다(판매자센터 표기: "10.6 %, (VAT 별도, 정률)").
 * 실제 정산에서는 VAT가 포함된 금액이 차감되며, 그 VAT를 돌려받는지가 과세 유형에 달렸다.
 *
 *   일반과세자 — 매입세액으로 전액 공제받으므로 실질 부담은 고지 요율 그대로다.
 *   간이과세자 — 매입세액 공제가 `매입액 × 0.5%`로 제한되어 사실상 돌려받지 못한다.
 *                따라서 수수료 VAT가 그대로 비용이 된다.
 *
 * 이 구분을 상수 하나로 모아둔 이유는, 매출이 늘어 과세 유형이 바뀔 때
 * `product_costs.platform_fee_rate` 수십 건을 다시 고치는 대신
 * 여기만 바꾸고 재계산하면 되도록 하기 위해서다.
 */

/** 부가가치세율 */
export const VAT_RATE = 0.1;

/**
 * 현재 사업자의 과세 유형.
 *
 * 간이과세자 기준(2024년 이후): 직전 연도 공급대가 1억 400만원 미만.
 * 이 값을 바꾼 뒤에는 반드시 `platform_fee_rate`를 재계산해야 한다
 * (scripts/recalc-platform-fee-rate.mjs).
 */
export const IS_SIMPLIFIED_TAXPAYER = true;

/**
 * 고지 요율(VAT 별도)을 실질 부담 요율로 변환한다.
 *
 * @param listedRate 판매자센터에 표시되는 요율. 예: 0.106
 * @returns 간이과세자면 VAT 포함, 일반과세자면 그대로
 *
 * @example
 * effectiveFeeRate(0.106) // 간이과세자 → 0.1166
 */
export function effectiveFeeRate(listedRate: number): number {
  if (!IS_SIMPLIFIED_TAXPAYER) return listedRate;
  return Math.round(listedRate * (1 + VAT_RATE) * 1e6) / 1e6;
}

/**
 * 고지 금액(VAT 별도)을 실질 부담 금액으로 변환한다.
 *
 * 로켓그로스 입출고·배송 비용도 VAT 별도로 고지된다
 * (서비스 소개서 2025-01, 6p: "판매 완료 시 비용이 부과됩니다. (VAT별도)").
 *
 * @param listedCost 고지 금액. 예: 소형 1,900원
 * @returns 간이과세자면 VAT 포함 정수, 일반과세자면 그대로
 *
 * @example
 * effectiveCost(1900) // 간이과세자 → 2090
 * effectiveCost(1725) // 간이과세자 → 1898
 */
export function effectiveCost(listedCost: number): number {
  if (!IS_SIMPLIFIED_TAXPAYER) return listedCost;
  return Math.round(listedCost * (1 + VAT_RATE));
}
