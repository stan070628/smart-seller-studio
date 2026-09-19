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
  calcMinSalePrice,
  type Channel,
} from './shared/channel-policy';
import { getGrade, GRADE_COLORS, type SourcingGrade } from './shared/grade';

export type { Channel, SourcingGrade };
export { GRADE_COLORS };

/**
 * 「가격 → 마진」 방향 계산.
 *
 * calcCostcoPrice()는 목표 마진율로 판매가를 역산하지만, 매대에서는 반대 방향이
 * 필요하다 — 「이 가격에 팔면 얼마 남나」. 공식은 같으므로 공용 모듈 함수를
 * 그대로 내보낸다(2026-09-06). 새 계산 코드를 만들면 두 전제가 갈린다.
 */
export { calcNetProfit, calcNetMarginRate, calcMinSalePrice };
export { COSTCO_TARGET_MARGIN_RATE, CHANNEL_FEE, VAT_RATE };

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
/**
 * 코스트코 카테고리 → 쿠팡 실측 수수료율 (2026-09-06)
 *
 * 🔴 CHANNEL_FEE.coupang(11%)은 실측 어느 값에도 해당하지 않는 가정이었다.
 *    위키 실측 범위는 7.8~10.8%이고 최고치인 의류도 10.5%다 —
 *    11%를 쓰면 모든 품목의 마진이 실제보다 낮게 나온다.
 *
 * 출처: [[쿠팡 판매 수수료]] 실측표 (정산 API `serviceFeeRatio` 직접 조회)
 *   7.8%  생활·잡화  — 아머올 티슈 · 라브아 방향제 · 리치키즈 칫솔 · 서큘레이터
 *   9.6%  화장품     — 도미나스 크림 · 오스트리안 핸드워시 · 보태니컬 비누 · 다슈 왁스
 *   10.0% 생활       — 극세사 타월 · LED 라이트트랩
 *   10.5% 의류·잡화  — 디아도라 · 캘빈클라인 · 컬럼비아 · 코오롱 · 압축파우치
 *   10.6% 식품·건강  — 랩노쉬 · 위트빅스 · 팝콘 · 오메가3
 *   10.8% 주방       — 실리만 조리도구 · 아이스트레이
 *
 * ⚠️ 계열 추정은 관측에서 역으로 읽은 것이지 쿠팡 공개 분류가 아니다.
 *    새 품목은 정산 API로 실측하고 이 표를 갱신한다.
 *    미매핑 카테고리는 보수적으로 10.8%(실측 최고치)를 쓴다 — 11%보다는 근거가 있다.
 */
const COSTCO_CATEGORY_COUPANG_FEE: Record<string, number> = {
  '식품':         0.106,  // 랩노쉬·위트빅스·팝콘 실측
  '건강보조식품': 0.106,  // 오메가3 실측
  '건강·뷰티':   0.096,  // 핸드워시·비누·크림·왁스 실측
  '생활용품':     0.078,  // 방향제·칫솔·티슈 실측 (극세사 10%와 갈리나 다수가 7.8%)
  '의류·패션':   0.105,  // 디아도라·컬럼비아·코오롱 실측
  '주방·식기':   0.108,  // 실리만 조리도구·아이스트레이 실측
  '자동차용품':   0.078,  // 아머올 티슈 실측
  '가전제품':     0.078,  // 서큘레이터 실측
  '완구·스포츠': 0.078,  // 마스터버니 얼음주머니 실측
  '반려동물':     0.100,  // 미실측 — 생활 계열로 추정
  '가구·침구':   0.100,  // 미실측 — 생활 계열로 추정
};

/** 실측 최고치. 미매핑 카테고리의 보수적 폴백 */
const COUPANG_FEE_FALLBACK = 0.108;

/**
 * 코스트코 카테고리의 쿠팡 정률을 돌려준다.
 * 네이버는 실측 표가 없어 기존 CHANNEL_FEE를 그대로 쓴다.
 */
export function getCoupangFeeRate(categoryName: string | null | undefined): number {
  if (!categoryName) return COUPANG_FEE_FALLBACK;
  return COSTCO_CATEGORY_COUPANG_FEE[categoryName] ?? COUPANG_FEE_FALLBACK;
}

/**
 * 간이과세자 기준 마진 계산 (2026-09-06)
 *
 * 🔴 공용 calcNetProfit()은 일반과세 전제로 VAT를 10/110(9.09%) 차감한다.
 *    그러나 이 사업자는 **간이과세자**라 구조가 다르다 —
 *      ① 매출세액이 판매가의 **1.5%**다 (9.09%가 아니다)
 *      ② 매입세액 공제가 `매입액 × 0.5%`로 제한돼 사실상 못 받는다 →
 *         수수료·물류비의 VAT가 그대로 비용이 되므로 **수수료에 ×1.1**을 곱한다
 *
 *    출처: [[쿠팡 판매 수수료]] 계산 규칙 · [[로켓그로스 서비스 소개서 2025-01]]
 *      개당 마진 = 판매가 − 원가 − 판매가×(정률×1.1) − 물류비 − 판매가×1.5%
 *
 *    위키 전 문서가 이 기준으로 계산돼 있다. 일반과세 공식을 쓰면 이 화면만 어긋난다.
 */
export const SIMPLIFIED_VAT_RATE = 0.015;

/**
 * 간이과세 기준 순이익 — 수수료는 VAT 포함(×1.1), 매출세액은 1.5%
 * @param feeRate 정률 override. 쿠팡은 카테고리 실측값을 넘긴다(getCoupangFeeRate)
 */
export function calcNetProfitSimplified(
  salePrice: number,
  costTotal: number,
  channel: Channel,
  feeRate?: number,
): number {
  const feeWithVat = (feeRate ?? CHANNEL_FEE[channel]) * 1.1;
  const deduction = salePrice * (feeWithVat + SIMPLIFIED_VAT_RATE);
  return Math.round(salePrice - deduction - costTotal);
}

/** 간이과세 기준 마진율 (%) */
export function calcNetMarginRateSimplified(
  salePrice: number,
  costTotal: number,
  channel: Channel,
  feeRate?: number,
): number {
  if (salePrice <= 0) return 0;
  const profit = calcNetProfitSimplified(salePrice, costTotal, channel, feeRate);
  return Math.round((profit / salePrice) * 10000) / 100;
}

/** 간이과세 기준 손익분기 판매가 */
export function calcMinSalePriceSimplified(
  costTotal: number,
  channel: Channel,
  feeRate?: number,
): number {
  const deductionRate = 1 - (feeRate ?? CHANNEL_FEE[channel]) * 1.1 - SIMPLIFIED_VAT_RATE;
  return Math.ceil(costTotal / deductionRate);
}

/**
 * 판매 경로별 물류비 — 위키 실측 기반 (2026-09-06 반영)
 *
 * 🔴 기존 getShippingCost()는 2kg 미만 3,500원으로 잡는데 실측과 다르다.
 *    호출부가 많아 그 함수는 그대로 두고, 코스트코 판정용으로 이 함수를 쓴다.
 *
 * ■ 윙(판매자배송) — 롯데 SOHO 계약 2026-08-06
 *   2kg/80cm 2,890원(VAT 별도) → 실부담 3,179원. 6kg 3,290 · 8kg 3,790.
 *   ⚠️ 120cm 초과 구간은 표에 없고 콜맨 웨건 실측이 5,000원(VAT 포함)이었다.
 *
 * ■ 로켓그로스 — 2026-08-13 실청구 실측
 *   입출고비(낱개당) + 배송비(건당). **극소형 1,128+1,953=3,080 고정**(2026-09-06).
 *   🔴 요금표 최소값(1,898)의 1.6배다. 요금표로 계산하면 마진이 과대계상된다.
 *   소형 3,988·중형 5,727 구간은 참고용이며 계산에는 쓰지 않는다.
 */
export type FulfillChannel = 'wing' | 'growth';

export function getLogisticsCost(
  weightKg: number | null,
  fulfill: FulfillChannel,
  packQty = 1,
): number {
  if (fulfill === 'growth') {
    // 🔵 극소형 고정 (2026-09-06 사용자 확정). 무게로 크기 구간을 근사하던 것을 걷어냈다 —
    //    DB에 부피가 없어 근사가 900원까지 틀어졌고, 실제 취급 상품은 극소형에 몰린다.
    //    로켓그로스 34개 옵션 중 중형 이상이 0건이라는 실측과도 맞는다.
    //    입출고비는 낱개당, 배송비는 건당 — 묶음 절감의 원천이 배송비 1회분이다.
    const INBOUND = 1128;   // 극소형 입출고비 (2026-08-13 실청구)
    const DELIVERY = 1953;  // 극소형 배송비
    return INBOUND * packQty + DELIVERY;
  }

  // 윙 — SOHO 실부담(VAT 포함)
  if (!weightKg || weightKg < 2) return 3179;
  if (weightKg < 6)  return 3619;   // 3,290 + VAT
  if (weightKg < 8)  return 4169;   // 3,790 + VAT
  return 5000;                      // 120cm 초과 실측(VAT 포함)
}

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
  /** 목표 마진율 override (0~1). 미전달 시 카테고리 기본값 적용 */
  targetRate?: number;
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

  const deductionRate = 1 - CHANNEL_FEE[channel] - VAT_RATE;

  let recommendedPrice: number;

  if (input.targetRate !== undefined) {
    // targetRate override: 판매가 기준 목표 마진율로 역산
    // realMarginRate = netProfit / recommendedPrice = (recommendedPrice × deductionRate - totalCost) / recommendedPrice = deductionRate - totalCost/recommendedPrice
    // 따라서: recommendedPrice = totalCost / (deductionRate - targetRate)
    const overrideRate = input.targetRate;
    const raw = totalCost / (deductionRate - overrideRate);
    recommendedPrice = Math.round(raw / 100) * 100;
  } else {
    // 카테고리 기본값: 원가 대비 목표이익 방식
    const categoryRate = CATEGORY_TARGET_RATES[categoryName ?? ''] ?? COSTCO_TARGET_MARGIN_RATE;
    const targetProfit = Math.max(Math.floor(totalCost * categoryRate), 2000);
    const raw = (totalCost + targetProfit) / deductionRate;
    recommendedPrice = Math.round(raw / 100) * 100;
  }

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
