/**
 * 건당 마진 = 판매가 − 원가 − 수수료 − 배송비 − 로켓그로스 물류비
 *
 * rgShippingFee: 로켓그로스 입출고비+배송비 (사이즈 유형별 정액).
 *   실측 정산액이 있으면 그 값을, 없으면 사이즈 기본값을 넘긴다.
 *   → src/lib/roi/rg-fees.ts 의 resolveRgShippingFee()
 *   판매자로켓(직접 배송) 건은 0을 넘기고 deliveryFee(택배비)만 반영한다.
 */
export function calcMargin(
  sellingPrice: number,
  costPrice: number,
  feeRate: number,
  deliveryFee: number,
  rgShippingFee = 0
): number {
  return sellingPrice - costPrice - sellingPrice * feeRate - deliveryFee - rgShippingFee;
}

// 간이과세자: 부가세 미적용 (손익분기 = 판매가 ÷ 마진액 × 100)
export function calcBreakevenRoas(sellingPrice: number, marginAmount: number): number {
  if (marginAmount <= 0) return Infinity;
  return (sellingPrice / marginAmount) * 100;
}

export function calcAdjustedRoas(
  attributedSales: number,
  cancelledSales: number,
  adSpend: number
): number {
  if (adSpend <= 0) return Infinity;
  return ((attributedSales - cancelledSales) / adSpend) * 100;
}

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

// 광고 클릭/전환율 데이터 연동 전, 사용 가능한 2축(판매수량 + ROAS vs 손익분기)으로 판정
const WINNER_MIN_QTY = 5;

export function determineWinnerStatus(
  qtySold: number,
  adRoas: number,
  breakevenRoas: number,
): 'winner' | 'watch' | 'normal' {
  const hasAds = adRoas > 0;
  // 광고가 있으면 ROAS ≥ 손익분기, 광고가 없으면 마진 양수(breakevenRoas 유한)일 때만 효율 통과로 간주
  const adEfficient = hasAds ? adRoas >= breakevenRoas : Number.isFinite(breakevenRoas);
  if (qtySold >= WINNER_MIN_QTY && adEfficient) return 'winner';
  if (qtySold >= WINNER_MIN_QTY && hasAds) return 'watch'; // 광고 없고 마진 음수인 경우 watch 제외
  if (qtySold >= 1 && hasAds && adEfficient) return 'watch';
  return 'normal';
}

export function calcStockTurnover(
  stockQty: number,
  avgDailySales: number
): { days: number; status: 'danger' | 'warning' | 'ok' } {
  const days = avgDailySales > 0 ? stockQty / avgDailySales : Infinity;
  const status = days < 7 ? 'danger' : days < 15 ? 'warning' : 'ok';
  return { days, status };
}

export function calcRequiredRevenue(targetProfit: number, marginRate: number): number {
  if (marginRate <= 0) return Infinity;
  return targetProfit / marginRate;
}
