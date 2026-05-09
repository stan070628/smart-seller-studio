/**
 * 원가 관리 계산 라이브러리
 * - 수량 가중평균, 마진 지표, 배송비 배분 순수 함수 모음
 * - 외부 의존성 없음 (DB, API 호출 금지)
 */

export interface CostEntryRow {
  id: string;
  product_cost_id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  selling_price: number;
  shipping_group_id: string | null;
}

export interface ProductMetrics {
  /** 수량 가중 평균 매입 단가 */
  weighted_avg_cost: number;
  /** 수량 가중 평균 배송비 */
  weighted_avg_shipping: number;
  /** 수량 가중 평균 판매가 */
  weighted_avg_selling_price: number;
  /** 플랫폼 수수료 (가중 평균 판매가 기준) */
  fee: number;
  /** 순이익 = 판매가 - 매입단가 - 배송비 - 수수료 */
  net_profit: number;
  /** 마진율 = 순이익 / 판매가 × 100 (%) */
  margin_rate: number;
  /** 총 수량 */
  total_quantity: number;
  /** 총 매입 금액 = Σ(단가 × 수량) */
  total_purchase_amount: number;
  /** 기간 총 매출 = Σ(selling_price × qty) */
  total_revenue: number;
  /** 기간 총 순이익 = total_revenue - 총매입비 - 총배송비 - 총수수료 */
  total_net_profit_amount: number;
}

/**
 * 수량 가중 평균을 계산한다.
 * @param entries - 가중평균 대상 항목 배열
 * @param field   - 가중평균 대상 필드 ('unit_cost' | 'unit_shipping_fee' | 'selling_price')
 * @returns 반올림된 가중평균 값. 빈 배열이거나 총 수량이 0이면 0 반환.
 */
export function calculateWeightedAvg(
  entries: Pick<CostEntryRow, 'quantity' | 'unit_cost' | 'unit_shipping_fee' | 'selling_price'>[],
  field: 'unit_cost' | 'unit_shipping_fee' | 'selling_price',
): number {
  // 판매가 가중평균은 판매가가 설정된(> 0) 항목만 포함
  const pool = field === 'selling_price' ? entries.filter((e) => e.selling_price > 0) : entries;
  const totalQty = pool.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return 0;
  return Math.round(pool.reduce((s, e) => s + e[field] * e.quantity, 0) / totalQty);
}

/**
 * 상품 수익성 지표를 계산한다.
 * @param entries         - 원가 입력 항목 배열
 * @param platformFeeRate - 플랫폼 수수료율 (0 < rate < 1 범위, 예: 0.108 = 10.8%)
 * @returns ProductMetrics. 빈 배열이면 모든 값이 0인 객체 반환.
 * @remarks 각 가중평균이 Math.round 처리되므로 net_profit/margin_rate에 최대 ±2원 오차 가능
 */
export function calculateProductMetrics(
  entries: CostEntryRow[],
  platformFeeRate: number,
): ProductMetrics {
  if (entries.length === 0) {
    return {
      weighted_avg_cost: 0,
      weighted_avg_shipping: 0,
      weighted_avg_selling_price: 0,
      fee: 0,
      net_profit: 0,
      margin_rate: 0,
      total_quantity: 0,
      total_purchase_amount: 0,
      total_revenue: 0,
      total_net_profit_amount: 0,
    };
  }

  const weighted_avg_cost = calculateWeightedAvg(entries, 'unit_cost');
  const weighted_avg_shipping = calculateWeightedAvg(entries, 'unit_shipping_fee');
  const weighted_avg_selling_price = calculateWeightedAvg(entries, 'selling_price');

  // 수수료: 반올림 처리
  const fee = Math.round(weighted_avg_selling_price * platformFeeRate);

  // 순이익: 판매가 - 매입단가 - 배송비 - 수수료
  const net_profit = weighted_avg_selling_price - weighted_avg_cost - weighted_avg_shipping - fee;

  // 마진율 (%): 판매가가 0이면 0 반환
  const margin_rate =
    weighted_avg_selling_price > 0 ? (net_profit / weighted_avg_selling_price) * 100 : 0;

  const total_quantity = entries.reduce((s, e) => s + e.quantity, 0);
  // 매입비는 전체 항목 (판매가 미설정 포함)
  const total_purchase_amount = entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);

  // 매출·순이익은 판매가가 설정된(> 0) 항목만 집계
  const pricedEntries = entries.filter((e) => e.selling_price > 0);
  const total_revenue = pricedEntries.reduce((s, e) => s + e.selling_price * e.quantity, 0);
  const priced_cost = pricedEntries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);
  const priced_shipping = pricedEntries.reduce((s, e) => s + e.unit_shipping_fee * e.quantity, 0);
  const total_fee_amount = pricedEntries.reduce(
    (s, e) => s + Math.round(e.selling_price * platformFeeRate) * e.quantity,
    0,
  );
  const total_net_profit_amount = total_revenue - priced_cost - priced_shipping - total_fee_amount;

  return {
    weighted_avg_cost,
    weighted_avg_shipping,
    weighted_avg_selling_price,
    fee,
    net_profit,
    margin_rate,
    total_quantity,
    total_purchase_amount,
    total_revenue,
    total_net_profit_amount,
  };
}

/**
 * 총 배송비를 수량 비례로 각 항목에 배분한다.
 * 반올림 오차는 첫 번째 항목에 흡수된다.
 *
 * @param entries          - id와 quantity를 가진 항목 배열
 * @param totalShippingFee - 배분할 총 배송비. 0 이상의 정수 (음수 전달 시 결과 미보장)
 * @returns id → 배분된 배송비 Map. 빈 배열이면 빈 Map 반환.
 */
export function distributeShippingFee(
  entries: { id: string; quantity: number }[],
  totalShippingFee: number,
): Map<string, number> {
  if (entries.length === 0) return new Map();

  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return new Map();

  const result = new Map<string, number>();
  let remaining = totalShippingFee;

  // 2번째 항목부터 수량 비례로 배분하고, 남은 금액을 첫 번째 항목에 배정 (반올림 오차 흡수)
  for (let i = 1; i < entries.length; i++) {
    const fee = Math.round((totalShippingFee * entries[i].quantity) / totalQty);
    result.set(entries[i].id, fee);
    remaining -= fee;
  }
  result.set(entries[0].id, remaining);

  return result;
}
