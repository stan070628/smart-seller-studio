import { salesVat } from '@/lib/tax';

export interface MarginInput {
  /** 상품 페이지에 **표시되는** 판매가. 판매자 부담 할인을 빼기 전 금액이다 */
  sellingPrice: number;
  /** 매입 원가 (개당 가중평균) */
  costPrice: number;
  /**
   * 판매 수수료율. 간이과세자는 매입세액 공제를 받지 못하므로
   * 고지 요율이 아니라 `effectiveFeeRate()`를 거친 실효 요율을 넘긴다.
   */
  feeRate: number;
  /**
   * 개당 배송비. 로켓그로스는 **입고 물류비**(박스값+택배비 ÷ 입고수량),
   * 판매자로켓·마켓플레이스는 출고 택배비를 넘긴다.
   */
  deliveryFee?: number;
  /**
   * 로켓그로스 입출고비+배송비 (사이즈 유형별 정액).
   *   실측 정산액이 있으면 그 값을, 없으면 사이즈 기본값을 넘긴다.
   *   → src/lib/roi/rg-fees.ts 의 resolveRgShippingFee()
   *   판매자로켓(직접 배송) 건은 0을 넘기고 deliveryFee(택배비)만 반영한다.
   */
  rgShippingFee?: number;
  /**
   * 판매자가 부담하는 할인액 (즉시할인쿠폰 · `SELLER_FREE_EXPOSURE` 등).
   *
   * 쿠팡 프로모션(쿠팡 부담)은 여기 넣지 않는다. 항목명에 `SELLER_`가 붙는지로 가른다 —
   * 2026-08-13 실측에서 옐로우 할인 680원을 쿠팡 부담으로 오판해 마진이 뒤집힌 전례가 있다.
   */
  sellerDiscount?: number;
}

/**
 * 건당 마진 = 정산 기준가 − 원가 − 수수료 − 배송비 − 로켓그로스 물류비 − 매출세액
 *
 * **정산 기준가 = 표시 판매가 − 판매자 부담 할인**이며, 수수료와 매출세액은 표시 판매가가 아니라
 * 이 정산 기준가에 붙는다(2026-08-13 예상 정산액 화면에서 확인: 12,120원 × 10.00% = 1,212원).
 *
 * 매출세액은 간이과세자 소매업 기준 정산 기준가의 1.5%다 → src/lib/tax.ts 의 salesVat()
 */
export function calcMargin(input: MarginInput): number {
  const { sellingPrice, costPrice, feeRate } = input;
  const deliveryFee = input.deliveryFee ?? 0;
  const rgShippingFee = input.rgShippingFee ?? 0;
  const sellerDiscount = input.sellerDiscount ?? 0;

  const settlementPrice = sellingPrice - sellerDiscount;

  return (
    settlementPrice
    - costPrice
    - settlementPrice * feeRate
    - deliveryFee
    - rgShippingFee
    - salesVat(settlementPrice)
  );
}

/**
 * 손익분기 ROAS = 판매가 ÷ 마진액 × 100
 *
 * 매출세액은 `calcMargin`이 이미 차감하므로 여기서 다시 보정하지 않는다.
 * 광고비 자체의 VAT 보정이 필요한 경로는 ad-strategy/net-profit.ts 의 calcBreakEvenRoas를 쓴다.
 */
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
