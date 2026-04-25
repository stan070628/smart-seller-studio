# 쿠팡 카테고리 → 수수료율 매핑 재설계

**작성일**: 2026-04-25
**상태**: Spec 승인 대기

## 배경

쿠팡 자동등록 페이지(`src/app/listing/auto-register/page.tsx`)에서 카테고리 코드를 입력하면 마진 계산용 쿠팡 수수료가 자동 추정된다. 그런데 실제 사용 중 카테고리 코드 `78780`(주방용품류)을 입력했을 때 수수료가 잘못된 값(6.5%, 식품)으로 세팅되는 사례가 발견되었다.

원인은 `src/lib/calculator/fees.ts:38-70`의 `getCoupangFeeFromPath()` 함수가 카테고리 fullPath 문자열을 정규식 substring 매칭으로 분류하기 때문이다. 식품 정규식 `/식품|먹|건강기능식품|농산|수산|축산|간식|음료|커피|차|과자|쌀|잡곡/`에 단일 한 글자 키워드(`먹`, `차`)가 포함되어 있어, 자동차용품·반려동물용품·차량용품 같은 무관한 카테고리가 식품으로 오분류된다.

## 목표

1. **오분류 제거**: 단일 문자 substring 매칭에서 발생하는 잘못된 카테고리 매칭을 차단한다.
2. **확장 가능한 매핑**: 쿠팡이 새로운 카테고리를 추가하거나 leaf가 늘어나도 한 줄 추가로 대응 가능한 구조로 만든다.
3. **사용자 안전망**: 매칭에 실패한 경우 잘못된 자동값 대신 "추정 실패" 신호를 UI에 노출해 사용자가 직접 입력하도록 유도한다. 등록 자체는 절대 차단하지 않는다.

## 비목표

- 쿠팡 leaf 카테고리 코드 단위(수천 개)의 1:1 매핑은 만들지 않는다. 쿠팡 공식 수수료 정책이 leaf가 아닌 카테고리 그룹 단위로 정의되므로 불필요하다.
- 쿠팡 Open API에서 카테고리별 수수료율을 가져오지 않는다. 공식 엔드포인트가 존재하지 않음을 확인했다 (`getCategoryMeta`는 고시정보·옵션·인증정보만 반환).
- 정산 데이터 기반의 자동 학습 매핑은 이번 스코프에 포함하지 않는다 (향후 확장 가능).
- 다른 플랫폼(네이버 스마트스토어, G마켓, 11번가, Shopee)의 수수료 매핑은 변경하지 않는다.

## 결정 사항 (브레인스토밍 결과)

| 항목 | 결정 | 이유 |
|---|---|---|
| 매칭 방식 | fullPath prefix 매칭 (가변 깊이) | 1차 segment만 보면 가전디지털 하위(스마트폰 4% vs 생활가전 7.8%)를 구분 못함 |
| 미매핑 카테고리 처리 | 매핑 테이블 충분히 확장 + 미매핑 시 10.8% 기본값 + UI 경고 (등록 차단 X) | 잘못된 마진 계산보다 사용자가 등록 못 하는 것이 더 위험 |
| 매칭 단위 | leaf 코드가 아닌 fullPath prefix | 쿠팡 수수료 정책이 카테고리 그룹 단위로 정의됨. leaf 단위 매핑은 결과적으로 같은 값을 수천 번 반복하는 셈 |
| 수수료 데이터 출처 | 쿠팡 공식 수수료 안내 페이지 1회 파싱 → 매핑 테이블에 정적 저장 | Open API에 수수료 엔드포인트 없음. 정책 변경 빈도 낮아 정적 저장이 적절 |
| `calcCoupangWing` 시그니처 | `category: string` → `feeRate: number`로 단순화 | 카테고리 이름을 거쳐 다시 룩업하는 우회 경로 제거 |

## 아키텍처

### 신규 파일

**`src/lib/calculator/coupang-fees.ts`**

쿠팡 수수료 매핑 전담 모듈. 정규식 매칭은 폐기하고 prefix 기반 매핑 데이터와 단일 함수만 노출한다.

```ts
export interface CoupangFeeEntry {
  prefix: string;       // fullPath 시작 부분과 매치할 문자열. 예: "가전디지털/스마트폰", "식품"
  rate: number;         // 0 < rate < 1
  categoryName: string; // 마진 표시 라벨
}

export const COUPANG_FEE_MAP: readonly CoupangFeeEntry[];

export const COUPANG_DEFAULT_FEE = {
  rate: 0.108,
  categoryName: '기타',
} as const;

export interface CoupangFeeMatch {
  rate: number;
  categoryName: string;
  matched: boolean;            // false면 기본값 fallback. UI 경고에 사용
  matchedPrefix: string | null;
}

export function resolveCoupangFee(fullPath: string | null | undefined): CoupangFeeMatch;
```

**`scripts/scrape-coupang-fees.ts`** (1회성 dev 스크립트, 운영 의존성 없음)

쿠팡 공식 수수료 안내 페이지를 파싱해 `COUPANG_FEE_MAP` 초안을 콘솔로 출력. 사람이 검토 후 `coupang-fees.ts`에 복붙. 자동 갱신은 하지 않는다 (정책 변경 시 수동 업데이트가 명시적이고 안전).

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `src/lib/calculator/fees.ts` | `getCoupangFeeFromPath()` 함수 제거. `COUPANG_WING_CATEGORIES` 제거 (신규 모듈로 흡수). `COUPANG_WING` 상수, 다른 플랫폼 매핑은 그대로 유지 |
| `src/lib/calculator/calculate.ts` | `calcCoupangWing()`의 `category: string` 파라미터를 `feeRate: number`로 변경. 내부 `COUPANG_WING_CATEGORIES[p.category]` 룩업 삭제. `calcCoupangRocket()`도 동일 |
| `src/app/listing/auto-register/page.tsx` | `getCoupangFeeFromPath` import → `resolveCoupangFee` import. 호출 결과의 `matched` 필드를 사용해 UI 경고 노출. `calcCoupangWing` 호출 시 `feeRate` 직접 전달 |
| `src/components/calculator/...` | `calcCoupangWing` 호출하는 모든 컴포넌트 시그니처 업데이트 |
| 기존 테스트들 | `getCoupangFeeFromPath` 또는 `calcCoupangWing` 호출하는 테스트의 호출 시그니처 업데이트 |

## 데이터 흐름

```
[사용자] 카테고리 코드 78780 입력
   ↓
[GET /api/auto-register/validate-category?categoryCode=78780]
   → coupang-client.findCategoryFullPath(78780)
   → fullPath: "주방용품/조리도구/주방잡화"
   ↓
[resolveCoupangFee("주방용품/조리도구/주방잡화")]
   → COUPANG_FEE_MAP에서 startsWith로 매칭 (긴 prefix 우선)
   → { rate: 0.108, categoryName: '주방용품', matched: true, matchedPrefix: '주방용품' }
   ↓
[페이지 상태]
   estimatedRate = 0.108
   matched = true → UI 경고 없음, "✓ 주방용품" 표시
   effectiveFeeRate = customRate ?? estimatedRate
   ↓
[calcCoupangWing({ ..., feeRate: effectiveFeeRate })]
   → 마진 계산
   ↓
[등록 API] displayCategoryCode: 78780 그대로 전송 (수수료와 무관)
```

## 매핑 정의 형식

```ts
// 정렬 규칙: 더 구체적인 (긴) prefix가 위에 위치
// 빌드 타임 검증으로 정렬 위반 차단
export const COUPANG_FEE_MAP: readonly CoupangFeeEntry[] = [
  // 가전디지털 하위 분기
  { prefix: '가전디지털/스마트폰',     rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/태블릿',       rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/노트북',       rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/컴퓨터',       rate: 0.04,  categoryName: '디지털기기' },
  { prefix: '가전디지털/카메라',       rate: 0.05,  categoryName: '카메라/캠코더' },
  { prefix: '가전디지털/TV',           rate: 0.078, categoryName: 'TV/음향가전' },
  { prefix: '가전디지털/음향가전',     rate: 0.078, categoryName: 'TV/음향가전' },
  { prefix: '가전디지털',              rate: 0.078, categoryName: '생활가전' }, // 1차 fallback

  // 1차 카테고리들
  { prefix: '식품',                   rate: 0.065, categoryName: '식품' },
  { prefix: '주방용품',               rate: 0.108, categoryName: '주방용품' },
  { prefix: '생활용품',               rate: 0.108, categoryName: '생활용품' },
  { prefix: '홈인테리어',             rate: 0.108, categoryName: '가구/인테리어' },
  { prefix: '뷰티',                   rate: 0.108, categoryName: '뷰티/화장품' },
  { prefix: '패션의류잡화',           rate: 0.108, categoryName: '패션의류' },
  { prefix: '출산/유아동',            rate: 0.108, categoryName: '출산/유아동' },
  { prefix: '스포츠/레저',            rate: 0.108, categoryName: '스포츠/레저' },
  { prefix: '자동차용품',             rate: 0.108, categoryName: '자동차용품' },
  { prefix: '도서/음반/DVD',          rate: 0.108, categoryName: '도서/음반' },
  { prefix: '완구/취미',              rate: 0.108, categoryName: '완구/취미' },
  { prefix: '문구/오피스',            rate: 0.108, categoryName: '문구/오피스' },
  { prefix: '반려동물용품',           rate: 0.108, categoryName: '반려동물용품' },
  { prefix: '헬스/건강식품',          rate: 0.085, categoryName: '헬스/건강식품' },
  // ... 1회 스크래핑 결과로 채워짐 (위 예시는 구조 시연용 — 실제 prefix와 비율은 확정 단계에서 검증)
];
```

> **주의**: 위 prefix 문자열과 비율은 구조 시연용 예시다. 실제 매핑은 `scripts/scrape-coupang-fees.ts` 결과를 사람이 검토한 뒤 확정한다.

## 매칭 알고리즘

매칭은 segment 경계(`/`)를 존중해야 한다. 단순 `startsWith(prefix)`만 쓰면 가상의 `"주방용품2/..."` 같은 path가 `"주방용품"` prefix와 잘못 매칭될 수 있다. 그래서 `prefix === fullPath` 또는 `fullPath`가 `prefix + '/'`로 시작하는 경우만 매칭으로 본다.

```ts
function matchesPrefix(fullPath: string, prefix: string): boolean {
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
```

복잡도 O(N), N≈30~50. fullPath 한 건당 0.01ms 미만이라 캐싱 불필요.

`includes` 같은 substring 매칭은 기존 정규식과 같은 오분류 위험을 만들기 때문에 금지한다.

**주의: prefix 자체에 `/`가 들어 있는 경우** (예: `"출산/유아동"`, `"도서/음반/DVD"`) — 쿠팡 1차 카테고리명에 `/`가 포함되는 경우가 있다. fullPath 구분자도 `/`이므로 동일 문자가 의미상 두 가지 역할을 하지만, `matchesPrefix` 정의상 prefix가 "어디까지가 한 카테고리 이름인지" 판별할 필요가 없으므로 문제 없다. 즉 prefix `"출산/유아동"`은 fullPath `"출산/유아동/유아의류/..."` 와 정상 매칭된다.

## 빌드 타임/런타임 안전장치

`coupang-fees.ts` 모듈 로드 시 한 번 실행되는 IIFE assertion. 정렬 규칙도 매칭과 같은 segment 경계를 적용한다 (단순 `startsWith`로 검증하면 `"주방용품2"` 같은 가상 prefix가 `"주방용품"` 아래 있을 때 거짓 양성 발생).

```ts
function isSubPrefix(a: string, b: string): boolean {
  // a가 b의 segment 경계를 존중하는 sub-path인지
  return a === b || a.startsWith(b + '/');
}

// 정렬 invariant: 더 구체적인(긴) prefix가 위에 위치
for (let i = 0; i < COUPANG_FEE_MAP.length; i++) {
  for (let j = 0; j < i; j++) {
    if (isSubPrefix(COUPANG_FEE_MAP[i].prefix, COUPANG_FEE_MAP[j].prefix)) {
      throw new Error(
        `COUPANG_FEE_MAP 정렬 위반: "${COUPANG_FEE_MAP[i].prefix}"는 ` +
        `"${COUPANG_FEE_MAP[j].prefix}" 보다 위에 있어야 함`
      );
    }
  }
}

// 중복 prefix 금지
const seen = new Set<string>();
for (const entry of COUPANG_FEE_MAP) {
  if (seen.has(entry.prefix)) {
    throw new Error(`COUPANG_FEE_MAP 중복 prefix: "${entry.prefix}"`);
  }
  seen.add(entry.prefix);
}

// rate 범위 검증
for (const entry of COUPANG_FEE_MAP) {
  if (!(entry.rate > 0 && entry.rate < 1)) {
    throw new Error(`COUPANG_FEE_MAP rate 범위 위반: "${entry.prefix}" rate=${entry.rate}`);
  }
}
```

이 검증으로 매핑 추가 시 정렬 실수가 production에 도달하지 못한다.

## UI 변경

`src/app/listing/auto-register/page.tsx` 수수료 표시 영역:

**매핑 성공 (`matched: true`)**

```
쿠팡 수수료 (자동 추정)
  6.5%  ✓ 식품
  ─────
  직접 입력: [    ] %
```

**매핑 실패 (`matched: false`)**

```
쿠팡 수수료 (자동 추정)
  10.8%  ⚠ 추정 실패 - 직접 입력 권장
  ─────
  직접 입력: [    ] %
```

기존 우선순위 로직은 변경하지 않는다:
**사용자 직접입력 > 자동추정(`resolveCoupangFee`) > 기본값(10.8%)**

## 에러 처리

| 시나리오 | 동작 |
|---|---|
| `fullPath`가 `null`/빈 문자열 | `matched: false` + 기본값 10.8%. UI 경고 |
| `fullPath`는 있지만 prefix 매칭 실패 | `matched: false` + 기본값 10.8%. UI 경고 |
| `validate-category` API 호출 실패 | 기존 동작 유지 (categoryFullPath 빈 문자열 → 위 케이스로 흡수) |
| `customFeeRate` 사용자 입력 | 항상 우선. `matched`와 무관 |
| `categoryHint` (외부 소싱 사이트 카테고리) | fullPath가 없을 때만 fallback으로 사용. 매칭 실패 가능성 높음 → 10.8% 표시. 공식 fullPath 확보가 정상 경로 |

**원칙**: 등록은 절대 차단하지 않는다. 잘못된 자동 추정보다 "추정 실패 + 사용자 직접 입력" 이 안전하다.

## 테스트 계획

### 단위 테스트 (`src/__tests__/lib/coupang-fees.test.ts`, 신규)

```ts
describe('resolveCoupangFee', () => {
  // 정상 매칭
  it('식품 카테고리는 6.5%를 반환한다', () => {
    expect(resolveCoupangFee('식품/가공식품/통조림').rate).toBe(0.065);
  });

  // 가전디지털 분기
  it('가전디지털/스마트폰은 4%를 반환한다', () => {
    expect(resolveCoupangFee('가전디지털/스마트폰/갤럭시').rate).toBe(0.04);
  });
  it('가전디지털/생활가전은 7.8%를 반환한다', () => {
    expect(resolveCoupangFee('가전디지털/생활가전/공기청정기').rate).toBe(0.078);
  });
  it('가전디지털만 있는 경우 1차 fallback (생활가전 7.8%)', () => {
    expect(resolveCoupangFee('가전디지털').rate).toBe(0.078);
  });

  // 회귀 방지 (기존 정규식 오분류 케이스)
  it('자동차용품 경로에 "차"가 있어도 식품으로 잘못 분류되지 않는다', () => {
    const r = resolveCoupangFee('자동차용품/차량용 소품/방향제');
    expect(r.categoryName).not.toBe('식품');
    expect(r.rate).not.toBe(0.065);
  });
  it('반려동물 사료 경로에 "먹"이 있어도 식품으로 잘못 분류되지 않는다', () => {
    const r = resolveCoupangFee('반려동물용품/강아지 먹이/사료');
    expect(r.categoryName).not.toBe('식품');
  });

  // segment 경계 보호 (회귀 방지)
  it('prefix와 정확히 일치하는 fullPath는 매칭된다', () => {
    expect(resolveCoupangFee('식품').matched).toBe(true);
  });
  it('prefix 다음 글자가 / 가 아니면 매칭되지 않는다', () => {
    // 가상의 "식품관" 같은 1차 카테고리가 생겨도 식품으로 잘못 매칭되지 않음
    const r = resolveCoupangFee('식품관/하위');
    expect(r.matchedPrefix).not.toBe('식품');
  });

  // 미매칭
  it('빈 문자열은 matched=false + 기본값 10.8%', () => {
    const r = resolveCoupangFee('');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
  });
  it('null/undefined도 안전하게 처리', () => {
    expect(resolveCoupangFee(null).matched).toBe(false);
    expect(resolveCoupangFee(undefined).matched).toBe(false);
  });
  it('알 수 없는 1차 카테고리는 matched=false', () => {
    const r = resolveCoupangFee('새로운미지카테고리/하위');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
  });
});

describe('COUPANG_FEE_MAP invariant', () => {
  it('모듈 로드 시 정렬 검증 통과', () => {
    expect(COUPANG_FEE_MAP.length).toBeGreaterThan(0);
  });
});
```

### 기존 테스트 마이그레이션

- `src/__tests__/api/auto-register-parse-url.test.ts` 등에서 `getCoupangFeeFromPath` 직접 import한 곳 → `resolveCoupangFee`로 마이그레이션
- `calcCoupangWing` 시그니처 변경(`category: string` → `feeRate: number`)에 따른 호출부 어셔션 업데이트 (`src/__tests__/api/margin-formula-crosscheck.test.ts` 등)

## 마이그레이션 / 롤백

- 단일 PR에서 신구 함수 동시 존재 없이 한번에 교체. 양쪽 동시 운영하지 않는다 (불일치 위험).
- 롤백은 git revert로 가능. 데이터 마이그레이션 없음 (DB 스키마 무영향).

## 영향 범위

- 자동등록 페이지의 마진 계산 (즉시 정확해짐)
- 마진 계산기(`src/components/calculator/`) 컴포넌트들의 수수료 표시
- 기존 등록된 상품에는 영향 없음 (수수료 계산은 표시용 추정값일 뿐, 실제 수수료는 쿠팡이 정산 시 결정)

## 작업 순서 (개략)

1. `scripts/scrape-coupang-fees.ts` 작성 → 쿠팡 수수료 페이지에서 매핑 초안 추출 → 사람이 검토
2. `src/lib/calculator/coupang-fees.ts` 작성 (매핑 데이터 + `resolveCoupangFee` + invariant assertion)
3. 단위 테스트 추가 (`src/__tests__/lib/coupang-fees.test.ts`)
4. `src/lib/calculator/fees.ts`에서 `getCoupangFeeFromPath`, `COUPANG_WING_CATEGORIES` 제거
5. `src/lib/calculator/calculate.ts` `calcCoupangWing`/`calcCoupangRocket` 시그니처 변경
6. `src/app/listing/auto-register/page.tsx` 호출부 + UI 경고 배지 업데이트
7. `src/components/calculator/` 호출부 업데이트
8. 기존 테스트 마이그레이션
9. 수동 검증: 카테고리 78780으로 자동등록 페이지 진입 → 6.5%가 아닌 10.8%(주방용품)로 표시되는지 확인
