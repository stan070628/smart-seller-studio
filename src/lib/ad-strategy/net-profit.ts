/** 건당 마진 = 판매가 × (1 - 수수료율) - 원가 */
export function calcMarginPerUnit(
  salePrice: number,
  costPrice: number,
  feeRate: number,
): number {
  return Math.round(salePrice * (1 - feeRate) - costPrice);
}

/**
 * 손익분기점 ROAS (부가세 보정 포함)
 * = (판매가 ÷ 마진) × 1.1 × 100
 * 마진 ≤ 0 이면 Infinity 반환
 */
export function calcBreakEvenRoas(salePrice: number, marginPerUnit: number): number {
  if (marginPerUnit <= 0) return Infinity;
  return (salePrice / marginPerUnit) * 1.1 * 100;
}

interface NetProfitInput {
  monthlySales: number;
  monthlyAdSpend: number;
  marginPerUnit: number;
}

interface NetProfitResult {
  perUnit: number;    // 건당 순이익 (원)
  monthly: number;    // 월 순이익 (원)
}

/**
 * 순이익 계산
 * - 판매량 0이면 광고비 안분 불가 → 건당 순이익 = 마진(광고비 미반영)
 */
export function calcNetProfit(input: NetProfitInput): NetProfitResult {
  const { monthlySales, monthlyAdSpend, marginPerUnit } = input;

  if (monthlySales === 0) {
    return { perUnit: marginPerUnit, monthly: 0 };
  }

  const adCostPerUnit = Math.round(monthlyAdSpend / monthlySales);
  const perUnit = marginPerUnit - adCostPerUnit;
  const monthly = perUnit * monthlySales;

  return { perUnit, monthly };
}
