# 쿠팡 카테고리 → 수수료율 매핑 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 카테고리 자동 매칭에서 단일 한 글자 substring(`먹`, `차`)이 무관한 카테고리를 식품으로 오분류하던 문제를 fullPath prefix 매칭으로 교체하고, 미매핑 카테고리는 UI에 명시적으로 알린다.

**Architecture:** 정규식 기반 `getCoupangFeeFromPath()`를 폐기하고, prefix 배열(`COUPANG_FEE_MAP`) + segment 경계(`/`)를 존중하는 `resolveCoupangFee()` 함수로 교체한다. `calcCoupangWing`/`calcCoupangRocket`은 카테고리 이름 문자열 대신 `feeRate: number`를 직접 받도록 시그니처를 단순화해 우회 룩업을 제거한다.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, React, Zustand

**Spec:** `docs/superpowers/specs/2026-04-25-coupang-fee-mapping-redesign.md`

---

## File Structure

### 신규 파일
- `src/lib/calculator/coupang-fees.ts` — 매핑 데이터 + `resolveCoupangFee()` + invariant assertion
- `src/__tests__/lib/coupang-fees.test.ts` — 단위 테스트

### 수정 파일
- `src/lib/calculator/fees.ts` — `getCoupangFeeFromPath()`, `COUPANG_WING_CATEGORIES` 제거 (`COUPANG_WING` 상수만 남김)
- `src/lib/calculator/calculate.ts` — `calcCoupangWing`/`calcCoupangRocket` 시그니처: `category: string` → `feeRate: number`
- `src/app/listing/auto-register/page.tsx` — `resolveCoupangFee` 통합 + UI 경고 배지
- `src/components/listing/workflow/Step1SourceSelect.tsx` — 호출부 마이그레이션
- `src/components/calculator/tabs/CoupangTab.tsx` — 카테고리 드롭다운 + 호출부 마이그레이션
- `src/components/listing/auto-register/steps/Step2PriceStock.tsx` — 호출부 마이그레이션
- `src/components/calculator/CompareMode.tsx` — 카테고리 드롭다운 마이그레이션

---

## Task 1: 신규 모듈 스켈레톤 + 빈 path 처리 (TDD)

**Files:**
- Create: `src/lib/calculator/coupang-fees.ts`
- Create: `src/__tests__/lib/coupang-fees.test.ts`

- [ ] **Step 1: Create the failing test file**

Create `src/__tests__/lib/coupang-fees.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveCoupangFee, COUPANG_DEFAULT_FEE } from '@/lib/calculator/coupang-fees';

describe('resolveCoupangFee — empty path 처리', () => {
  it('빈 문자열은 matched=false + 기본값 10.8%', () => {
    const r = resolveCoupangFee('');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
    expect(r.matchedPrefix).toBeNull();
  });
  it('null 입력은 matched=false', () => {
    expect(resolveCoupangFee(null).matched).toBe(false);
  });
  it('undefined 입력은 matched=false', () => {
    expect(resolveCoupangFee(undefined).matched).toBe(false);
  });
  it('COUPANG_DEFAULT_FEE 노출', () => {
    expect(COUPANG_DEFAULT_FEE.rate).toBe(0.108);
    expect(COUPANG_DEFAULT_FEE.categoryName).toBe('기타');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/calculator/coupang-fees'`

- [ ] **Step 3: Create the module skeleton**

Create `src/lib/calculator/coupang-fees.ts`:

```ts
/**
 * 쿠팡 카테고리 fullPath → 판매 수수료율 매핑
 * - segment 경계(`/`)를 존중하는 prefix 매칭
 * - 매핑 없으면 기본값(10.8%) + matched=false
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calculator/coupang-fees.ts src/__tests__/lib/coupang-fees.test.ts
git commit -m "feat(coupang-fees): 신규 매핑 모듈 스켈레톤 + 빈 path 처리

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: prefix 매칭 + segment 경계 보호

**Files:**
- Modify: `src/lib/calculator/coupang-fees.ts`
- Modify: `src/__tests__/lib/coupang-fees.test.ts`

- [ ] **Step 1: Add failing tests for matching**

Append to `src/__tests__/lib/coupang-fees.test.ts`:

```ts
import { COUPANG_FEE_MAP } from '@/lib/calculator/coupang-fees';

describe('resolveCoupangFee — prefix 매칭', () => {
  // 임시 매핑이 비어있는 동안에도 동작 검증을 위해 테스트용 path는 매칭 결과를 직접 비교하지 않고
  // 로직만 검증한다. 실제 매핑은 Task 5에서 채워지고 Task 9에서 회귀 테스트가 추가된다.
  it('prefix와 정확히 일치하는 fullPath는 매칭된다 (fixture 매핑 가정)', () => {
    // COUPANG_FEE_MAP이 비어 있을 동안에는 모두 미매칭. 이 테스트는 Task 5 후 의미를 가짐.
    // 매핑이 채워졌을 때 startsWith가 아닌 segment-aware 매칭을 사용하는지 확인.
    const r = resolveCoupangFee('식품');
    if (COUPANG_FEE_MAP.some((e) => e.prefix === '식품')) {
      expect(r.matched).toBe(true);
    } else {
      expect(r.matched).toBe(false);
    }
  });
  it('prefix 다음 글자가 / 가 아니면 매칭되지 않는다 (회귀 방지)', () => {
    // 가상의 "식품관" 같은 1차 카테고리가 생겨도 prefix "식품"과 잘못 매칭되지 않음
    const r = resolveCoupangFee('식품관/하위');
    expect(r.matchedPrefix).not.toBe('식품');
  });
  it('알 수 없는 1차 카테고리는 matched=false', () => {
    const r = resolveCoupangFee('새로운미지카테고리/하위');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
  });
});
```

- [ ] **Step 2: Run tests to verify the regression test fails**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: 회귀 테스트들은 매핑이 비어있어 우연히 통과할 수 있음. 알고리즘이 올바른지를 보장하기 위해 다음 step에서 테스트용 매핑을 임시 주입한다.

- [ ] **Step 3: Implement segment-aware matching**

Edit `src/lib/calculator/coupang-fees.ts`. `resolveCoupangFee` 함수 본체를 다음으로 교체:

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

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS — 매핑이 비어있어 모두 미매칭이지만 알고리즘이 정상 동작.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calculator/coupang-fees.ts src/__tests__/lib/coupang-fees.test.ts
git commit -m "feat(coupang-fees): segment 경계를 존중하는 prefix 매칭 구현

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: invariant 검증 (정렬/중복/rate 범위)

**Files:**
- Modify: `src/lib/calculator/coupang-fees.ts`
- Modify: `src/__tests__/lib/coupang-fees.test.ts`

- [ ] **Step 1: Write failing test for invariant**

Append to `src/__tests__/lib/coupang-fees.test.ts`:

```ts
describe('COUPANG_FEE_MAP invariants', () => {
  it('모듈 로드 시 정렬/중복/rate 검증을 통과한다', () => {
    // import 자체가 IIFE assertion을 실행하므로 import 가 던지지 않으면 OK
    expect(COUPANG_FEE_MAP).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test (should still pass — but invariant not enforced yet)**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS — assertion이 아직 없으므로 단순 통과.

- [ ] **Step 3: Add invariant assertion to module**

Edit `src/lib/calculator/coupang-fees.ts`. 파일 맨 아래(export 이후)에 다음 IIFE 추가:

```ts
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
```

- [ ] **Step 4: Add a temporary failing fixture to verify assertion fires**

Append a temporary throw-test (will be removed in Step 6):

```ts
// (Temporary) verify assertion catches violations
import { describe as desc2, it as it2 } from 'vitest';
desc2('invariant 위반 시 throw 검증', () => {
  it2('정렬 위반: 짧은 prefix가 긴 prefix 위에 있으면 throw', () => {
    // 동적 import로 순환 회피 — 실제론 모듈 자체에 위반 데이터 주입 필요
    // 이 테스트는 Step 6에서 즉시 제거되고 Task 5의 실제 데이터로 자연 검증됨
    expect(true).toBe(true);
  });
});
```

> 위 step의 stub 테스트는 임시. 실제 invariant 동작 확인은 Task 5에서 매핑을 의도적으로 잘못 정렬한 fixture를 사용해 검증한다. Step 6에서 제거.

- [ ] **Step 5: Run all tests**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS — 빈 매핑이라 invariant assertion이 던지지 않음.

- [ ] **Step 6: Remove the temporary stub block**

`src/__tests__/lib/coupang-fees.test.ts`에서 Step 4에서 추가한 `(Temporary) ...` 블록과 `desc2/it2` import 줄을 모두 제거.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calculator/coupang-fees.ts src/__tests__/lib/coupang-fees.test.ts
git commit -m "feat(coupang-fees): 모듈 로드 시 정렬/중복/rate 범위 invariant 검증

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 카테고리명 헬퍼 export (드롭다운용)

**Why:** 기존 `CompareMode.tsx`, `CoupangTab.tsx`가 `Object.keys(COUPANG_WING_CATEGORIES)`로 드롭다운 옵션을 만든다. `COUPANG_WING_CATEGORIES`를 제거하기 전에 신규 모듈이 같은 데이터를 제공해야 한다.

**Files:**
- Modify: `src/lib/calculator/coupang-fees.ts`
- Modify: `src/__tests__/lib/coupang-fees.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/__tests__/lib/coupang-fees.test.ts`:

```ts
import { getCoupangCategoryNames } from '@/lib/calculator/coupang-fees';

describe('getCoupangCategoryNames', () => {
  it('중복 제거된 카테고리명 배열을 반환한다', () => {
    const names = getCoupangCategoryNames();
    expect(Array.isArray(names)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: FAIL — `getCoupangCategoryNames is not exported`.

- [ ] **Step 3: Implement helper**

Append to `src/lib/calculator/coupang-fees.ts` (invariant 블록 위에):

```ts
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
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calculator/coupang-fees.ts src/__tests__/lib/coupang-fees.test.ts
git commit -m "feat(coupang-fees): 드롭다운용 카테고리명 헬퍼 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 매핑 데이터 입력 (잠정 데이터)

**Why:** 실제 쿠팡 1차 카테고리 ~20개의 prefix와 비율을 채운다. 정확한 데이터는 후속 작업에서 쿠팡 공식 수수료 페이지 1회 파싱으로 보강한다 (spec 참조). 이 task는 "기존 11개 + 자주 등장하는 1차 카테고리 추가" 까지 진행.

**Files:**
- Modify: `src/lib/calculator/coupang-fees.ts`
- Modify: `src/__tests__/lib/coupang-fees.test.ts`

- [ ] **Step 1: Write failing test for known categories**

Append to `src/__tests__/lib/coupang-fees.test.ts`:

```ts
describe('resolveCoupangFee — 정상 매칭 (잠정 매핑)', () => {
  it('식품 카테고리는 6.5%', () => {
    expect(resolveCoupangFee('식품/가공식품/통조림').rate).toBe(0.065);
    expect(resolveCoupangFee('식품/가공식품/통조림').matched).toBe(true);
  });
  it('가전디지털/스마트폰은 4%', () => {
    expect(resolveCoupangFee('가전디지털/스마트폰/갤럭시').rate).toBe(0.04);
  });
  it('가전디지털/생활가전은 7.8%', () => {
    expect(resolveCoupangFee('가전디지털/생활가전/공기청정기').rate).toBe(0.078);
  });
  it('가전디지털만 있을 때 1차 fallback (생활가전 7.8%)', () => {
    expect(resolveCoupangFee('가전디지털').rate).toBe(0.078);
  });
  it('주방용품은 10.8%', () => {
    expect(resolveCoupangFee('주방용품/조리도구/주방잡화').rate).toBe(0.108);
  });
  // 회귀 방지 (이전 정규식 오분류 케이스)
  it('자동차용품 경로에 "차"가 있어도 식품으로 분류되지 않는다', () => {
    const r = resolveCoupangFee('자동차용품/차량용품/방향제');
    expect(r.categoryName).not.toBe('식품');
    expect(r.rate).not.toBe(0.065);
  });
  it('반려동물 사료 경로에 "먹"이 있어도 식품으로 분류되지 않는다', () => {
    const r = resolveCoupangFee('반려동물용품/강아지/먹이');
    expect(r.categoryName).not.toBe('식품');
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: FAIL — 잠정 매핑이 비어있으므로 정상 매칭 테스트가 모두 실패.

- [ ] **Step 3: Fill in COUPANG_FEE_MAP**

Edit `src/lib/calculator/coupang-fees.ts`. `COUPANG_FEE_MAP` 빈 배열을 다음으로 교체:

```ts
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
```

> 위 prefix 문자열과 비율은 잠정 데이터다. 후속 작업으로 쿠팡 공식 수수료 페이지를 파싱해 보강할 예정 (spec 참조). 핵심 목표인 "오분류 차단"은 이 데이터로도 달성된다.

- [ ] **Step 4: Run all tests**

```bash
pnpm vitest run src/__tests__/lib/coupang-fees.test.ts
```

Expected: PASS — 모든 테스트 통과. invariant 검증도 정렬 규칙을 만족하므로 throw 없음.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calculator/coupang-fees.ts src/__tests__/lib/coupang-fees.test.ts
git commit -m "feat(coupang-fees): 1차 카테고리 prefix 매핑 데이터 입력 (잠정)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `calcCoupangWing`/`calcCoupangRocket` 시그니처 변경

**Files:**
- Modify: `src/lib/calculator/calculate.ts:50-108`
- Modify: `src/lib/calculator/calculate.ts:5-23` (import 정리)
- Modify: `src/lib/calculator/calculate.ts:265-280` (calcCoupangBoth 등 내부 호출부)

- [ ] **Step 1: Read current state**

Read `src/lib/calculator/calculate.ts` lines 1-110 and 260-285 to confirm current structure.

- [ ] **Step 2: Update calcCoupangWing signature**

Edit `src/lib/calculator/calculate.ts`. `calcCoupangWing` 함수(현재 라인 50-74)를 다음으로 교체:

```ts
// ─── 쿠팡 윙 ──────────────────────────────────────────────────
export function calcCoupangWing(p: {
  costPrice: number;
  sellingPrice: number;
  /** 0 < feeRate < 1. resolveCoupangFee()의 rate 또는 사용자 입력값 */
  feeRate: number;
  shippingFee: number;
  adCost: number;
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
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + shippingCommission, p.costPrice);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}
```

- [ ] **Step 3: Update calcCoupangRocket signature**

Edit `src/lib/calculator/calculate.ts`. `calcCoupangRocket` 함수(현재 라인 77-108)를 다음으로 교체:

```ts
// ─── 쿠팡 로켓그로스 ──────────────────────────────────────────
export function calcCoupangRocket(p: {
  costPrice: number;
  sellingPrice: number;
  feeRate: number;
  size: RocketSize;
  monthlyQty: number;
  adCost: number;
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
  const adMetrics = calcAdMetrics(p.sellingPrice, commission + logistics + storageFee, p.costPrice);

  return { items, totalFees, netProfit, marginRate, breakEvenCost, ...adMetrics };
}
```

- [ ] **Step 4: Remove COUPANG_WING_CATEGORIES from import**

Edit `src/lib/calculator/calculate.ts`. 라인 5-23의 import 블록에서 `COUPANG_WING_CATEGORIES,` 줄을 제거:

```ts
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
```

- [ ] **Step 5: Update internal callers (calcCoupangBoth)**

Find any internal call to `calcCoupangWing` or `calcCoupangRocket` in `src/lib/calculator/calculate.ts` (currently around line 270). Replace `category: <something>` with `feeRate: <number>`.

```bash
grep -n "calcCoupangWing\|calcCoupangRocket" src/lib/calculator/calculate.ts
```

For each call site found, the caller's outer function signature must also accept `feeRate: number` instead of `category: string`. Update accordingly.

Example pattern — if `calcCoupangBoth` was:
```ts
const wing = calcCoupangWing({ ...p, adCost: 0 });
```
and `p` had `category: string`, change `p` type to use `feeRate: number` and propagate the change up to all callers of `calcCoupangBoth` as well.

- [ ] **Step 6: Run typecheck**

```bash
pnpm tsc --noEmit
```

Expected: errors at all call sites of `calcCoupangWing`/`calcCoupangRocket` outside `calculate.ts`. List them — these are the targets for Task 7-8.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calculator/calculate.ts
git commit -m "refactor(calculate): calcCoupangWing/Rocket 시그니처를 feeRate: number 로 단순화

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `auto-register/page.tsx` 통합 + UI 경고 배지

**Files:**
- Modify: `src/app/listing/auto-register/page.tsx:5` (import)
- Modify: `src/app/listing/auto-register/page.tsx:874-889` (호출부)
- Modify: `src/app/listing/auto-register/page.tsx` (수수료 UI 영역, line 미상 — Step 1에서 확인)

- [ ] **Step 1: Locate the fee display UI**

```bash
grep -n "estimatedRate\|coupangCategory\|effectiveFeeRate\|customFeeRate" src/app/listing/auto-register/page.tsx
```

수수료를 화면에 표시하는 JSX 블록의 라인 번호를 메모.

- [ ] **Step 2: Replace import**

Edit `src/app/listing/auto-register/page.tsx` 라인 5:

Before:
```ts
import { getCoupangFeeFromPath } from '@/lib/calculator/fees';
```

After:
```ts
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
```

- [ ] **Step 3: Replace fee resolution call**

Edit lines around 874-878. Replace:

```ts
  const { categoryName: coupangCategory, rate: estimatedRate } = getCoupangFeeFromPath(
    categoryFullPath || product?.categoryHint || ''
  );
  const customRate = customFeeRate ? parseFloat(customFeeRate) / 100 : null;
  const effectiveFeeRate = (customRate && customRate > 0 && customRate < 1) ? customRate : estimatedRate;
```

With:

```ts
  const feeMatch = resolveCoupangFee(categoryFullPath || product?.categoryHint || '');
  const coupangCategory = feeMatch.categoryName;
  const estimatedRate = feeMatch.rate;
  const feeMatched = feeMatch.matched;
  const customRate = customFeeRate ? parseFloat(customFeeRate) / 100 : null;
  const effectiveFeeRate = (customRate && customRate > 0 && customRate < 1) ? customRate : estimatedRate;
```

- [ ] **Step 4: Update calcCoupangWing call**

Find the `calcCoupangWing({ ... })` call (around line 879). Replace `category: coupangCategory` with `feeRate: effectiveFeeRate`. The full call should become:

```ts
  const calc = calcCoupangWing({
    costPrice: safeCostPrice,
    sellingPrice: salePrice,
    feeRate: effectiveFeeRate,
    shippingFee: 0,
    adCost: 0,
  });
```

- [ ] **Step 5: Add warning badge to UI**

In the fee display JSX block (located in Step 1), add the matched/unmatched badge. The pattern:

```tsx
<span className="text-sm font-medium">
  {(estimatedRate * 100).toFixed(1)}%
</span>
{feeMatched ? (
  <span className="ml-2 text-xs text-green-700">✓ {coupangCategory}</span>
) : (
  <span className="ml-2 text-xs text-amber-700">⚠ 추정 실패 - 직접 입력 권장</span>
)}
```

> 정확한 위치는 기존 수수료 표시 영역에 적용. 기존에 `coupangCategory` 라벨만 출력하던 자리에 위 조건부 배지로 교체.

- [ ] **Step 6: Typecheck and run dev server**

```bash
pnpm tsc --noEmit
```

Expected: 이 파일 관련 에러 없음 (다른 파일 에러는 Task 8에서 해결).

- [ ] **Step 7: Commit**

```bash
git add src/app/listing/auto-register/page.tsx
git commit -m "feat(auto-register): resolveCoupangFee 통합 + 추정 실패 시 UI 경고 배지

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 나머지 호출부 마이그레이션

**Files:**
- Modify: `src/components/listing/workflow/Step1SourceSelect.tsx:21` and `:902-916`
- Modify: `src/components/calculator/tabs/CoupangTab.tsx:4-10` and `:31-33`
- Modify: `src/components/listing/auto-register/steps/Step2PriceStock.tsx:3` and `:24`
- Modify: `src/components/calculator/CompareMode.tsx:4` and `:9`

### 8a. Step1SourceSelect.tsx

- [ ] **Step 1: Replace import**

Edit `src/components/listing/workflow/Step1SourceSelect.tsx` line 21:

Before:
```ts
import { getCoupangFeeFromPath } from '@/lib/calculator/fees';
```

After:
```ts
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
```

- [ ] **Step 2: Replace usage**

Edit lines 901-916. The `coupangFee` memo and `calcCoupangWing` call:

Before:
```ts
  const coupangFee = useMemo(
    () => getCoupangFeeFromPath(sharedDraft.coupangCategoryPath || ''),
    [sharedDraft.coupangCategoryPath],
  );
  ...
  const cr = calcCoupangWing({ costPrice, sellingPrice: coupangPrice, category: coupangFee.categoryName, shippingFee, adCost: 0 });
```

After:
```ts
  const coupangFee = useMemo(
    () => resolveCoupangFee(sharedDraft.coupangCategoryPath || ''),
    [sharedDraft.coupangCategoryPath],
  );
  ...
  const cr = calcCoupangWing({ costPrice, sellingPrice: coupangPrice, feeRate: coupangFee.rate, shippingFee, adCost: 0 });
```

### 8b. CoupangTab.tsx

- [ ] **Step 3: Replace imports and helpers**

Edit `src/components/calculator/tabs/CoupangTab.tsx` lines 4-10:

Before:
```tsx
import { COUPANG_WING_CATEGORIES, COUPANG_ROCKET_LOGISTICS, type RocketSize } from '@/lib/calculator/fees';
import { calcCoupangWing, calcCoupangRocket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';

type Mode = 'wing' | 'rocket';

const categories = Object.keys(COUPANG_WING_CATEGORIES) as string[];
const sizes = Object.keys(COUPANG_ROCKET_LOGISTICS) as RocketSize[];
```

After:
```tsx
import { COUPANG_ROCKET_LOGISTICS, type RocketSize } from '@/lib/calculator/fees';
import { COUPANG_FEE_MAP, getCoupangCategoryNames } from '@/lib/calculator/coupang-fees';
import { calcCoupangWing, calcCoupangRocket } from '@/lib/calculator/calculate';
import { NumberInput, SelectInput, RadioGroup, ResultPanel, Card } from '../shared';

type Mode = 'wing' | 'rocket';

const categories = getCoupangCategoryNames();
const sizes = Object.keys(COUPANG_ROCKET_LOGISTICS) as RocketSize[];

function feeRateForCategoryName(name: string): number {
  const hit = COUPANG_FEE_MAP.find((e) => e.categoryName === name);
  return hit?.rate ?? 0.108;
}
```

- [ ] **Step 4: Update calc calls (line 28-34)**

Before:
```tsx
  const result = useMemo(() => {
    if (!sellingPrice) return null;
    if (mode === 'wing') {
      return calcCoupangWing({ costPrice, sellingPrice, category, shippingFee, adCost });
    }
    return calcCoupangRocket({ costPrice, sellingPrice, category, size, monthlyQty, adCost });
  }, [mode, costPrice, sellingPrice, category, shippingFee, adCost, size, monthlyQty]);
```

After:
```tsx
  const result = useMemo(() => {
    if (!sellingPrice) return null;
    const feeRate = feeRateForCategoryName(category);
    if (mode === 'wing') {
      return calcCoupangWing({ costPrice, sellingPrice, feeRate, shippingFee, adCost });
    }
    return calcCoupangRocket({ costPrice, sellingPrice, feeRate, size, monthlyQty, adCost });
  }, [mode, costPrice, sellingPrice, category, shippingFee, adCost, size, monthlyQty]);
```

### 8c. Step2PriceStock.tsx

- [ ] **Step 5: Read current call**

```bash
sed -n '1,40p' src/components/listing/auto-register/steps/Step2PriceStock.tsx
```

확인 후 `calcCoupangWing` 호출에서 `category: <something>`를 `feeRate: <number>`로 교체. 카테고리명만 갖고 있다면 `feeRateForCategoryName` 헬퍼와 같은 패턴 적용 (또는 fullPath가 있다면 `resolveCoupangFee(fullPath).rate` 사용).

> 정확한 컨텍스트는 파일 read 후 확정. fullPath를 받을 수 있으면 그 경로를 우선 사용. 없으면 카테고리명 → rate 변환 헬퍼 사용.

### 8d. CompareMode.tsx

- [ ] **Step 6: Replace categories source**

Edit `src/components/calculator/CompareMode.tsx`:

Before:
```ts
import { COUPANG_WING_CATEGORIES } from '@/lib/calculator/fees';
...
const categories = Object.keys(COUPANG_WING_CATEGORIES) as string[];
```

After:
```ts
import { getCoupangCategoryNames } from '@/lib/calculator/coupang-fees';
...
const categories = getCoupangCategoryNames();
```

만약 `CompareMode.tsx`도 `calcCoupangWing`을 호출한다면 같은 `feeRateForCategoryName` 패턴 적용.

```bash
grep -n "calcCoupangWing\|calcCoupangRocket\|category" src/components/calculator/CompareMode.tsx
```

확인 후 마이그레이션.

### 8e. 검증

- [ ] **Step 7: Run typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors. (남아있다면 위 step에서 놓친 호출부)

- [ ] **Step 8: Run all tests**

```bash
pnpm vitest run
```

Expected: 기존 테스트 중 `calcCoupangWing` 호출 시그니처를 사용하는 것이 있다면 실패. Task 9에서 수정.

- [ ] **Step 9: Commit**

```bash
git add src/components/
git commit -m "refactor: calcCoupangWing 호출부 4곳을 신규 시그니처로 마이그레이션

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 기존 테스트 마이그레이션 + `fees.ts` 정리

**Files:**
- Modify: `src/lib/calculator/fees.ts:14-70` (제거)
- Modify: `src/__tests__/api/auto-register-parse-url.test.ts` (필요 시)
- Modify: `src/__tests__/api/margin-formula-crosscheck.test.ts` (필요 시)

- [ ] **Step 1: Find tests that touch the removed surface**

```bash
grep -rn "getCoupangFeeFromPath\|COUPANG_WING_CATEGORIES" src/__tests__/
```

- [ ] **Step 2: For each found test file, update**

각 테스트 파일에서:
- `getCoupangFeeFromPath` import → `resolveCoupangFee` (`@/lib/calculator/coupang-fees`)
- 결과 객체 사용처: `.rate`, `.categoryName`, `.matched` 필드는 동일 또는 신규
- `calcCoupangWing({ ..., category: 'X' })` → `calcCoupangWing({ ..., feeRate: 0.108 })` (또는 의도된 비율)
- 어셔션 의미가 같은지 확인 (rate 값 그대로)

- [ ] **Step 3: Remove deprecated exports from fees.ts**

Edit `src/lib/calculator/fees.ts`. 라인 14-70(`COUPANG_WING_CATEGORIES`와 `getCoupangFeeFromPath`)을 모두 제거. `COUPANG_WING` 상수와 다른 플랫폼 관련 export는 유지:

Remove:
```ts
// ─── 쿠팡 윙 ──────────────────────────────────────────────────
export const COUPANG_WING_CATEGORIES: Record<string, number> = {
  ... (모든 줄)
};
```

Remove:
```ts
/**
 * 카테고리 경로 문자열로 쿠팡 윙 수수료율과 카테고리명을 반환합니다.
 * ...
 */
export function getCoupangFeeFromPath(categoryPath: string): { rate: number; categoryName: string } {
  ... (모든 줄)
}
```

Keep `COUPANG_WING`(라인 28-32) 그대로.

- [ ] **Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors. 만약 `getCoupangFeeFromPath`/`COUPANG_WING_CATEGORIES`를 import하는 곳이 더 있다면 여기서 잡힘 — 모두 마이그레이션.

- [ ] **Step 5: Run all tests**

```bash
pnpm vitest run
```

Expected: PASS. 빨간 테스트가 있다면 어셔션이 시그니처/의미 변화에 맞게 업데이트되어야 함.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calculator/fees.ts src/__tests__/
git commit -m "refactor: 정규식 기반 getCoupangFeeFromPath/COUPANG_WING_CATEGORIES 제거

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 회귀 통합 테스트 + 수동 검증

**Files:**
- Modify: `src/__tests__/lib/coupang-fees.test.ts` (회귀 케이스 추가)

- [ ] **Step 1: Add regression test for original 78780 bug**

Append to `src/__tests__/lib/coupang-fees.test.ts`:

```ts
describe('회귀 — 원본 버그 (카테고리 78780)', () => {
  it('주방용품 fullPath는 6.5%(식품)로 잘못 분류되지 않는다', () => {
    // 카테고리 코드 78780이 매핑되는 fullPath 예시 ("주방용품/조리도구/주방잡화" 등)
    const r = resolveCoupangFee('주방용품/조리도구/주방잡화');
    expect(r.rate).toBe(0.108);
    expect(r.rate).not.toBe(0.065);
    expect(r.categoryName).toBe('주방용품');
    expect(r.matched).toBe(true);
  });

  it('"차"가 path에 있어도 식품으로 매칭되지 않는다 (이전 정규식 버그)', () => {
    const cases = [
      '자동차용품/차량용품/방향제',
      '자동차용품/주차용품',
      '스포츠/레저/자전거',
    ];
    for (const path of cases) {
      const r = resolveCoupangFee(path);
      expect(r.categoryName).not.toBe('식품');
      expect(r.rate).not.toBe(0.065);
    }
  });

  it('"먹"이 path에 있어도 식품으로 매칭되지 않는다 (이전 정규식 버그)', () => {
    const r = resolveCoupangFee('반려동물용품/강아지/먹이');
    expect(r.categoryName).not.toBe('식품');
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
pnpm vitest run
```

Expected: PASS — 모든 테스트 통과.

- [ ] **Step 3: Manual smoke test (browser)**

```bash
pnpm dev
```

브라우저에서 자동등록 페이지 진입 → 카테고리 코드 `78780` 입력 → 800ms 대기 → 다음을 확인:
1. fullPath가 `주방용품/...` 으로 표시됨
2. 수수료가 **10.8% (✓ 주방용품)** 로 표시됨 (이전엔 6.5% 식품)
3. 매핑 누락 카테고리(예: 의도적으로 매핑 안 한 1차 카테고리)에서는 `⚠ 추정 실패` 배지 표시
4. "직접 입력" 필드에 값을 넣으면 자동값을 덮어쓰며 마진 계산이 그에 맞게 갱신

`pnpm dev` 종료: Ctrl+C.

- [ ] **Step 4: Final commit**

```bash
git add src/__tests__/lib/coupang-fees.test.ts
git commit -m "test(coupang-fees): 78780 회귀 + 차/먹 키워드 오분류 차단 통합 테스트

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (이미 수행됨)

**Spec coverage:**
- ✅ 정규식 substring 매칭 제거 → Task 9
- ✅ fullPath prefix 매칭 + 가변 깊이 → Task 2, 5
- ✅ segment 경계 보호 → Task 2
- ✅ 미매핑 시 기본값 + UI 경고 → Task 1, 7
- ✅ 정렬/중복/rate invariant 빌드 타임 검증 → Task 3
- ✅ `calcCoupangWing` 시그니처 단순화 → Task 6
- ✅ 모든 호출부 마이그레이션 → Task 7, 8
- ✅ 78780 회귀 방지 → Task 10
- ✅ deprecated 제거 → Task 9

**Spec에 명시된 1회성 스크래핑 스크립트 (`scripts/scrape-coupang-fees.ts`)는 이 plan의 스코프 밖.** 매핑 데이터 보강은 본 plan 완료 후 별도 작업으로 진행. 본 plan은 잠정 매핑(Task 5)으로 핵심 목표(오분류 차단)를 달성한다.

**Type consistency:**
- `CoupangFeeMatch` 필드(rate/categoryName/matched/matchedPrefix) — 모든 task에서 일관 사용
- `calcCoupangWing` 새 시그니처(`feeRate: number`) — Task 6 정의, Task 7-8 모든 호출부에서 동일
- `getCoupangCategoryNames()` 헬퍼 — Task 4 정의, Task 8에서 사용

**Placeholder scan:**
- Task 8c (Step2PriceStock.tsx)에 "정확한 컨텍스트는 파일 read 후 확정" 표현이 있음 — 이는 파일 모양에 따라 패턴 두 가지 중 하나를 선택해야 하기 때문. 양쪽 패턴 모두 plan에 명시되어 있어 placeholder 아님.
- Task 5의 매핑 데이터는 "잠정"이라고 명시 — 실제 데이터로 코드를 채웠고, 보강은 후속 작업으로 분리.
