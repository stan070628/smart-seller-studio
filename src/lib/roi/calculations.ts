// src/lib/roi/calculations.ts

/**
 * 마진액 계산
 * @param sellingPrice 판매가
 * @param costPrice 원가
 * @param feeRate 수수료율 (0~1)
 * @param deliveryFee 배송비
 * @returns 마진액
 */
export function calcMargin(
  sellingPrice: number,
  costPrice: number,
  feeRate: number,
  deliveryFee: number
): number {
  return sellingPrice - costPrice - sellingPrice * feeRate - deliveryFee;
}

/**
 * 손익분기 ROAS 계산 (간이과세자 기준)
 * @param sellingPrice 판매가
 * @param marginAmount 마진액
 * @returns 손익분기 ROAS (%), 마진액 0 이하이면 Infinity
 */
export function calcBreakevenRoas(sellingPrice: number, marginAmount: number): number {
  if (marginAmount <= 0) return Infinity;
  return (sellingPrice / marginAmount) * 100;
}

/**
 * 보정 ROAS 계산 (취소/반품 매출 제외)
 * @param attributedSales 광고 귀속 매출
 * @param cancelledSales 취소/반품 매출
 * @param adSpend 광고비
 * @returns 보정 ROAS (%), 광고비 0 이하이면 Infinity
 */
export function calcAdjustedRoas(
  attributedSales: number,
  cancelledSales: number,
  adSpend: number
): number {
  if (adSpend <= 0) return Infinity;
  return ((attributedSales - cancelledSales) / adSpend) * 100;
}

/**
 * 광고 키워드 성과 등급 판정
 * 기준: 클릭수 >= 100, 전환율 >= 1.5%, ROAS >= 250%, 판매건수 >= 5
 * @param clicks 클릭수
 * @param conversionRate 전환율 (%)
 * @param roas ROAS (%)
 * @param salesCount 판매건수
 * @returns 'winner' (4개 충족) | 'watch' (3개 충족) | 'normal' (2개 이하)
 */
export function isWinner(
  clicks: number,
  conversionRate: number,
  roas: number,
  salesCount: number
): 'winner' | 'watch' | 'normal' {
  const checks = [
    clicks >= 100,
    conversionRate >= 1.5,
    roas >= 250,
    salesCount >= 5,
  ];
  const passed = checks.filter(Boolean).length;
  if (passed === 4) return 'winner';
  if (passed === 3) return 'watch';
  return 'normal';
}

/**
 * 재고 소진일수 및 상태 계산
 * @param stockQty 현재 재고 수량
 * @param avgDailySales 일평균 판매 수량
 * @returns { days: 소진 예상일수, status: 'danger'(days < 7) | 'warning'(days >= 7 && days < 15) | 'ok'(days >= 15) }
 */
export function calcStockTurnover(
  stockQty: number,
  avgDailySales: number
): { days: number; status: 'danger' | 'warning' | 'ok' } {
  const days = avgDailySales > 0 ? stockQty / avgDailySales : Infinity;
  const status = days < 7 ? 'danger' : days < 15 ? 'warning' : 'ok';
  return { days, status };
}

/**
 * 목표 수익 달성을 위한 필요 매출액 계산
 * @param targetProfit 목표 수익액
 * @param marginRate 마진율 (0~1)
 * @returns 필요 매출액, 마진율 0 이하이면 Infinity
 */
export function calcRequiredRevenue(targetProfit: number, marginRate: number): number {
  if (marginRate <= 0) return Infinity;
  return targetProfit / marginRate;
}
