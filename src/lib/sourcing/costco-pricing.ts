/**
 * costco-pricing.ts — v2
 * 코스트코 사입 모델 추천판매가 및 마진 계산
 *
 * v1 대비 변경 사항:
 *   - 1.4x 빠른판단 규칙 완전 제거 → 카테고리별 목표마진율 기반으로 대체
 *   - shared/channel-policy.ts 통합 (CHANNEL_FEE, VAT_RATE 중복 제거)
 *   - packQty(입수) 기반 개당 단가(perUnitPrice) 추가
 *   - compareCostcoWithMarket() 5단계 경쟁력 판정 추가
 *   - calcGrade / GRADE_COLORS → shared/grade.ts 위임 (하위 호환 re-export 유지)
 *
 * 공식:
 *   totalCost        = buyPrice + shippingCost + packingCost
 *   targetProfit     = max(totalCost × categoryTargetRate, 2000)
 *   recommendedPrice = ceil((totalCost + targetProfit) / (1 - channelFee - VAT_RATE) / 100) × 100
 *   perUnitPrice     = round(recommendedPrice / packQty / 10) × 10
 *   netProfit        = recommendedPrice × (1 - channelFee - VAT_RATE) - totalCost
 *   realMarginRate   = netProfit / recommendedPrice × 100  (%)
 */

import {
  CHANNEL_FEE,
  VAT_RATE,
  COSTCO_TARGET_MARGIN_RATE,
  calcNetProfit,
  calcNetMarginRate,
  type Channel,
} from './shared/channel-policy';
import { getGrade, GRADE_COLORS, type SourcingGrade } from './shared/grade';

export type { Channel, SourcingGrade };
export { GRADE_COLORS };

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 포장비 (원) */
export const PACKING_COST = 500;

/**
 * 카테고리별 목표 마진율 (사입 모델 — 재고 리스크 반영)
 * 미정의 카테고리는 COSTCO_TARGET_MARGIN_RATE(13%) 적용
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// 배송비 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 무게(kg) 기반 배송비
 * null/0이면 기본 3,500원
 *
 * < 2 kg  → 3,500원
 * < 5 kg  → 4,500원
 * < 10 kg → 7,000원
 * ≥ 10 kg → 9,000원
 */
export function getShippingCost(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 3500;
  if (weightKg < 2)  return 3500;
  if (weightKg < 5)  return 4500;
  if (weightKg < 10) return 7000;
  return 9000;
}

/**
 * 상품 unit_type + total_quantity에서 무게(kg) 추정
 * unit_type = 'weight' 일 때만 유효 (total_quantity = 그램 단위)
 */
export function getWeightKgFromProduct(product: {
  unit_type?: 'weight' | 'volume' | 'count' | null;
  total_quantity?: number | null;
}): number | null {
  if (
    product.unit_type === 'weight' &&
    product.total_quantity &&
    product.total_quantity > 0
  ) {
    return product.total_quantity / 1000;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface CostcoPriceInput {
  /** 코스트코 매입가 (VAT 포함 구매가) */
  buyPrice: number;
  /** 입수 단위 (쉐이빙폼 6개입 → 6, 단품이면 1) */
  packQty: number;
  /** 카테고리명 (목표 마진율 결정) */
  categoryName: string | null;
  /** 판매 채널 */
  channel: Channel;
  /** 무게(kg) — null이면 3,500원 기본 배송비 */
  weightKg?: number | null;
  /** 포장비 — null이면 500원 기본값 */
  packingCost?: number | null;
  /** 시장 최저가 (null이면 vsMarket 계산 불가) */
  marketPrice?: number | null;
}

export interface CostcoPriceResult {
  channel: Channel;
  /** 추천 판매가 (100원 단위 반올림) */
  recommendedPrice: number;
  /** 개당 단가 = recommendedPrice / packQty (10원 단위 반올림) */
  perUnitPrice: number;
  /** 원가 합계 (매입가 + 배송비 + 포장비) */
  totalCost: number;
  /** 순이익 (원) */
  netProfit: number;
  /** 순이익률 (%). netProfit / recommendedPrice × 100 */
  realMarginRate: number;
  /** 배송비 (원) */
  shippingCost: number;
  /** 시장가 대비 격차율 (%). 양수 = 추천가가 시장가보다 저렴. null = 데이터 없음 */
  vsMarket: number | null;
  /** 추천가가 시장가를 초과하는 여부 */
  isOverprice: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 핵심 계산 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 코스트코 채널별 추천판매가 + 마진 계산 (v2)
 *
 * 1.4x 규칙 완전 제거.
 * 카테고리별 목표마진율로 추천가를 역산하여 "사입 자본 회수"를 최우선으로 보장.
 */
export function calcCostcoPrice(input: CostcoPriceInput): CostcoPriceResult {
  const { buyPrice, packQty, categoryName, channel } = input;
  const shipping   = getShippingCost(input.weightKg ?? null);
  const packing    = input.packingCost ?? PACKING_COST;
  const totalCost  = buyPrice + shipping + packing;

  const targetRate   = CATEGORY_TARGET_RATES[categoryName ?? ''] ?? COSTCO_TARGET_MARGIN_RATE;
  const targetProfit = Math.max(Math.floor(totalCost * targetRate), 2000);

  const deductionRate = 1 - CHANNEL_FEE[channel] - VAT_RATE;
  const raw = (totalCost + targetProfit) / deductionRate;
  const recommendedPrice = Math.round(raw / 100) * 100;

  const safePackQty  = Math.max(packQty, 1);
  const perUnitPrice = Math.round(recommendedPrice / safePackQty / 10) * 10;

  const netProfit      = calcNetProfit(recommendedPrice, totalCost, channel);
  const realMarginRate = calcNetMarginRate(recommendedPrice, totalCost, channel);

  const marketPrice = input.marketPrice ?? null;
  let vsMarket: number | null = null;
  let isOverprice = false;
  if (marketPrice && marketPrice > 0) {
    vsMarket = Math.round(((marketPrice - recommendedPrice) / marketPrice) * 1000) / 10;
    isOverprice = recommendedPrice > marketPrice;
  }

  return {
    channel,
    recommendedPrice,
    perUnitPrice,
    totalCost,
    netProfit,
    realMarginRate,
    shippingCost: shipping,
    vsMarket,
    isOverprice,
  };
}

/**
 * 하위 호환 래퍼 (CostcoTab.tsx 기존 호출 시그니처 유지)
 * 신규 코드에서는 calcCostcoPrice() 사용 권장
 *
 * @deprecated calcCostcoPrice() 사용 권장
 */
export function calcRecommendedPrice(
  buyPrice: number,
  categoryName: string | null,
  channel: Channel,
  weightKg: number | null,
  marketPrice: number | null,
): CostcoPriceResult {
  return calcCostcoPrice({
    buyPrice,
    packQty: 1,
    categoryName,
    channel,
    weightKg,
    marketPrice,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 시장가 경쟁력 5단계 판정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 시장가 경쟁력 5단계
 *   강력한 경쟁력: 시장가 대비 15%+ 저렴
 *   경쟁력 보통:   10%+ 저렴
 *   시장가 근접:   0~9% 저렴
 *   시장가 초과:   추천가가 시장가 이상
 *   데이터 없음:   시장가 미입력
 */
export type PriceCompStatus =
  | '강력한 경쟁력'
  | '경쟁력 보통'
  | '시장가 근접'
  | '시장가 초과'
  | '데이터 없음';

/**
 * vsMarket(%) → 5단계 경쟁력 판정
 * vsMarket = (시장가 - 추천가) / 시장가 × 100
 */
export function getPriceCompStatus(vsMarket: number | null): PriceCompStatus {
  if (vsMarket === null) return '데이터 없음';
  if (vsMarket >= 15)    return '강력한 경쟁력';
  if (vsMarket >= 10)    return '경쟁력 보통';
  if (vsMarket >= 0)     return '시장가 근접';
  return '시장가 초과';
}

/** 경쟁력 상태별 색상 */
export const PRICE_COMP_STYLE: Record<PriceCompStatus, { color: string; bg: string }> = {
  '강력한 경쟁력': { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  '경쟁력 보통':   { color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  '시장가 근접':   { color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  '시장가 초과':   { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  '데이터 없음':   { color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 채널 2개 동시 비교
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketCompareResult {
  naverResult: CostcoPriceResult;
  coupangResult: CostcoPriceResult;
  naverStatus: PriceCompStatus;
  coupangStatus: PriceCompStatus;
  /** 순이익률 기준 더 유리한 채널 */
  betterChannel: Channel;
}

/**
 * 네이버/쿠팡 추천가를 동시 계산하고 경쟁력 비교
 *
 * 코스트코 상품은 단품 판매가 기본 → packQty는 입수 단위 표시용
 */
export function compareCostcoWithMarket(
  buyPrice: number,
  packQty: number,
  categoryName: string | null,
  weightKg: number | null,
  naverLowest: number | null,
  coupangLowest: number | null,
): MarketCompareResult {
  const naverResult   = calcCostcoPrice({ buyPrice, packQty, categoryName, channel: 'naver',   weightKg, marketPrice: naverLowest });
  const coupangResult = calcCostcoPrice({ buyPrice, packQty, categoryName, channel: 'coupang', weightKg, marketPrice: coupangLowest });

  return {
    naverResult,
    coupangResult,
    naverStatus:   getPriceCompStatus(naverResult.vsMarket),
    coupangStatus: getPriceCompStatus(coupangResult.vsMarket),
    betterChannel: naverResult.realMarginRate >= coupangResult.realMarginRate ? 'naver' : 'coupang',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 등급 — shared/grade.ts 위임 (CostcoTab.tsx 하위 호환)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 소싱 스코어 → 등급 문자 반환 (CostcoTab.tsx 하위 호환)
 * 신규 코드에서는 shared/grade.ts의 getGrade() 직접 사용 권장
 *
 * @deprecated getGrade() 사용 권장
 */
export function calcGrade(score: number): SourcingGrade {
  return getGrade(score).grade;
}
