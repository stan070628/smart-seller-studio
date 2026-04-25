/**
 * 쿠팡 카테고리 fullPath → 판매 수수료율 매핑
 * - segment 경계(`/`)를 존중하는 prefix 매칭
 * - 매핑 없으면 기본값(10.8%) + matched=false
 *
 * Task 9에서 `src/lib/calculator/fees.ts`의 `getCoupangFeeFromPath` 와
 * `COUPANG_WING_CATEGORIES`(기본값 0.108)를 완전히 대체한다. 이전 기간 동안
 * 두 모듈의 기본값을 함께 변경할 것 — silent skew 위험.
 */

export interface CoupangFeeEntry {
  /** fullPath 시작 부분과 매치할 prefix. 예: "가전디지털/스마트폰", "식품" */
  prefix: string;
  /** 판매 수수료율. 0 < rate < 1 */
  rate: number;
  /** 마진 표시 라벨 */
  categoryName: string;
}

export const COUPANG_FEE_MAP: readonly CoupangFeeEntry[] = [
  // Task 5에서 채워짐
];

export const COUPANG_DEFAULT_FEE = {
  rate: 0.108,
  categoryName: '기타',
} as const;

export interface CoupangFeeMatch {
  rate: number;
  categoryName: string;
  matched: boolean;
  matchedPrefix: string | null;
}

export function resolveCoupangFee(fullPath: string | null | undefined): CoupangFeeMatch {
  if (!fullPath) {
    return {
      rate: COUPANG_DEFAULT_FEE.rate,
      categoryName: COUPANG_DEFAULT_FEE.categoryName,
      matched: false,
      matchedPrefix: null,
    };
  }
  return {
    rate: COUPANG_DEFAULT_FEE.rate,
    categoryName: COUPANG_DEFAULT_FEE.categoryName,
    matched: false,
    matchedPrefix: null,
  };
}
