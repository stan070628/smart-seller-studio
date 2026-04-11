/**
 * costco-pricing.ts
 * 채널별 추천판매가 및 실질마진 계산
 *
 * 공식:
 *   net_profit = (sell_price × (1 - channel_fee) - buy_price - shipping - packing) / 1.10
 *   real_margin_rate = net_profit / sell_price
 *
 * 채널 수수료:
 *   네이버 스마트스토어: 6%
 *   쿠팡:               11%
 *
 * 물류비 (무게 구간별):
 *   < 2 kg  → 3,500원
 *   < 5 kg  → 4,500원
 *   < 10 kg → 7,000원
 *   ≥ 10 kg → 9,000원
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNEL_FEES = { naver: 0.06, coupang: 0.11 } as const;
export const PACKING_COST = 500;     // 포장비 (원)
export const VAT_DIVISOR  = 1.10;   // 부가세 포함 나누기 계수

export type Channel = 'naver' | 'coupang';

/** 카테고리별 목표 마진율 */
const CATEGORY_TARGET_RATES: Record<string, number> = {
  '식품':         0.13,
  '생활용품':     0.15,
  '건강·뷰티':   0.20,
  '건강보조식품': 0.20,
  '가구·침구':   0.18,
  '주방·식기':   0.18,
  '가전제품':     0.15,
  '의류·패션':   0.25,
  '자동차용품':   0.18,
  '반려동물':     0.18,
  '완구·스포츠': 0.20,
};

const DEFAULT_TARGET_RATE = 0.18;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface ChannelPricingResult {
  channel: Channel;
  recommendedPrice: number;
  netProfit: number;
  realMarginRate: number;   // 0~1 (net_profit / recommended_price)
  vsMarket: number | null;  // 양수 = 시장가보다 저렴한 정도 (%)
  isOverprice: boolean;     // 추천가가 시장가 초과 여부
  shippingCost: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 무게(kg) 기반 배송비 반환
 * null/0이면 기본 3,500원
 */
export function getShippingCost(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 3500;
  if (weightKg < 2)  return 3500;
  if (weightKg < 5)  return 4500;
  if (weightKg < 10) return 7000;
  return 9000;
}

/**
 * 상품 total_quantity + unit_type 에서 무게(kg) 추정
 * unit_type = 'weight' 일 때만 유효 (total_quantity = 그램 단위)
 */
export function getWeightKgFromProduct(product: {
  unit_type?: 'weight' | 'volume' | 'count' | null;
  total_quantity?: number | null;
}): number | null {
  if (product.unit_type === 'weight' && product.total_quantity && product.total_quantity > 0) {
    return product.total_quantity / 1000;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 채널별 추천판매가 및 마진 계산
 *
 * @param buyPrice      매입가 (코스트코 판매가)
 * @param categoryName  카테고리명 (목표 마진율 결정에 사용)
 * @param channel       판매 채널 ('naver' | 'coupang')
 * @param weightKg      상품 무게(kg) — null 이면 기본 배송비 적용
 * @param marketPrice   시장 최저가 (null 이면 vs_market 계산 불가)
 */
export function calcRecommendedPrice(
  buyPrice: number,
  categoryName: string | null,
  channel: Channel,
  weightKg: number | null,
  marketPrice: number | null,
): ChannelPricingResult {
  const fee = CHANNEL_FEES[channel];
  const shipping = getShippingCost(weightKg);
  const costs = buyPrice + shipping + PACKING_COST;
  const targetRate = CATEGORY_TARGET_RATES[categoryName ?? ''] ?? DEFAULT_TARGET_RATE;

  // 목표 마진율을 달성하는 최소 판매가:
  //   real_margin_rate = net_profit / sell = (sell*(1-fee) - costs) / (VAT_DIVISOR * sell)
  //   => sell * ((1-fee) - targetRate * VAT_DIVISOR) = costs
  //   => sell = costs / ((1-fee) - targetRate * VAT_DIVISOR)
  const divisor = (1 - fee) - targetRate * VAT_DIVISOR;
  let recommendedPrice: number;
  if (divisor <= 0) {
    // 목표 마진율이 너무 높아 계산 불가 → 손실분기점 가격으로 fallback
    recommendedPrice = Math.ceil((costs / (1 - fee)) / 100) * 100;
  } else {
    recommendedPrice = Math.ceil((costs / divisor) / 100) * 100;
  }

  const netProfit = Math.round(
    (recommendedPrice * (1 - fee) - costs) / VAT_DIVISOR,
  );
  const realMarginRate = recommendedPrice > 0 ? netProfit / recommendedPrice : 0;

  let vsMarket: number | null = null;
  let isOverprice = false;
  if (marketPrice && marketPrice > 0) {
    // 양수 = 추천가가 시장가보다 저렴함 (소비자 입장에서 이점)
    vsMarket = Math.round(((marketPrice - recommendedPrice) / marketPrice) * 1000) / 10;
    isOverprice = recommendedPrice > marketPrice;
  }

  return {
    channel,
    recommendedPrice,
    netProfit,
    realMarginRate,
    vsMarket,
    isOverprice,
    shippingCost: shipping,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 등급 계산
// ─────────────────────────────────────────────────────────────────────────────

export type SourcingGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * 소싱 스코어(0~100) → 등급 (S/A/B/C/D)
 *   S: 80 이상
 *   A: 65 이상
 *   B: 50 이상
 *   C: 35 이상
 *   D: 35 미만
 */
export function calcGrade(score: number): SourcingGrade {
  if (score >= 80) return 'S';
  if (score >= 65) return 'A';
  if (score >= 50) return 'B';
  if (score >= 35) return 'C';
  return 'D';
}

export const GRADE_COLORS: Record<SourcingGrade, { color: string; bg: string }> = {
  S: { color: '#7c3aed', bg: '#f3e8ff' },
  A: { color: '#15803d', bg: '#f0fdf4' },
  B: { color: '#2563eb', bg: '#eff6ff' },
  C: { color: '#ca8a04', bg: '#fefce8' },
  D: { color: '#9ca3af', bg: '#f9fafb' },
};
