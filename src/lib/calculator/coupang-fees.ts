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
  // ── 가전디지털 하위 분기 (긴 prefix 우선) ─────────────
  { prefix: '가전디지털/스마트폰',      rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/태블릿',        rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/노트북',        rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/컴퓨터',        rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/카메라',        rate: 0.05,  categoryName: '카메라/캠코더' },
  { prefix: '가전디지털/TV',            rate: 0.078, categoryName: 'TV/음향가전' },
  { prefix: '가전디지털/음향가전',      rate: 0.078, categoryName: 'TV/음향가전' },
  { prefix: '가전디지털',               rate: 0.078, categoryName: '생활가전' }, // 1차 fallback

  // ── 1차 카테고리들 ────────────────────────────────────
  { prefix: '식품',                    rate: 0.065, categoryName: '식품' },
  { prefix: '주방용품',                rate: 0.108, categoryName: '주방용품' },
  { prefix: '생활용품',                rate: 0.108, categoryName: '생활용품' },
  { prefix: '홈인테리어',              rate: 0.108, categoryName: '가구/인테리어' },
  { prefix: '뷰티',                    rate: 0.108, categoryName: '뷰티/화장품' },
  { prefix: '패션의류잡화',            rate: 0.108, categoryName: '패션의류' },
  { prefix: '패션잡화',                rate: 0.108, categoryName: '패션잡화' },
  { prefix: '출산/유아동',             rate: 0.108, categoryName: '출산/유아동' },
  { prefix: '스포츠/레저',             rate: 0.108, categoryName: '스포츠/레저' },
  { prefix: '자동차용품',              rate: 0.108, categoryName: '자동차용품' },
  { prefix: '도서/음반/DVD',           rate: 0.108, categoryName: '도서/음반' },
  { prefix: '완구/취미',               rate: 0.108, categoryName: '완구/취미' },
  { prefix: '문구/오피스',             rate: 0.108, categoryName: '문구/오피스' },
  { prefix: '반려동물용품',            rate: 0.108, categoryName: '반려동물용품' },
  { prefix: '헬스/건강식품',           rate: 0.085, categoryName: '헬스/건강식품' },
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

/** 드롭다운/필터용: 중복 제거된 카테고리명 목록을 prefix 등록 순서대로 반환 */
export function getCoupangCategoryNames(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of COUPANG_FEE_MAP) {
    if (!seen.has(entry.categoryName)) {
      seen.add(entry.categoryName);
      result.push(entry.categoryName);
    }
  }
  return result;
}

// ─── 빌드 타임/모듈 로드 타임 안전장치 ─────────────────────────
/** 매핑 테이블 invariant 검증 (테스트 용으로 export). 위반 시 throw. */
export function assertCoupangFeeMapInvariants(map: readonly CoupangFeeEntry[]): void {
  // 1. 정렬: 더 구체적인(긴) prefix가 위에 위치
  for (let i = 0; i < map.length; i++) {
    for (let j = 0; j < i; j++) {
      const subj = map[i].prefix;
      const upper = map[j].prefix;
      if (subj === upper || subj.startsWith(upper + '/')) {
        throw new Error(
          `COUPANG_FEE_MAP 정렬 위반: "${subj}"는 "${upper}" 보다 위에 있어야 함`,
        );
      }
    }
  }
  // 2. 중복 prefix 금지
  const seen = new Set<string>();
  for (const entry of map) {
    if (seen.has(entry.prefix)) {
      throw new Error(`COUPANG_FEE_MAP 중복 prefix: "${entry.prefix}"`);
    }
    seen.add(entry.prefix);
  }
  // 3. rate 범위
  for (const entry of map) {
    if (!(entry.rate > 0 && entry.rate < 1)) {
      throw new Error(`COUPANG_FEE_MAP rate 범위 위반: "${entry.prefix}" rate=${entry.rate}`);
    }
  }
}

// 모듈 로드 시 actual map에 대해 검증 실행
assertCoupangFeeMapInvariants(COUPANG_FEE_MAP);
