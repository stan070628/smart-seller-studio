# Safety Blocklist 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `legal/` 모듈에 시즌 한정 / 부피 큰 상품 / 카테고리 기반 3개 layer를 추가하여, 도매꾹 수집 시 채널 회피 리스트(spec v2 §2.3)를 자동 차단한다.

**Architecture:** 기존 `LegalIssue` / `runSyncLegalCheck()` 패턴을 그대로 따름. 신규 layer 3개는 모두 동기 함수로 작성하고 `runSyncLegalCheck()` 통합 함수에 추가한다. RED는 BLOCK, YELLOW는 WARN.

**Tech Stack:** TypeScript, Vitest, 기존 `src/lib/sourcing/legal/` 인프라
**전략 v2 의존도:** critical (Week 2 시작 전 완료 필수)
**근거 spec:** `docs/superpowers/specs/2026-04-27-seller-strategy-v2-design.md` §2.3, §6.1

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 수정 | `src/lib/sourcing/legal/types.ts` | `LegalLayer` 타입에 `'season' | 'oversize' | 'category'` 추가 |
| 신규 | `src/lib/sourcing/legal/season-filter.ts` | 시즌 한정 키워드 RED 차단 |
| 신규 | `src/lib/sourcing/legal/oversize-filter.ts` | 부피 큰 상품 키워드 RED 차단 |
| 신규 | `src/lib/sourcing/legal/category-filter.ts` | 도매꾹 카테고리명 RED 차단 |
| 수정 | `src/lib/sourcing/legal/index.ts` | `runSyncLegalCheck()` 시그니처 확장 + 신규 layer 통합 |
| 신규 | `src/lib/sourcing/__tests__/season-filter.test.ts` | season-filter 단위 테스트 |
| 신규 | `src/lib/sourcing/__tests__/oversize-filter.test.ts` | oversize-filter 단위 테스트 |
| 신규 | `src/lib/sourcing/__tests__/category-filter.test.ts` | category-filter 단위 테스트 |
| 신규 | `src/lib/sourcing/__tests__/legal-integration.test.ts` | `runSyncLegalCheck()` 통합 테스트 |

---

## Task 1: LegalLayer 타입 확장

**Files:**
- Modify: `src/lib/sourcing/legal/types.ts:5`

- [ ] **Step 1: 기존 타입 확인**

Run: `cat src/lib/sourcing/legal/types.ts`
Expected: 5번 줄에 `export type LegalLayer = 'kc' | 'banned' | 'trademark';`

- [ ] **Step 2: 타입 확장**

`src/lib/sourcing/legal/types.ts` 5번 줄을 다음으로 교체:

```ts
export type LegalLayer = 'kc' | 'banned' | 'trademark' | 'season' | 'oversize' | 'category';
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (이 시점에서는 신규 layer를 사용하는 파일이 없으므로)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sourcing/legal/types.ts
git commit -m "feat(legal): extend LegalLayer with season/oversize/category"
```

---

## Task 2: season-filter — 시즌 한정 차단

채널 spec §2.3: "크리스마스/설/추석 한정 → 재입고 불투명". 시즌 키워드가 상품명에 포함되면 RED.

**Files:**
- Create: `src/lib/sourcing/legal/season-filter.ts`
- Test: `src/lib/sourcing/__tests__/season-filter.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/season-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkSeasonLimited } from '../legal/season-filter';

describe('checkSeasonLimited — 시즌 한정 키워드 RED 차단', () => {
  it('"크리스마스 트리" → RED 차단', () => {
    const issue = checkSeasonLimited('크리스마스 트리 장식 세트');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('season');
    expect(issue?.code).toBe('SEASON_LIMITED');
  });

  it('"설날 한복" → RED 차단', () => {
    const issue = checkSeasonLimited('설날 한복 아동용');
    expect(issue?.severity).toBe('RED');
  });

  it('"추석 송편" → RED 차단', () => {
    const issue = checkSeasonLimited('추석 송편 선물세트');
    expect(issue?.severity).toBe('RED');
  });

  it('"할로윈 코스튬" → RED 차단', () => {
    const issue = checkSeasonLimited('할로윈 코스튬 의상');
    expect(issue?.severity).toBe('RED');
  });

  it('일반 상품명 → null (차단 없음)', () => {
    expect(checkSeasonLimited('스테인리스 텀블러 500ml')).toBeNull();
  });

  it('대소문자/영문 키워드 매칭', () => {
    expect(checkSeasonLimited('Christmas ornament')?.severity).toBe('RED');
    expect(checkSeasonLimited('HALLOWEEN mask')?.severity).toBe('RED');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/season-filter.test.ts`
Expected: FAIL — `Cannot find module '../legal/season-filter'`

- [ ] **Step 3: season-filter.ts 구현**

`src/lib/sourcing/legal/season-filter.ts`:

```ts
/**
 * Layer: season
 *
 * 시즌 한정 상품 RED 차단
 * 채널 spec v2 §2.3 — 크리스마스/설/추석/할로윈 등 한정 상품은 재입고 불투명
 */

import type { LegalIssue } from './types';

const SEASON_KEYWORDS = [
  '크리스마스', 'christmas', 'xmas',
  '설날', '구정',
  '추석', '한가위',
  '할로윈', 'halloween',
  '밸런타인', 'valentine',
  '화이트데이',
  '빼빼로데이',
  '어버이날', '스승의날',
  '어린이날',
  '광복절',
] as const;

export function checkSeasonLimited(title: string): LegalIssue | null {
  const lower = title.toLowerCase();
  for (const kw of SEASON_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        layer: 'season',
        severity: 'RED',
        code: 'SEASON_LIMITED',
        message: `시즌 한정 상품 의심: '${kw}' (재입고 불투명)`,
        detail: { matched: kw },
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/season-filter.test.ts`
Expected: PASS — 6개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/legal/season-filter.ts src/lib/sourcing/__tests__/season-filter.test.ts
git commit -m "feat(legal): add season-filter for seasonal limited products"
```

---

## Task 3: oversize-filter — 부피 큰 상품 차단

채널 spec §2.3: "부피 큰 상품 (50cm 변 초과 → 그로스 보관료 폭탄)". 도매꾹 API에 dimension 필드가 없으므로 키워드 기반.

**Files:**
- Create: `src/lib/sourcing/legal/oversize-filter.ts`
- Test: `src/lib/sourcing/__tests__/oversize-filter.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/oversize-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkOversize } from '../legal/oversize-filter';

describe('checkOversize — 부피 큰 상품 RED 차단 (그로스 보관료 회피)', () => {
  it('"3인용 소파" → RED 차단', () => {
    const issue = checkOversize('3인용 소파 회색 패브릭');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('oversize');
    expect(issue?.code).toBe('OVERSIZE_ITEM');
  });

  it('"매트리스 퀸" → RED 차단', () => {
    expect(checkOversize('매트리스 퀸사이즈 본넬스프링')?.severity).toBe('RED');
  });

  it('"5단 책장" → RED 차단', () => {
    expect(checkOversize('5단 책장 원목 대형')?.severity).toBe('RED');
  });

  it('"수납 캐비넷" → RED 차단', () => {
    expect(checkOversize('철제 수납 캐비넷')?.severity).toBe('RED');
  });

  it('"러닝머신" → RED 차단', () => {
    expect(checkOversize('가정용 러닝머신 접이식')?.severity).toBe('RED');
  });

  it('일반 소형 상품 → null', () => {
    expect(checkOversize('스테인리스 텀블러 500ml')).toBeNull();
    expect(checkOversize('마우스패드 XL')).toBeNull();
  });

  it('대형 키워드 단독("대형") → RED', () => {
    expect(checkOversize('대형 화분 스탠드')?.severity).toBe('RED');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/oversize-filter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: oversize-filter.ts 구현**

`src/lib/sourcing/legal/oversize-filter.ts`:

```ts
/**
 * Layer: oversize
 *
 * 부피 큰 상품 RED 차단 (쿠팡 로켓그로스 보관료 폭탄 회피)
 * 채널 spec v2 §2.3 — 50cm 변 초과 의심 키워드 매칭
 *
 * 도매꾹 API에 dimension 필드가 없으므로 키워드 기반.
 */

import type { LegalIssue } from './types';

const OVERSIZE_KEYWORDS = [
  // 가구
  '소파', '쇼파', '매트리스', '침대프레임', '책장', '책상',
  '캐비넷', '캐비닛', '서랍장', '옷장', '신발장', '식탁',
  // 운동기구
  '러닝머신', '실내자전거', '벤치프레스', '안마의자',
  // 대형 가전
  '냉장고', '세탁기', '건조기', '에어컨', '식기세척기',
  // 명시적 사이즈
  '대형', '특대형', '초대형', 'XL사이즈', 'XXL사이즈',
  '대용량', // 일부 false positive 가능 — Task 5에서 모니터링
] as const;

export function checkOversize(title: string): LegalIssue | null {
  const lower = title.toLowerCase();
  for (const kw of OVERSIZE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        layer: 'oversize',
        severity: 'RED',
        code: 'OVERSIZE_ITEM',
        message: `부피 큰 상품 의심: '${kw}' (그로스 보관료 폭탄 우려)`,
        detail: { matched: kw },
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/oversize-filter.test.ts`
Expected: PASS — 7개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/legal/oversize-filter.ts src/lib/sourcing/__tests__/oversize-filter.test.ts
git commit -m "feat(legal): add oversize-filter for bulk-storage-risky items"
```

---

## Task 4: category-filter — 도매꾹 카테고리명 차단

채널 spec §2.3: 유아용품/식품/유아의류 카테고리 자체 차단. 도매꾹 `category.current.name` 활용.

**Files:**
- Create: `src/lib/sourcing/legal/category-filter.ts`
- Test: `src/lib/sourcing/__tests__/category-filter.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/category-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkBlockedCategory } from '../legal/category-filter';

describe('checkBlockedCategory — 회피 카테고리 RED 차단', () => {
  it('"유아용품" 카테고리 → RED', () => {
    const issue = checkBlockedCategory('유아용품 > 젖병');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('category');
    expect(issue?.code).toBe('BLOCKED_CATEGORY');
  });

  it('"식품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('식품 > 가공식품')?.severity).toBe('RED');
  });

  it('"의약품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('의약품/위생용품')?.severity).toBe('RED');
  });

  it('"건강기능식품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('건강기능식품 > 비타민')?.severity).toBe('RED');
  });

  it('"생활용품" 카테고리 → null (안전)', () => {
    expect(checkBlockedCategory('생활용품 > 수납')).toBeNull();
  });

  it('빈 문자열/undefined → null', () => {
    expect(checkBlockedCategory('')).toBeNull();
    expect(checkBlockedCategory(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/category-filter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: category-filter.ts 구현**

`src/lib/sourcing/legal/category-filter.ts`:

```ts
/**
 * Layer: category
 *
 * 도매꾹 카테고리명 기반 RED 차단
 * 채널 spec v2 §2.3 — KC인증/허가 부담이 큰 카테고리 자체 회피
 */

import type { LegalIssue } from './types';

const BLOCKED_CATEGORY_KEYWORDS = [
  '유아용품', '아동용품', '유아의류', '아기용품',
  '식품', '가공식품', '신선식품', '농산물', '수산물', '축산물',
  '의약품', '의약외품',
  '건강기능식품',
  '주류', '담배',
] as const;

export function checkBlockedCategory(categoryName?: string | null): LegalIssue | null {
  if (!categoryName || categoryName.trim().length === 0) return null;

  for (const kw of BLOCKED_CATEGORY_KEYWORDS) {
    if (categoryName.includes(kw)) {
      return {
        layer: 'category',
        severity: 'RED',
        code: 'BLOCKED_CATEGORY',
        message: `회피 카테고리: '${kw}' (KC인증/허가 부담)`,
        detail: { matched: kw, categoryName },
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/category-filter.test.ts`
Expected: PASS — 6개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/legal/category-filter.ts src/lib/sourcing/__tests__/category-filter.test.ts
git commit -m "feat(legal): add category-filter for blocked categories"
```

---

## Task 5: runSyncLegalCheck() 통합

기존 `runSyncLegalCheck(title, safetyCert)` 시그니처를 확장하여 신규 3개 layer를 모두 호출.

**Files:**
- Modify: `src/lib/sourcing/legal/index.ts`
- Test: `src/lib/sourcing/__tests__/legal-integration.test.ts`

- [ ] **Step 1: 통합 테스트 작성 (실패 예상)**

`src/lib/sourcing/__tests__/legal-integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runSyncLegalCheck } from '../legal';

describe('runSyncLegalCheck — 6 layer 통합', () => {
  it('정상 상품 → safe', () => {
    const result = runSyncLegalCheck({
      title: '스테인리스 텀블러 500ml',
      categoryName: '생활용품 > 주방용품',
    });
    expect(result.status).toBe('safe');
    expect(result.issues).toHaveLength(0);
  });

  it('시즌 한정 → blocked (season RED)', () => {
    const result = runSyncLegalCheck({ title: '크리스마스 양말 세트' });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'season')).toBe(true);
  });

  it('부피 큰 상품 → blocked (oversize RED)', () => {
    const result = runSyncLegalCheck({ title: '3인용 소파 회색' });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'oversize')).toBe(true);
  });

  it('차단 카테고리 → blocked (category RED)', () => {
    const result = runSyncLegalCheck({
      title: '비타민C 1000mg',
      categoryName: '건강기능식품 > 비타민',
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'category')).toBe(true);
  });

  it('KC 필수 + 카테고리 차단 동시 → blocked + 다중 이슈', () => {
    const result = runSyncLegalCheck({
      title: '아기용 젖병 세트',
      categoryName: '유아용품 > 수유용품',
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('safetyCert 있고 일반 상품 → safe', () => {
    const result = runSyncLegalCheck({
      title: '충전기 USB-C',
      safetyCert: 'KC-XXX-2025',
      categoryName: '디지털 > 케이블',
    });
    expect(result.status).toBe('safe');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/legal-integration.test.ts`
Expected: FAIL — `runSyncLegalCheck` 시그니처가 객체를 받지 않음

- [ ] **Step 3: index.ts 통합 함수 확장**

`src/lib/sourcing/legal/index.ts` 전체를 다음으로 교체:

```ts
/**
 * Legal 체크 통합 모듈
 *
 * Layer 1 (KC) + Layer 2 (금지어) + season + oversize + category → 동기, 메인 수집 흐름에서 실행
 * Layer 3 (KIPRIS) → 비동기, 야간 배치에서 실행
 */

export { checkKcCertification } from './kc-check';
export { checkBannedKeywords } from './banned-filter';
export { checkTrademark, extractBrandCandidate } from './kipris';
export { checkSeasonLimited } from './season-filter';
export { checkOversize } from './oversize-filter';
export { checkBlockedCategory } from './category-filter';
export { resolveStatus } from './types';
export type { LegalIssue, LegalStatus, LegalLayer, LegalSeverity } from './types';

import { checkKcCertification } from './kc-check';
import { checkBannedKeywords } from './banned-filter';
import { checkSeasonLimited } from './season-filter';
import { checkOversize } from './oversize-filter';
import { checkBlockedCategory } from './category-filter';
import { resolveStatus, type LegalIssue, type LegalStatus } from './types';

export interface SyncLegalCheckInput {
  title: string;
  safetyCert?: string | null;
  categoryName?: string | null;
}

/**
 * 동기 6 layer 체크 (메인 수집 흐름)
 * KIPRIS(Layer 3)는 별도 배치
 */
export function runSyncLegalCheck(
  input: SyncLegalCheckInput,
): { status: LegalStatus; issues: LegalIssue[] } {
  const { title, safetyCert, categoryName } = input;
  const issues: LegalIssue[] = [];

  const kcIssue = checkKcCertification(title, safetyCert);
  if (kcIssue) issues.push(kcIssue);

  const bannedIssues = checkBannedKeywords(title);
  issues.push(...bannedIssues);

  const seasonIssue = checkSeasonLimited(title);
  if (seasonIssue) issues.push(seasonIssue);

  const oversizeIssue = checkOversize(title);
  if (oversizeIssue) issues.push(oversizeIssue);

  const categoryIssue = checkBlockedCategory(categoryName);
  if (categoryIssue) issues.push(categoryIssue);

  return {
    status: resolveStatus(issues),
    issues,
  };
}
```

- [ ] **Step 4: 통합 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/legal-integration.test.ts`
Expected: PASS — 6개 테스트 모두 통과

- [ ] **Step 5: 기존 호출처 수정**

기존 `runSyncLegalCheck(title, safetyCert)` 시그니처가 사용되는 곳 찾기:

Run: `grep -rn "runSyncLegalCheck" src/ --include="*.ts" --include="*.tsx"`

각 호출처를 새 시그니처로 변경:
- 기존: `runSyncLegalCheck(item.title, item.safetyCert)`
- 신규: `runSyncLegalCheck({ title: item.title, safetyCert: item.safetyCert, categoryName: item.category?.current?.name })`

특히 다음 위치 점검:
- `src/app/api/sourcing/legal-check/`
- `src/app/api/sourcing/domeggook/legal-check/`
- `src/lib/sourcing/domeggook-client.ts` (있다면)

각 파일 수정 후:

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 전체 sourcing 테스트 회귀 검증**

Run: `npx vitest run src/lib/sourcing/__tests__/`
Expected: 모든 테스트 PASS (기존 + 신규)

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat(legal): integrate season/oversize/category into runSyncLegalCheck

- Extend SyncLegalCheckInput with categoryName field
- Update all call sites to pass categoryName from domeggook category.current.name
- Strategy v2 §2.3 compliant: 6-layer auto blocklist"
```

---

## Self-Review Checklist

Plan 작성 후 자체 검토 결과:

**1. Spec coverage** ✅
- §2.3 회피 리스트의 4개 항목 중 3개(시즌·부피·카테고리) 커버. KC인증·상표권·금지어는 기존 모듈이 이미 처리.
- 부피 차단은 도매꾹 API dimension 부재로 키워드 기반 → spec과 정합 (구현 한계 명시)

**2. Placeholder scan** ✅
- TBD/TODO 0건. 모든 코드 블록 완전.

**3. Type consistency** ✅
- `LegalLayer` 확장값 (`'season' | 'oversize' | 'category'`)이 신규 filter 3개에서 모두 동일하게 사용됨
- `runSyncLegalCheck` 시그니처 변경(positional → object)이 Task 5 Step 5에서 호출처 수정으로 일관 처리

**4. 회귀 위험**
- `runSyncLegalCheck` 시그니처 변경은 breaking change. Task 5 Step 5에서 grep으로 모든 호출처 식별 + 일괄 수정. Step 6에서 전체 테스트로 회귀 검증.
