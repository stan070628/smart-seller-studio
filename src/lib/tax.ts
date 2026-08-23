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

/**
 * 간이과세자 소매업 부가가치율.
 *
 * 간이과세자의 매출세액은 `공급대가 × 업종별 부가가치율 × 10%`로 계산된다.
 * 소매업 부가가치율은 2021년 개정 이후 15%이므로 실효 부담은 판매가의 **1.5%**다.
 */
export const SIMPLIFIED_VALUE_ADDED_RATE = 0.15;

/** 간이과세자 매출세액 실효율 — 판매가 대비 1.5% */
export const SALES_VAT_RATE = VAT_RATE * SIMPLIFIED_VALUE_ADDED_RATE;

/**
 * 매출세액 — 판매로 발생해 납부해야 하는 부가세.
 *
 * 수수료·물류비 VAT(`effectiveFeeRate`·`effectiveCost`)가 **판매자가 부담하는 매입 측** VAT라면,
 * 이 함수는 **매출 측** VAT다. 둘은 별개이며 마진에서 모두 빠진다.
 *
 * @param settlementPrice 정산 기준 판매가. 표시 판매가가 아니라 **판매자 부담 할인을 뺀 금액**이다.
 *
 * ⚠️ 일반과세자 전환 시 이 함수는 그대로 쓸 수 없다. 일반과세자는 매출세액 10%를 받아 납부하되
 *    매입세액을 전액 공제받으므로 부담이 `(판매가 − 매입액) × 10%`가 되어 산식 자체가 달라진다.
 *    전환 시점에는 0을 반환하는 현재 동작이 아니라 매입액을 인자로 받는 형태로 재설계해야 한다.
 */
export function salesVat(settlementPrice: number): number {
  if (!IS_SIMPLIFIED_TAXPAYER) return 0;
  return Math.round(settlementPrice * SALES_VAT_RATE);
}
