# 쿠팡 광고 가이드 기반 상세페이지 AI 품질 강화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 광고 상세페이지 최적화 편집기 가이드(2025.12)를 기반으로 카테고리별 최적화 AI 프롬프트와 금지 문구 방어 기능을 추가하여 생성 품질과 정책 준수율을 높인다.

**Architecture:** `src/lib/ai/prompts/detail-page.ts`에 `DetailPageCategory` 타입·금지 문구 상수·`checkProhibitedPhrases`·`buildCategorySystemPrompt` 함수를 추가하고, `generate-detail-html` API route가 `category` 파라미터를 받아 카테고리별 프롬프트를 선택한다. 기존 `DETAIL_PAGE_SYSTEM_PROMPT`/`STUDIO_DETAIL_PAGE_SYSTEM_PROMPT`는 유지하고 `buildCategorySystemPrompt`가 이를 래핑한다.

**Tech Stack:** TypeScript, Vitest, Next.js API Routes, Anthropic Claude SDK

---

## 수정/생성 파일 맵

| 역할 | 파일 | 변경 유형 |
|---|---|---|
| 프롬프트 + 타입 + 금지 문구 | `src/lib/ai/prompts/detail-page.ts` | Modify |
| API route | `src/app/api/ai/generate-detail-html/route.ts` | Modify |
| 테스트 | `src/__tests__/lib/detail-page-prompts.test.ts` | Modify |

---

## Task 1: 금지 문구 상수 + `checkProhibitedPhrases` 함수 (TDD)

쿠팡 광고 정책상 절대 금지 표현(p.28)을 상수로 정의하고, AI가 생성한 텍스트를 검사하는 함수를 추가한다.

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`
- Modify: `src/__tests__/lib/detail-page-prompts.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/detail-page-prompts.test.ts` 의 기존 `describe` 블록 아래에 다음을 추가한다:

```typescript
// ─── checkProhibitedPhrases ─────────────────────────────────────────────────

describe('checkProhibitedPhrases', () => {
  it('금지 표현이 없으면 violations가 빈 배열이다', () => {
    const result = checkProhibitedPhrases('좋은 품질의 제품입니다');
    expect(result.violations).toHaveLength(0);
  });

  it('"감염예방" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('감염예방에 효과적입니다');
    expect(result.violations).toContain('감염예방');
  });

  it('"피부 속" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('피부 속 깊이 침투합니다');
    expect(result.violations).toContain('피부 속');
  });

  it('"선착순" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('선착순 100명 한정 특가');
    expect(result.violations).toContain('선착순');
  });

  it('"감기예방" 을 탐지한다', () => {
    const result = checkProhibitedPhrases('감기예방에 도움이 됩니다');
    expect(result.violations).toContain('감기예방');
  });

  it('여러 금지 표현이 있으면 모두 반환한다', () => {
    const result = checkProhibitedPhrases('감염예방에 효과적이고 피부 속까지 케어됩니다');
    expect(result.violations).toContain('감염예방');
    expect(result.violations).toContain('피부 속');
    expect(result.violations).toHaveLength(2);
  });

  it('금지 표현이 아닌 유사 단어는 탐지하지 않는다', () => {
    // "감기예방" 이 아닌 "감기" 단독은 금지 아님
    const result = checkProhibitedPhrases('감기에 걸리지 않도록 따뜻하게 입으세요');
    expect(result.violations).toHaveLength(0);
  });
});
```

import 줄도 업데이트한다:
```typescript
import {
  parseDetailPageResponse,
  buildDetailPageUserPrompt,
  checkProhibitedPhrases,   // 추가
  type ProductImageAnalysis,
} from '@/lib/ai/prompts/detail-page';
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: `checkProhibitedPhrases is not a function` 또는 import 에러로 FAIL

- [ ] **Step 3: `checkProhibitedPhrases` 구현**

`src/lib/ai/prompts/detail-page.ts` 파일에서 `export const DETAIL_PAGE_SYSTEM_PROMPT` 바로 위에 다음을 추가한다:

```typescript
// ─────────────────────────────────────────
// 금지 문구 (쿠팡 광고 정책 기반 — 절대 금지 표현)
// ─────────────────────────────────────────

const PROHIBITED_PHRASES_ABSOLUTE: readonly string[] = [
  // 효능·기능 허위 표현
  '감염예방',
  '감염 예방',
  '감염대비',
  '감염 대비',
  '감기예방',
  '감기 예방',
  // 피부 침투 효능 주장
  '피부 속',
  // 선착순 (이벤트 조기 종료 가능성)
  '선착순',
] as const;

export interface ProhibitedPhraseResult {
  violations: string[];
}

/**
 * AI 생성 텍스트에서 쿠팡 광고 정책상 절대 금지 표현을 검사한다.
 * 위반이 발견되면 해당 문구를 violations 배열에 담아 반환한다.
 */
export function checkProhibitedPhrases(text: string): ProhibitedPhraseResult {
  const violations: string[] = [];
  for (const phrase of PROHIBITED_PHRASES_ABSOLUTE) {
    if (text.includes(phrase)) {
      violations.push(phrase);
    }
  }
  return { violations };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 모든 `checkProhibitedPhrases` 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/prompts/detail-page.ts src/__tests__/lib/detail-page-prompts.test.ts
git commit -m "feat(detail-page): 쿠팡 광고 정책 금지 문구 검사 함수 추가"
```

---

## Task 2: `DetailPageCategory` 타입 + `buildCategorySystemPrompt` (TDD)

쿠팡 가이드의 4종 템플릿(기본/패션잡화/생활용품/식품)에 맞춘 카테고리별 시스템 프롬프트 빌더를 추가한다.

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`
- Modify: `src/__tests__/lib/detail-page-prompts.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/detail-page-prompts.test.ts` import에 `buildCategorySystemPrompt`와 `DetailPageCategory`를 추가하고 테스트 블록을 추가한다:

```typescript
import {
  parseDetailPageResponse,
  buildDetailPageUserPrompt,
  checkProhibitedPhrases,
  buildCategorySystemPrompt,  // 추가
  type ProductImageAnalysis,
  type DetailPageCategory,    // 추가
} from '@/lib/ai/prompts/detail-page';
```

```typescript
// ─── buildCategorySystemPrompt ──────────────────────────────────────────────

describe('buildCategorySystemPrompt', () => {
  it('basic 카테고리는 기본 카피라이터 프롬프트를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('basic');
    expect(prompt).toContain('이커머스 상세 페이지 전문 카피라이터');
  });

  it('fashion 카테고리 프롬프트는 착용과 소재 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('fashion');
    expect(prompt).toContain('착용');
    expect(prompt).toContain('소재');
    expect(prompt).toContain('세탁');
  });

  it('living 카테고리 프롬프트는 기능과 인증 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('living');
    expect(prompt).toContain('기능');
    expect(prompt).toContain('인증');
  });

  it('food 카테고리 프롬프트는 원재료와 조리 안내를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('food');
    expect(prompt).toContain('원재료');
    expect(prompt).toContain('조리');
  });

  it('food 카테고리 프롬프트는 의학적 효능 금지 경고를 포함한다', () => {
    const prompt = buildCategorySystemPrompt('food');
    expect(prompt).toContain('의학적 효능');
  });

  it('studioMode=true 면 스튜디오 전문가 페르소나 프롬프트를 사용한다', () => {
    const prompt = buildCategorySystemPrompt('basic', true);
    expect(prompt).toContain('스튜디오 촬영 제품');
  });

  it('studioMode=false(기본값) 면 일반 카피라이터 프롬프트를 사용한다', () => {
    const prompt = buildCategorySystemPrompt('basic', false);
    expect(prompt).not.toContain('스튜디오 촬영 제품');
    expect(prompt).toContain('이커머스 상세 페이지 전문 카피라이터');
  });

  it('category 생략 시 basic 으로 동작한다', () => {
    const withBasic = buildCategorySystemPrompt('basic');
    const withDefault = buildCategorySystemPrompt();
    expect(withDefault).toBe(withBasic);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: `buildCategorySystemPrompt is not a function` 에러로 FAIL

- [ ] **Step 3: 타입 + 카테고리 가이드 + 빌더 함수 구현**

`src/lib/ai/prompts/detail-page.ts`에서 `STUDIO_DETAIL_PAGE_SYSTEM_PROMPT` 상수 바로 아래에 다음을 추가한다:

```typescript
// ─────────────────────────────────────────
// 카테고리 타입 + 카테고리별 구성 가이드
// ─────────────────────────────────────────

export type DetailPageCategory = 'basic' | 'fashion' | 'living' | 'food';

const CATEGORY_GUIDE: Record<DetailPageCategory, string> = {
  basic: `

## 카테고리 구성 가이드 (기본 — 모든 카테고리 적용)
- sellingPoints: 구매 결정을 가장 빠르게 돕는 3가지 핵심 소구점
- features: 소재·형태·기능 중심으로 3~5개 작성
- specs: 소재·크기·용량 등 구매에 필요한 정보 2~6개
- usageSteps: 간단하고 직관적인 사용 방법 2~4단계
- warnings: 사용·보관 주의사항 2~3개`,

  fashion: `

## 카테고리 구성 가이드 (패션잡화)
패션잡화(의류·액세서리·신발·가방 등)를 판매하는 경우에 최적화된 구성입니다.
- headline/subheadline: 착용감이나 스타일 감성을 담아 작성
- sellingPoints: 착용감·소재 품질·디자인 포인트 3가지 중심
- features: 소재·원단·봉제·디테일 등 품질 요소 강조. 착용 시 핏·느낌을 구체적으로 묘사
- specs: 색상 옵션·사이즈별 치수·소재 성분·세탁방법을 반드시 포함 (표 형태 적합)
- usageSteps: 착용 방법 또는 세탁·보관 관리 방법
- warnings: 세탁 온도·건조·보관 주의사항`,

  living: `

## 카테고리 구성 가이드 (생활용품)
위생용품·기능성 가정용품·청소용품·가전 등을 판매하는 경우에 최적화된 구성입니다.
- sellingPoints: 기능·편의성·효과 3가지 중심. 사용 전후 변화가 있으면 효과적
- features: 핵심 기능·효과를 구체적으로 설명. KC·CE 등 인증이 있으면 features에 명시
- specs: 재질·크기·용량·색상·인증 정보 포함
- usageSteps: 조립 순서 또는 사용 방법을 단계별로 작성
- warnings: 전기 제품이면 전원·과부하 주의, 위생용품이면 청결·교체주기 안내`,

  food: `

## 카테고리 구성 가이드 (식품)
신선식품·조리식품·가공식품·건강식품을 판매하는 경우에 최적화된 구성입니다.
- sellingPoints: 맛·신선도·원재료 품질 3가지 중심
- features: 원재료 원산지, 생산환경, 맛·향, 영양 특성 강조
- specs: 중량/용량·원재료·알레르기 유발 성분·유통기한·보관방법 반드시 포함
- usageSteps: 조리 방법 또는 보관 방법 (냉장/냉동 온도 포함)
- warnings: 알레르기 유발 성분, 보관 온도, 유통기한 관련 주의사항
- ⚠️ 의학적 효능(치료·예방·완화·감소) 표현 절대 금지. 건강기능식품 심의를 받지 않은 경우 효능·효과 표현 불가`,
};

/**
 * 카테고리와 스튜디오 모드에 따라 최적화된 시스템 프롬프트를 반환한다.
 * 기존 DETAIL_PAGE_SYSTEM_PROMPT / STUDIO_DETAIL_PAGE_SYSTEM_PROMPT를 베이스로 사용하고
 * 카테고리별 구성 가이드를 덧붙인다.
 */
export function buildCategorySystemPrompt(
  category: DetailPageCategory = 'basic',
  studioMode = false,
): string {
  const base = studioMode
    ? STUDIO_DETAIL_PAGE_SYSTEM_PROMPT
    : DETAIL_PAGE_SYSTEM_PROMPT;
  return `${base}${CATEGORY_GUIDE[category]}`;
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 모든 `buildCategorySystemPrompt` 테스트 PASS. 기존 테스트도 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/prompts/detail-page.ts src/__tests__/lib/detail-page-prompts.test.ts
git commit -m "feat(detail-page): 카테고리별 시스템 프롬프트 빌더 추가 (기본/패션/생활용품/식품)"
```

---

## Task 3: API Route에 `category` 파라미터 추가

`POST /api/ai/generate-detail-html`이 `category`를 받아 `buildCategorySystemPrompt`로 전달한다.

**Files:**
- Modify: `src/app/api/ai/generate-detail-html/route.ts`

- [ ] **Step 1: import에 `buildCategorySystemPrompt`와 `DetailPageCategory` 추가**

`src/app/api/ai/generate-detail-html/route.ts`의 import 블록에서 `detail-page` import를 다음과 같이 수정한다:

```typescript
import {
  DETAIL_PAGE_SYSTEM_PROMPT,
  STUDIO_DETAIL_PAGE_SYSTEM_PROMPT,
  buildDetailPageUserPrompt,
  buildCategorySystemPrompt,     // 추가
  parseDetailPageResponse,
  checkProhibitedPhrases,        // 추가
  type ProductImageAnalysis,
  type DetailPageCategory,       // 추가
} from "@/lib/ai/prompts/detail-page";
```

- [ ] **Step 2: `RequestSchema`에 `category` 필드 추가**

`RequestSchema`의 `studioMode` 바로 아래에 다음을 추가한다:

```typescript
/** 카테고리별 최적화 프롬프트 선택 (기본값: 'basic') */
category: z.enum(['basic', 'fashion', 'living', 'food'] as const).optional(),
```

- [ ] **Step 3: POST 핸들러에서 `category` 추출 + `buildCategorySystemPrompt` 사용**

POST 핸들러의 다음 줄을 찾는다:
```typescript
const { images: rawImages, imageUrls, productName, existingHtml, studioMode, productSpecs } = parseResult.data;
```

다음으로 교체한다:
```typescript
const { images: rawImages, imageUrls, productName, existingHtml, studioMode, productSpecs, category } = parseResult.data;
```

신규 생성 모드의 Claude 호출 부분(약 438~447번째 줄)을 찾는다:
```typescript
const copyResponse = await withRetry(
  () =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: studioMode ? STUDIO_DETAIL_PAGE_SYSTEM_PROMPT : DETAIL_PAGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  { label: "Claude generateDetailPageContent" }
);
```

다음으로 교체한다:
```typescript
const copyResponse = await withRetry(
  () =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: buildCategorySystemPrompt(
        (category ?? 'basic') as DetailPageCategory,
        studioMode ?? false,
      ),
      messages: [{ role: "user", content: userMessage }],
    }),
  { label: "Claude generateDetailPageContent" }
);
```

- [ ] **Step 4: 금지 문구 경고 로그 추가**

카피 파싱 성공 후 (`content = parseDetailPageResponse(rawCopyText)` 직후)에 다음을 추가한다:

```typescript
// 금지 문구 검사 — 위반 발견 시 서버 로그로 경고 (응답은 차단하지 않음)
const allText = [
  content.headline,
  content.subheadline,
  ...content.sellingPoints.map((sp) => `${sp.title} ${sp.description}`),
  ...content.features.map((f) => `${f.title} ${f.description}`),
  ...content.usageSteps,
  ...content.warnings,
].join(' ');

const { violations } = checkProhibitedPhrases(allText);
if (violations.length > 0) {
  console.warn(
    `[generate-detail-html] 금지 문구 감지 (category=${category ?? 'basic'}):`,
    violations,
  );
}
```

- [ ] **Step 5: 기존 테스트 실행 — 회귀 없음 확인**

```bash
npx vitest run src/__tests__
```

Expected: 모든 테스트 PASS (새 파라미터가 optional이라 기존 동작 무변경)

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-detail-html/route.ts
git commit -m "feat(api): generate-detail-html에 category 파라미터 추가, 금지 문구 경고 로그"
```

---

## 스펙 커버리지 자가 검토

| PDF 요구사항 | 구현 위치 | 상태 |
|---|---|---|
| 카테고리별 템플릿 구조(기본/패션/생활/식품) | `CATEGORY_GUIDE` + `buildCategorySystemPrompt` | ✅ Task 2 |
| 절대 금지 문구(감염예방, 피부 속, 선착순 등) | `PROHIBITED_PHRASES_ABSOLUTE` + `checkProhibitedPhrases` | ✅ Task 1 |
| 식품 카테고리 의학적 효능 금지 | `CATEGORY_GUIDE.food` 경고 포함 | ✅ Task 2 |
| 패션 세탁·치수 정보 강조 | `CATEGORY_GUIDE.fashion` specs 안내 | ✅ Task 2 |
| 생활용품 인증 정보 강조 | `CATEGORY_GUIDE.living` features 안내 | ✅ Task 2 |
| API 카테고리 파라미터 | `RequestSchema.category` | ✅ Task 3 |
| 이미지 700px·폰트 스펙 | 현재 780px 컨테이너·폰트 이미 유사 수준, 별도 작업 필요 없음 | — |

**플레이스홀더 없음 확인:** 코드 블록 전체 포함, TBD/TODO 없음.

**타입 일관성 확인:**
- `DetailPageCategory` → Task 2에서 정의, Task 3 import에서 사용
- `checkProhibitedPhrases` → Task 1에서 정의, Task 3 import에서 사용
- `buildCategorySystemPrompt` → Task 2에서 정의, Task 3 import에서 사용
- 모든 함수 시그니처가 정의 Task와 사용 Task에서 일치함
