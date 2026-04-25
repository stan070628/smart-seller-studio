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

export function matchesPrefix(fullPath: string, prefix: string): boolean {
  return fullPath === prefix || fullPath.startsWith(prefix + '/');
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
  // 정렬 규칙(긴 prefix 우선) 덕에 첫 매치가 가장 긴 매치
  const hit = COUPANG_FEE_MAP.find((e) => matchesPrefix(fullPath, e.prefix));
  if (!hit) {
    return {
      rate: COUPANG_DEFAULT_FEE.rate,
      categoryName: COUPANG_DEFAULT_FEE.categoryName,
      matched: false,
      matchedPrefix: null,
    };
  }
  return {
    rate: hit.rate,
    categoryName: hit.categoryName,
    matched: true,
    matchedPrefix: hit.prefix,
  };
}

// ─── 빌드 타임/모듈 로드 타임 안전장치 ─────────────────────────
(function assertCoupangFeeMapInvariants() {
  // 1. 정렬: 더 구체적인(긴) prefix가 위에 위치
  for (let i = 0; i < COUPANG_FEE_MAP.length; i++) {
    for (let j = 0; j < i; j++) {
      const subj = COUPANG_FEE_MAP[i].prefix;
      const upper = COUPANG_FEE_MAP[j].prefix;
      if (subj === upper || subj.startsWith(upper + '/')) {
        throw new Error(
          `COUPANG_FEE_MAP 정렬 위반: "${subj}"는 "${upper}" 보다 위에 있어야 함`,
        );
      }
    }
  }
  // 2. 중복 prefix 금지
  const seen = new Set<string>();
  for (const entry of COUPANG_FEE_MAP) {
    if (seen.has(entry.prefix)) {
      throw new Error(`COUPANG_FEE_MAP 중복 prefix: "${entry.prefix}"`);
    }
    seen.add(entry.prefix);
  }
  // 3. rate 범위
  for (const entry of COUPANG_FEE_MAP) {
    if (!(entry.rate > 0 && entry.rate < 1)) {
      throw new Error(`COUPANG_FEE_MAP rate 범위 위반: "${entry.prefix}" rate=${entry.rate}`);
    }
  }
})();
