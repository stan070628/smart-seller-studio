/**
 * 1688 사입 마진 계산기
 *
 * 채널 spec v2 §6.5
 * 1688 위안가 + 환율 + 관세 + 국제배송 + (선택) 쿠팡 로켓그로스 운영비
 * → SKU별 실 마진. 도매꾹 위탁 마진과 비교하여 사입 전환 권장.
 */

import {
  CHANNEL_FEE,
  VAT_RATE,
  getCategoryFeeRate,
  type Channel,
} from './shared/channel-policy';

export type { Channel };

export const DEFAULT_EXCHANGE_RATE_KRW_PER_RMB = 195;
export const DEFAULT_TARIFF_RATE = 0.08;
export const IMPORT_VAT_RATE = 0.1;

export interface Margin1688Input {
  buyPriceRmb: number;
  exchangeRate: number;
  tariffRate: number;
  shippingPerUnitKrw: number;
  packQty: number;
  channel: Channel;
  categoryName: string | null;
  sellPrice: number;
  groceryRunningCost: number;
}

export interface Margin1688Result {
  perUnitRmb: number;
  landedKrw: number;
  tariffKrw: number;
  importVatKrw: number;
  purchaseCostKrw: number;
  totalCostKrw: number;
  channelFeeKrw: number;
  sellVatKrw: number;
  netProfit: number;
  marginRate: number;
  marginRatePct: number;
  isViable: boolean;
  channelFeeRate: number;
}

export function calc1688Margin(input: Margin1688Input): Margin1688Result {
  const perUnitRmb = input.buyPriceRmb / Math.max(input.packQty, 1);
  const landedKrw = perUnitRmb * input.exchangeRate;
  const tariffKrw = landedKrw * input.tariffRate;
  const importVatKrw = (landedKrw + tariffKrw) * IMPORT_VAT_RATE;
  const purchaseCostKrw = landedKrw + tariffKrw + importVatKrw + input.shippingPerUnitKrw;
  const totalCostKrw = purchaseCostKrw + input.groceryRunningCost;

  const channelFeeRate = getCategoryFeeRate(input.categoryName, input.channel) ?? CHANNEL_FEE[input.channel];
  const channelFeeKrw = input.sellPrice * channelFeeRate;
  const sellVatKrw = input.sellPrice * VAT_RATE;

  const netProfit = input.sellPrice - sellVatKrw - channelFeeKrw - totalCostKrw;
  const marginRate = input.sellPrice > 0 ? netProfit / input.sellPrice : 0;

  return {
    perUnitRmb: round2(perUnitRmb),
    landedKrw: round0(landedKrw),
    tariffKrw: round0(tariffKrw),
    importVatKrw: round0(importVatKrw),
    purchaseCostKrw: round0(purchaseCostKrw),
    totalCostKrw: round0(totalCostKrw),
    channelFeeKrw: round0(channelFeeKrw),
    sellVatKrw: round0(sellVatKrw),
    netProfit: round0(netProfit),
    marginRate,
    marginRatePct: Math.round(marginRate * 1000) / 10,
    isViable: netProfit > 0,
    channelFeeRate,
  };
}

export type WholesaleVsBuyRecommendation =
  | 'buy_strong'
  | 'buy'
  | 'hold'
  | 'wholesale_only'
  | 'insufficient_data';

export interface CompareInput {
  wholesaleMarginPerUnitKrw: number;
  buyMarginPerUnitKrw: number;
  monthlySalesQty: number;
  buyCapitalNeededKrw: number;
}

export interface CompareResult {
  recommendation: WholesaleVsBuyRecommendation;
  monthlyDiffKrw: number;
  paybackMonths: number | null;
  reason: string;
}

const HOLD_RATIO = 1.2;

export function compareWholesaleVsBuy(input: CompareInput): CompareResult {
  if (input.monthlySalesQty <= 0) {
    return {
      recommendation: 'insufficient_data',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: '월 판매량이 0이라 판단 불가',
    };
  }

  if (input.buyMarginPerUnitKrw < input.wholesaleMarginPerUnitKrw) {
    return {
      recommendation: 'wholesale_only',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: '사입 마진이 위탁 마진보다 낮음 — 전환 비추천',
    };
  }

  if (input.buyMarginPerUnitKrw < input.wholesaleMarginPerUnitKrw * HOLD_RATIO) {
    return {
      recommendation: 'hold',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: `마진 차이가 ${HOLD_RATIO}배 미만 — 사입 자본 리스크 대비 이득 부족`,
    };
  }

  const monthlyDiffKrw = (input.buyMarginPerUnitKrw - input.wholesaleMarginPerUnitKrw) * input.monthlySalesQty;
  const paybackMonths = monthlyDiffKrw > 0 ? input.buyCapitalNeededKrw / monthlyDiffKrw : null;

  if (paybackMonths !== null && paybackMonths < 1) {
    return {
      recommendation: 'buy_strong',
      monthlyDiffKrw,
      paybackMonths,
      reason: `자본 회수 ${paybackMonths.toFixed(2)}개월 — 즉시 사입 권장`,
    };
  }

  return {
    recommendation: 'buy',
    monthlyDiffKrw,
    paybackMonths,
    reason:
      paybackMonths !== null
        ? `자본 회수 ${paybackMonths.toFixed(1)}개월 예상`
        : '월 판매량 기준 회수 가능',
  };
}

function round0(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
