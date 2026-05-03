/**
 * 플랫폼별 마진 계산 로직
 */

import {
  COUPANG_WING,
  COUPANG_ROCKET_LOGISTICS,
  COUPANG_ROCKET,
  NAVER_ORDER_MGMT_FEE,
  NAVER_SALES_FEE,
  GMARKET_CATEGORIES,
  GMARKET,
  ELEVENST_CATEGORIES,
  ELEVENST,
  SHOPEE_DATA,
  SHOPEE_SERVICE_PROGRAMS,
  type RocketSize,
  type NaverGrade,
  type NaverInflow,
  type ShopeeCountry,
  type ShopeeProgram,
} from './fees';

export interface CalcResult {
  items: { label: string; amount: number; rate?: number }[];
  totalFees: number;
  netProfit: number;
  marginRate: number;
  breakEvenCost: number;
  /** 광고비 제외 순이익 (광고 전 마진) */
  profitBeforeAd: number;
  /** 손익분기 ROAS (%) — 이 이하로 광고하면 적자 */
  breakEvenRoas: number | null;
  /** 권장 목표 ROAS (%) — 손익분기 + 200% */
  targetRoas: number | null;
  /** 최대 허용 CPC (원) — 전환율 기반 */
  maxCpc: number | null;
}

/** 광고 전 마진과 ROAS를 계산하는 공통 헬퍼 */
function calcAdMetrics(
  sellingPrice: number,
  totalFeesExcludingAd: number,
  costPrice: number,
  conversionRate: number = 0,
) {
  const profitBeforeAd = sellingPrice - costPrice - totalFeesExcludingAd;
  // ×1.1 보정: 쿠팡 광고비는 부가세 제외로 표시되므로 실제 최소 ROAS는 더 높아야 함
  const breakEvenRoas = profitBeforeAd > 0
    ? Math.round((sellingPrice / profitBeforeAd) * 1.1 * 100)
    : null;
  const targetRoas = breakEvenRoas != null ? breakEvenRoas + 200 : null;
  const maxCpc = (conversionRate > 0 && profitBeforeAd > 0)
    ? Math.round(profitBeforeAd * conversionRate)
    : null;
  return { profitBeforeAd, breakEvenRoas, targetRoas, maxCpc };
}

// ─── 쿠팡 윙 ──────────────────────────────────────────────────
export function calcCoupangWing(p: {
  costPrice: number;
  sellingPrice: number;
  /** 0 < feeRate < 1. resolveCoupangFee()의 rate 또는 사용자 입력값 */
  feeRate: number;
  shippingFee: number;
  adCost: number;
  conversionRate?: number;
}): CalcResult {
  const rate = p.feeRate;
  const commission = Math.round(p.sellingPrice * rate);
  const shippingCommission = Math.round(p.shippingFee * COUPANG_WING.shippingFeeRate);

  const items = [
    { label: '판매 수수료', amount: commission, rate },
    { label: '배송비 수수료', amount: shippingCommission, rate: COUPANG_WING.shippingFeeRate },
    { label: '광고비', amount: p.adCost },
  ];

  const totalFees = commission + shippingCommission + p.adCost;
  const netProfit = p.sellingPrice - p.costPrice - totalFees;
  const marginRate = p.sellingPrice > 0 ? (netProfit / p.sellingPrice) * 100 : 0;
  const breakEvenCost = p.sellingPrice - totalFees;
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + shippingCommission, p.costPrice, p.conversionRate ?? 0);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}

// ─── 쿠팡 로켓그로스 ──────────────────────────────────────────
export function calcCoupangRocket(p: {
  costPrice: number;
  sellingPrice: number;
  feeRate: number;
  size: RocketSize;
  monthlyQty: number;
  adCost: number;
  conversionRate?: number;
}): CalcResult {
  const rate = p.feeRate;
  const commission = Math.round(p.sellingPrice * rate);
  const logistics = COUPANG_ROCKET_LOGISTICS[p.size] ?? 0;
  const storageFee = Math.round(
    p.monthlyQty > 0
      ? (p.monthlyQty * COUPANG_ROCKET.storageFeePerDay * 15) // 평균 15일 보관 추정
      : 0
  );

  const items = [
    { label: '판매 수수료', amount: commission, rate },
    { label: '물류비 (입출고+배송)', amount: logistics },
    { label: '보관료 (추정)', amount: storageFee },
    { label: '광고비', amount: p.adCost },
  ];

  const totalFees = commission + logistics + storageFee + p.adCost;
  const netProfit = p.sellingPrice - p.costPrice - totalFees;
  const marginRate = p.sellingPrice > 0 ? (netProfit / p.sellingPrice) * 100 : 0;
  const breakEvenCost = p.sellingPrice - totalFees;
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + logistics + storageFee, p.costPrice, p.conversionRate ?? 0);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}

// ─── 네이버 ────────────────────────────────────────────────────
export function calcNaver(p: {
  costPrice: number;
  sellingPrice: number;
  shippingFee: number;
  grade: NaverGrade;
  inflow: NaverInflow;
  adCost: number;
  conversionRate?: number;
}): CalcResult {
  const orderMgmtRate = NAVER_ORDER_MGMT_FEE[p.grade] ?? 0.0363;
  const salesRate = NAVER_SALES_FEE[p.inflow] ?? 0.0273;

  const orderMgmtFee = Math.round((p.sellingPrice + p.shippingFee) * orderMgmtRate);
  const salesFee = Math.round(p.sellingPrice * salesRate);

  const items = [
    { label: '주문관리 수수료', amount: orderMgmtFee, rate: orderMgmtRate },
    { label: '판매 수수료', amount: salesFee, rate: salesRate },
    { label: '광고비', amount: p.adCost },
  ];

  const totalFees = orderMgmtFee + salesFee + p.adCost;
  const netProfit = p.sellingPrice - p.costPrice - totalFees;
  const marginRate = p.sellingPrice > 0 ? (netProfit / p.sellingPrice) * 100 : 0;
  const breakEvenCost = p.sellingPrice - totalFees;
  const adMetrics = calcAdMetrics(p.sellingPrice, orderMgmtFee + salesFee, p.costPrice, p.conversionRate ?? 0);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}

// ─── G마켓 ─────────────────────────────────────────────────────
export function calcGmarket(p: {
  costPrice: number;
  sellingPrice: number;
  category: string;
  shippingFee: number;
  couponDiscount: number;
  adCost: number;
  conversionRate?: number;
}): CalcResult {
  const rate = GMARKET_CATEGORIES[p.category] ?? 0.11;
  const commission = Math.round(p.sellingPrice * rate);
  const shippingCommission = Math.round(p.shippingFee * GMARKET.shippingFeeRate);
  const couponBurden = Math.round(p.couponDiscount * GMARKET.couponSellerShare);

  const items = [
    { label: '카테고리 수수료', amount: commission, rate },
    { label: '배송비 수수료', amount: shippingCommission, rate: GMARKET.shippingFeeRate },
    { label: '쿠폰 부담금', amount: couponBurden },
    { label: '광고비', amount: p.adCost },
  ];

  const totalFees = commission + shippingCommission + couponBurden + p.adCost;
  const netProfit = p.sellingPrice - p.costPrice - totalFees;
  const marginRate = p.sellingPrice > 0 ? (netProfit / p.sellingPrice) * 100 : 0;
  const breakEvenCost = p.sellingPrice - totalFees;
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + shippingCommission + couponBurden, p.costPrice, p.conversionRate ?? 0);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}

// ─── 11번가 ────────────────────────────────────────────────────
export function calcElevenst(p: {
  costPrice: number;
  sellingPrice: number;
  category: string;
  shippingFee: number;
  couponDiscount: number;
  isNewSeller: boolean;
  adCost: number;
  conversionRate?: number;
}): CalcResult {
  const baseRate = ELEVENST_CATEGORIES[p.category] ?? 0.13;
  const rate = p.isNewSeller ? Math.min(baseRate, ELEVENST.newSellerPromoRate) : baseRate;
  const commission = Math.round(p.sellingPrice * rate);
  const shippingCommission = Math.round(p.shippingFee * ELEVENST.shippingFeeRate);
  const couponBurden = Math.round(p.couponDiscount * ELEVENST.couponSellerShare);

  const items = [
    { label: '카테고리 수수료', amount: commission, rate },
    { label: '배송비 수수료', amount: shippingCommission, rate: ELEVENST.shippingFeeRate },
    { label: '쿠폰 부담금', amount: couponBurden },
    { label: '광고비', amount: p.adCost },
  ];

  const totalFees = commission + shippingCommission + couponBurden + p.adCost;
  const netProfit = p.sellingPrice - p.costPrice - totalFees;
  const marginRate = p.sellingPrice > 0 ? (netProfit / p.sellingPrice) * 100 : 0;
  const breakEvenCost = p.sellingPrice - totalFees;
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + shippingCommission + couponBurden, p.costPrice, p.conversionRate ?? 0);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}

// ─── Shopee ────────────────────────────────────────────────────
export function calcShopee(p: {
  costPriceKRW: number;
  sellingPriceLocal: number;
  exchangeRate: number;
  country: ShopeeCountry;
  category: string;
  program: ShopeeProgram;
  affiliateRate: number;
  shippingFeeKRW: number;
  adCostKRW: number;
  conversionRateKRW?: number;
}): CalcResult & { currency: string } {
  const countryData = SHOPEE_DATA[p.country];
  const commissionRate = countryData.commission[p.category] ?? 0.04;
  const transactionRate = countryData.transactionFee;
  const serviceRate = SHOPEE_SERVICE_PROGRAMS[p.program] ?? 0;

  const commissionLocal = p.sellingPriceLocal * commissionRate;
  const transactionLocal = p.sellingPriceLocal * transactionRate;
  const serviceLocal = p.sellingPriceLocal * serviceRate;
  const affiliateLocal = p.sellingPriceLocal * (p.affiliateRate / 100);

  const totalFeesLocal = commissionLocal + transactionLocal + serviceLocal + affiliateLocal;
  const totalFeesKRW = Math.round(totalFeesLocal * p.exchangeRate);

  const sellingPriceKRW = Math.round(p.sellingPriceLocal * p.exchangeRate);
  const netProfit = sellingPriceKRW - p.costPriceKRW - totalFeesKRW - p.shippingFeeKRW - p.adCostKRW;
  const marginRate = sellingPriceKRW > 0 ? (netProfit / sellingPriceKRW) * 100 : 0;

  const items = [
    { label: 'Commission Fee', amount: Math.round(commissionLocal * p.exchangeRate), rate: commissionRate },
    { label: 'Transaction Fee', amount: Math.round(transactionLocal * p.exchangeRate), rate: transactionRate },
    { label: 'Service Fee', amount: Math.round(serviceLocal * p.exchangeRate), rate: serviceRate },
    { label: 'Affiliate Fee', amount: Math.round(affiliateLocal * p.exchangeRate), rate: p.affiliateRate / 100 },
    { label: '배송비', amount: p.shippingFeeKRW },
    { label: '광고비', amount: p.adCostKRW },
  ];

  const breakEvenCost = sellingPriceKRW - totalFeesKRW - p.shippingFeeKRW - p.adCostKRW;
  const adMetrics = calcAdMetrics(sellingPriceKRW, totalFeesKRW + p.shippingFeeKRW, p.costPriceKRW, p.conversionRateKRW ?? 0);

  return {
    items,
    totalFees: totalFeesKRW + p.shippingFeeKRW + p.adCostKRW,
    netProfit,
    marginRate,
    breakEvenCost,
    currency: countryData.currency,
    ...adMetrics,
  };
}

// ─── 비교 모드용 간이 계산 ────────────────────────────────────
export interface CompareResult {
  platform: string;
  commissionFee: number;
  shippingCommission: number;
  totalFees: number;
  netProfit: number;
  marginRate: number;
}

export function calcCompareAll(p: {
  costPrice: number;
  sellingPrice: number;
  shippingFee: number;
  /** 쿠팡 윙/로켓용 수수료율 (0~1) */
  feeRate: number;
  /** G마켓/11번가 카테고리 수수료 룩업용 */
  category: string;
}): CompareResult[] {
  const wing = calcCoupangWing({ costPrice: p.costPrice, sellingPrice: p.sellingPrice, feeRate: p.feeRate, shippingFee: p.shippingFee, adCost: 0 });
  const rocket = calcCoupangRocket({
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    feeRate: p.feeRate,
    size: '소형',
    monthlyQty: 0,
    adCost: 0,
  });
  const naver = calcNaver({
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    shippingFee: p.shippingFee,
    grade: '일반',
    inflow: '네이버쇼핑',
    adCost: 0,
  });
  const gmarket = calcGmarket({
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    shippingFee: p.shippingFee,
    category: p.category,
    couponDiscount: 0,
    adCost: 0,
  });
  const elevenst = calcElevenst({
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    shippingFee: p.shippingFee,
    category: p.category,
    couponDiscount: 0,
    isNewSeller: false,
    adCost: 0,
  });

  return [
    { platform: '쿠팡 윙', commissionFee: wing.items[0].amount, shippingCommission: wing.items[1].amount, totalFees: wing.totalFees, netProfit: wing.netProfit, marginRate: wing.marginRate },
    { platform: '쿠팡 로켓', commissionFee: rocket.items[0].amount, shippingCommission: rocket.items[1].amount, totalFees: rocket.totalFees, netProfit: rocket.netProfit, marginRate: rocket.marginRate },
    { platform: '네이버', commissionFee: naver.items[0].amount + naver.items[1].amount, shippingCommission: 0, totalFees: naver.totalFees, netProfit: naver.netProfit, marginRate: naver.marginRate },
    { platform: 'G마켓', commissionFee: gmarket.items[0].amount, shippingCommission: gmarket.items[1].amount, totalFees: gmarket.totalFees, netProfit: gmarket.netProfit, marginRate: gmarket.marginRate },
    { platform: '11번가', commissionFee: elevenst.items[0].amount, shippingCommission: elevenst.items[1].amount, totalFees: elevenst.totalFees, netProfit: elevenst.netProfit, marginRate: elevenst.marginRate },
  ];
}
