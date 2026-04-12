/**
 * domeggook-pricing.ts
 * MOQ 기반 드롭쉬핑 묶음 판매가 계산
 *
 * 공식:
 *   bundleMinPrice = (도매가 × MOQ + 배송비) / (1 - 마켓수수료 - VAT)
 *                  = (도매가 × MOQ + 배송비) / 0.80
 *
 * 시장가 비교는 bundleMinPrice 전체가 아닌 **perUnitPrice (개당 단가)** 기준
 *   perUnitPrice = bundleMinPrice / MOQ
 *
 * MOQ 전략:
 *   MOQ = 1  → 단품  (strategy: 'single')
 *   MOQ = 2  → 1+1   (strategy: '1+1')
 *   MOQ = 3  → 2+1   (strategy: '2+1')
 *   MOQ >= 4 → 제외  (strategy: null)
 */

import { getCategoryFeeRate } from '@/lib/sourcing/shared/channel-policy';

/** VAT */
const VAT_RATE = 0.10;

/**
 * 공제율 계산 (카테고리별 수수료 반영)
 * 기본값: 네이버 기준 = 1 - 0.06 - 0.10 = 0.84
 */
function getDeductionRate(categoryName?: string | null): number {
  const feeRate = getCategoryFeeRate(categoryName, 'naver');
  return 1 - feeRate - VAT_RATE;
}

export type MoqStrategy = 'single' | '1+1' | '2+1' | null;

/**
 * 시장가 경쟁력 5단계 상태
 *   강력한 경쟁력: perUnitPrice가 시장가 대비 30%+ 저렴
 *   경쟁력 보통:   20%+ 저렴
 *   시장가 근접:   5%+ 저렴
 *   시장가 초과:   perUnitPrice가 시장가보다 비쌈
 *   데이터 없음:   시장가 미입력
 */
export type PriceCompStatus =
  | '강력한 경쟁력'
  | '경쟁력 보통'
  | '시장가 근접'
  | '시장가 초과'
  | '데이터 없음';

export interface MoqScenario {
  moq: number;
  strategy: MoqStrategy;
  /** 묶음 최소 판매가 (break-even). null = 계산 불가 */
  bundleMinPrice: number | null;
  /** 개당 단가 (bundleMinPrice / MOQ) — 시장가 비교 기준 */
  perUnitPrice: number | null;
  /** 단가 격차율 (%). (시장가 - perUnitPrice) / 시장가 × 100 */
  priceGapRate: number | null;
  /** 마진율 (%). (시장가×(1-fee) - perUnitPrice) / 시장가 × 100 */
  marginRate: number | null;
  /** 가격 경쟁력 5단계 상태 */
  priceCompStatus: PriceCompStatus;
  /** 추천 전략 여부 (priceGapRate 최대 양수 시나리오) */
  isRecommended?: boolean;
}

export interface BundlePriceInput {
  /** 도매꾹 도매가 (원) */
  priceDome: number;
  /** 배송비 부담: 'S'=무료, 'P'=선결제, 'B'=착불, 'C'=선택 */
  deliWho: string | null;
  /** 배송비 금액 (원). deliWho='S'이면 0으로 처리 */
  deliFee: number | null;
  /** MOQ */
  moq: number;
  /** 카테고리명 (카테고리별 수수료 적용). 없으면 기본값 사용 */
  categoryName?: string | null;
}

/**
 * MOQ 기반 묶음 최소 판매가 계산 (카테고리별 수수료 반영)
 */
export function calcBundleMinPrice(input: BundlePriceInput): number {
  const { priceDome, deliWho, deliFee, moq, categoryName } = input;
  const effectiveDeliF = deliWho === 'S' ? 0 : (deliFee ?? 0);
  const deductionRate = getDeductionRate(categoryName);
  return Math.ceil((priceDome * moq + effectiveDeliF) / deductionRate);
}

/**
 * 개당 단가 계산 (시장가 비교 기준)
 * 단품(MOQ=1): bundleMinPrice 그대로
 * 1+1(MOQ=2): bundleMinPrice / 2
 * 2+1(MOQ=3): bundleMinPrice / 3
 */
export function calcPerUnitPrice(bundleMinPrice: number, moq: number): number {
  return Math.ceil(bundleMinPrice / moq);
}

/**
 * 단가 격차율 계산 (개당 단가 vs 시장가)
 * 양수 = 드롭쉬핑 단가가 시장가보다 저렴 (경쟁력 있음)
 * 음수 = 시장가가 더 저렴 (경쟁력 없음)
 */
export function calcPriceGapRate(perUnitPrice: number, marketPrice: number): number {
  return Math.round(((marketPrice - perUnitPrice) / marketPrice) * 10000) / 100;
}

/**
 * 판매자 측 마진율 계산 (개당 단가 기준)
 *
 * perUnitPrice는 break-even 최소판매가 = 실제원가 / deductionRate
 * → 실제원가 = perUnitPrice × deductionRate
 *
 * 마진율 = (시장가 실수익 - 실제원가) / 시장가 × 100
 *        = (marketPrice × deductionRate - perUnitPrice × deductionRate) / marketPrice × 100
 *        = deductionRate × (marketPrice - perUnitPrice) / marketPrice × 100
 */
export function calcMarginRate(
  perUnitPrice: number,
  marketPrice: number,
  categoryName?: string | null,
): number {
  const deductionRate = getDeductionRate(categoryName);
  return Math.round((deductionRate * (marketPrice - perUnitPrice) / marketPrice) * 10000) / 100;
}

/**
 * 가격 경쟁력 5단계 상태 판정
 * priceGapRate: (시장가 - perUnitPrice) / 시장가 × 100
 */
export function getPriceCompStatus(priceGapRate: number | null): PriceCompStatus {
  if (priceGapRate === null) return '데이터 없음';
  if (priceGapRate >= 30)   return '강력한 경쟁력';
  if (priceGapRate >= 20)   return '경쟁력 보통';
  if (priceGapRate >= 5)    return '시장가 근접';
  if (priceGapRate >= 0)    return '시장가 근접';
  return '시장가 초과';
}

/**
 * 시장가 비교 종합 결과 (UI 표시용)
 */
export function compareWithMarket(
  priceDome: number,
  moq: number,
  deliWho: string | null,
  deliFee: number | null,
  marketPrice: number | null,
  categoryName?: string | null,
): {
  bundleMinPrice: number;
  perUnitPrice: number;
  priceGapRate: number | null;
  marginRate: number | null;
  status: PriceCompStatus;
} {
  const bundleMinPrice = calcBundleMinPrice({ priceDome, deliWho, deliFee, moq, categoryName });
  const perUnitPrice = calcPerUnitPrice(bundleMinPrice, moq);
  const priceGapRate = marketPrice ? calcPriceGapRate(perUnitPrice, marketPrice) : null;
  const marginRate = marketPrice ? calcMarginRate(perUnitPrice, marketPrice, categoryName) : null;
  const status = getPriceCompStatus(priceGapRate);
  return { bundleMinPrice, perUnitPrice, priceGapRate, marginRate, status };
}

/**
 * MOQ 전략 결정
 * MOQ >= 4 이면 드롭쉬핑 불가 → null
 */
export function getMoqStrategy(moq: number): MoqStrategy {
  if (moq <= 0) return null;
  if (moq === 1) return 'single';
  if (moq === 2) return '1+1';
  if (moq === 3) return '2+1';
  return null; // MOQ >= 4: 제외
}

/**
 * MOQ 시나리오 비교 (1~3 모두 계산)
 * isRecommended: priceGapRate 양수 중 최대값 시나리오
 */
export function calcAllScenarios(
  priceDome: number,
  deliWho: string | null,
  deliFee: number | null,
  marketPrice: number | null,
  categoryName?: string | null,
): MoqScenario[] {
  const scenarios: MoqScenario[] = [1, 2, 3].map((moq) => {
    const strategy = getMoqStrategy(moq);
    const bundleMinPrice = calcBundleMinPrice({ priceDome, deliWho, deliFee, moq, categoryName });
    const perUnitPrice = calcPerUnitPrice(bundleMinPrice, moq);
    const priceGapRate = marketPrice ? calcPriceGapRate(perUnitPrice, marketPrice) : null;
    const marginRate = marketPrice ? calcMarginRate(perUnitPrice, marketPrice, categoryName) : null;
    const priceCompStatus = getPriceCompStatus(priceGapRate);
    return { moq, strategy, bundleMinPrice, perUnitPrice, priceGapRate, marginRate, priceCompStatus };
  });

  // 추천 전략: priceGapRate 양수 중 최대
  const bestGap = Math.max(
    ...scenarios
      .map((s) => s.priceGapRate ?? -Infinity)
      .filter((g) => g > 0),
  );
  if (bestGap > 0) {
    const bestIdx = scenarios.findIndex((s) => s.priceGapRate === bestGap);
    if (bestIdx >= 0) scenarios[bestIdx].isRecommended = true;
  }

  return scenarios;
}

/** MOQ 전략 한국어 레이블 */
export const STRATEGY_LABEL: Record<string, string> = {
  single: '단품',
  '1+1': '1+1',
  '2+1': '2+1',
};

/** 가격 경쟁력 상태별 색상 */
export const PRICE_COMP_STYLE: Record<PriceCompStatus, { color: string; bg: string }> = {
  '강력한 경쟁력': { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  '경쟁력 보통':   { color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  '시장가 근접':   { color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  '시장가 초과':   { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  '데이터 없음':   { color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
};
