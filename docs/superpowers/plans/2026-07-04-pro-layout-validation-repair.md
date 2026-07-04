# PRO 모드 상세페이지 생성 검증·수리 루프 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 모드에서 Claude가 생성한 상세페이지 DSL을 반환하기 전에, 코드 결정적 검증 + LLM 리뷰·수리 루프를 거쳐 한자·의미 오류·스키마 위반·빈/중복 구조를 자동 교정하고 잔여 문제는 경고로 표면화한다.

**Architecture:** 공유 루브릭(단일 소스) → 생성/수리 프롬프트가 함께 사용. 생성 직후 `validateAndRepair`가 `validateProLayout`(코드)로 위반을 모으고, `repairProLayout`(Sonnet, 항상 1차 실행 + 필요 시 2차)로 수리, `sanitizeProLayout`(코드 폴백)로 마무리하여 `{ sections, warnings }`를 반환한다. 결과 화면에 경고 배너 표시.

**Tech Stack:** Next.js(App Router) API Route, Zod v4, Vitest, `callClaude`(CLI/SDK 폴백) — 로컬은 Claude Max(무료), 배포는 ANTHROPIC_API_KEY.

**참고 스펙:** `docs/superpowers/specs/2026-07-04-pro-layout-validation-repair-design.md`

**스펙 대비 의도적 편차 2건:**
1. `radar_chart`/`timeline`은 렌더러에 실제 구현돼 있음(`section-renderer.ts:868-897`) → "미지원 타입" 위반 없음. Zod union에 **포함**하여 유효로 허용.
2. 오케스트레이션 루프는 route에 인라인하지 않고 테스트 가능한 순수 함수 `src/lib/detail-page/validate-and-repair.ts`로 분리(repair 함수 주입 가능).

---

## 파일 구조

| 파일 | 책임 |
|------|------|
| `src/lib/ai/detail-page-rubric.ts` | **신규** — 페르소나 + 블록 타입 의사결정 루브릭(단일 소스 상수) |
| `src/lib/ai/json-extract.ts` | **신규** — `extractJsonArray` 공용 유틸(route·repair 공유) |
| `src/lib/detail-page/layout-validator.ts` | **신규** — `Violation`/`ValidationResult` 타입, Zod 스키마, `validateProLayout`, `sanitizeProLayout`, `stripCjk` |
| `src/lib/ai/repair-pro-layout.ts` | **신규** — `repairProLayout`(Sonnet 리뷰·수리) |
| `src/lib/detail-page/validate-and-repair.ts` | **신규** — `validateAndRepair` 오케스트레이션(순수 함수) |
| `src/app/api/ai/generate-pro-layout/route.ts` | **수정** — 루브릭 기반 프롬프트, `validateAndRepair` 호출, `warnings` 반환, 로컬 `extractJsonArray`/`stripCjk` 제거 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` | **수정** — `warnings` 타입 + 결과 화면 경고 배너 |

**테스트:**
- `src/__tests__/lib/json-extract.test.ts`
- `src/__tests__/lib/detail-page/layout-validator.test.ts`
- `src/__tests__/lib/ai/repair-pro-layout.test.ts`
- `src/__tests__/lib/detail-page/validate-and-repair.test.ts`

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 라이브러리 전체를 돌려 대량 선재 실패가 나므로 **항상 파일 경로를 지정**해 실행한다.

---

## Task 1: 공유 루브릭 상수

**Files:**
- Create: `src/lib/ai/detail-page-rubric.ts`

순수 문자열 상수 모듈(로직 없음) — 단위 테스트 대신 이후 Task에서 소비하며 검증. TDD 예외.

- [ ] **Step 1: 파일 작성**

```ts
// src/lib/ai/detail-page-rubric.ts
/**
 * 상세페이지 블록 타입 의사결정 루브릭 — 단일 소스.
 * 생성(generate-pro-layout)과 수리(repair-pro-layout) 프롬프트가 함께 사용한다.
 * 규칙을 바꿀 때 이 파일만 수정하면 양쪽에 반영된다.
 */

export const DETAIL_PAGE_PERSONA =
  `You are a senior Korean e-commerce detail-page designer specializing in mobile (390px) conversion-optimized layouts.`;

export const BLOCK_TYPE_RUBRIC = `BLOCK TYPE SELECTION RULES:
- 사이즈/색상/용량/구성 등 "순서 없는 병렬 선택 옵션" → option_grid (NEVER process_flow). 사이즈 안내(S/M/L 등)는 항상 option_grid.
- 시간/순서가 있는 단계(세탁→건조→보관, 봄→여름→가을) → process_flow (화살표로 연결됨)
- 2개 이상 그룹의 값 비교 → layout_bar_chart (제공된 숫자만 정확히 사용, 수정 금지)
- 단일 임팩트 숫자 → stat_row
- 0~100 비율/충족도 → progress_bar
- 단순 특징 나열 → bullet_list 또는 icon_grid (차트로 만들지 말 것)

TEXT RULES:
- 모든 텍스트(제목/라벨/서브라벨/stat 값/promptHint/badge 등)는 한글 또는 영어만 사용.
- 한자(漢字) 절대 금지. 한자가 필요하면 한글 음차로 재작성 (適當→적당, 溫度→온도, 品質→품질).
- 390px 모바일 폭 최적화 — 넓은 가로 레이아웃/표 지양, 세로·wrap 레이아웃 사용.`;
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep detail-page-rubric || echo "OK"`
Expected: `OK` (해당 파일 관련 에러 없음)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/detail-page-rubric.ts
git commit -m "feat(pro-layout): 블록 타입 의사결정 루브릭 단일 소스 추가"
```

---

## Task 2: JSON 배열 추출 공용 유틸

**Files:**
- Create: `src/lib/ai/json-extract.ts`
- Test: `src/__tests__/lib/json-extract.test.ts`

기존 `generate-pro-layout/route.ts:94-116`의 `extractJsonArray`를 공용 유틸로 승격(route·repair가 공유).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/json-extract.test.ts
import { describe, it, expect } from 'vitest';
import { extractJsonArray } from '@/lib/ai/json-extract';

describe('extractJsonArray', () => {
  it('평범한 JSON 배열을 추출한다', () => {
    expect(extractJsonArray('[{"a":1}]')).toBe('[{"a":1}]');
  });
  it('코드펜스·설명이 앞뒤에 있어도 배열만 추출한다', () => {
    const text = 'Here:\n```json\n[{"x":[1,2]}]\n```\ndone';
    expect(extractJsonArray(text)).toBe('[{"x":[1,2]}]');
  });
  it('문자열 안의 대괄호를 깊이로 오인하지 않는다', () => {
    expect(extractJsonArray('[{"t":"a]b["}]')).toBe('[{"t":"a]b["}]');
  });
  it('배열이 없으면 null', () => {
    expect(extractJsonArray('no array here')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/json-extract.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/json-extract'`

- [ ] **Step 3: 구현**

```ts
// src/lib/ai/json-extract.ts
/** 텍스트에서 첫 번째 완전한 JSON 배열 문자열을 추출한다(코드펜스 무관). 없으면 null. */
export function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/json-extract.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/json-extract.ts src/__tests__/lib/json-extract.test.ts
git commit -m "feat(ai): extractJsonArray 공용 유틸 추출 + 테스트"
```

---

## Task 3: 결정적 검증기 `validateProLayout`

**Files:**
- Create: `src/lib/detail-page/layout-validator.ts`
- Test: `src/__tests__/lib/detail-page/layout-validator.test.ts`

`types/detail-page.ts:162-190`의 `LayoutBlock` union·`ClaudeLayoutContent`를 Zod로 반영하고, 스펙 §4.2의 검사 항목을 구현한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/detail-page/layout-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateProLayout } from '@/lib/detail-page/layout-validator';

/** 유효한 최소 섹션(6개) 생성 헬퍼 */
function validSections(count = 6): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

describe('validateProLayout', () => {
  it('유효한 레이아웃은 isClean=true, error 없음', () => {
    const res = validateProLayout(validSections());
    expect(res.isClean).toBe(true);
    expect(res.violations.filter(v => v.severity === 'error')).toHaveLength(0);
  });

  it('한자가 있으면 cjk error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '溫度 관리';
    const res = validateProLayout(secs);
    expect(res.isClean).toBe(false);
    expect(res.violations.some(v => v.code === 'cjk')).toBe(true);
  });

  it('필수 필드 누락은 schema error', () => {
    const secs = validSections();
    (secs[1] as any).blocks[0] = { type: 'heading' }; // text/size 누락
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
    expect(res.isClean).toBe(false);
  });

  it('union에 없는 알 수 없는 블록 타입은 schema error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0] = { type: 'made_up_block' };
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });

  it('radar_chart/timeline은 유효(허용)', () => {
    const secs = validSections();
    (secs[0] as any).blocks = [
      { type: 'timeline', items: [{ stage: '1단계' }] },
      { type: 'radar_chart', axes: [{ label: 'A', value: 3 }] },
    ];
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('빈 heading 텍스트는 empty_block warning', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '   ';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'empty_block' && v.severity === 'warning')).toBe(true);
  });

  it('연속 동일 섹션은 duplicate warning', () => {
    const secs = validSections();
    secs[2] = JSON.parse(JSON.stringify(secs[1]));
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'duplicate')).toBe(true);
  });

  it('섹션 수 범위(6~10) 밖은 section_count warning', () => {
    const res = validateProLayout(validSections(3));
    expect(res.violations.some(v => v.code === 'section_count')).toBe(true);
  });

  it('쿠팡 금지어는 prohibited error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '감염예방 효과';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'prohibited')).toBe(true);
    expect(res.isClean).toBe(false);
  });

  it('U+FFFD 치환문자는 broken_text warning', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '충전�기';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'broken_text')).toBe(true);
  });

  it('배열이 아니면 schema error', () => {
    const res = validateProLayout({ not: 'array' });
    expect(res.isClean).toBe(false);
    expect(res.violations[0]?.code).toBe('schema');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: FAIL — `Cannot find module '@/lib/detail-page/layout-validator'`

- [ ] **Step 3: 구현**

```ts
// src/lib/detail-page/layout-validator.ts
import { z } from 'zod';
import { checkProhibitedPhrases } from '@/lib/ai/prompts/detail-page';

export interface Violation {
  code:
    | 'schema' | 'cjk' | 'broken_text' | 'empty_block'
    | 'duplicate' | 'section_count' | 'prohibited';
  path: string;
  message: string;
  severity: 'error' | 'warning';
  autoFixable: boolean;
}

export interface ValidationResult {
  violations: Violation[];
  isClean: boolean; // error severity가 하나도 없으면 true
}

// ── CJK 정규식: test용(non-global, lastIndex 버그 회피)과 strip용(global) 분리 ──
const CJK_TEST = /[一-鿿㐀-䶿豈-﫿]/;
const CJK_GLOBAL = /[一-鿿㐀-䶿豈-﫿]/g;

// ── Zod 스키마: types/detail-page.ts LayoutBlock union 반영 ──
const zLayoutBlock: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('badge'), text: z.string(), color: z.enum(['primary', 'accent', 'neutral']).optional() }),
    z.object({ type: z.literal('heading'), text: z.string(), size: z.enum(['xl', 'lg', 'md']), bold: z.boolean().optional(), color: z.enum(['primary', 'text', 'accent']).optional() }),
    z.object({ type: z.literal('subtext'), text: z.string(), align: z.enum(['left', 'center']).optional() }),
    z.object({ type: z.literal('image'), attachedIndex: z.number(), width: z.string().optional(), align: z.enum(['center', 'left', 'right']).optional(), rounded: z.boolean().optional() }),
    z.object({ type: z.literal('stat_row'), items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional() })) }),
    z.object({ type: z.literal('bullet_list'), items: z.array(z.string()), icon: z.enum(['dot', 'check', 'arrow']).optional() }),
    z.object({ type: z.literal('columns'), cols: z.array(z.array(zLayoutBlock)), gap: z.number().optional() }),
    z.object({ type: z.literal('divider') }),
    z.object({ type: z.literal('spacer'), height: z.number() }),
    z.object({ type: z.literal('progress_bar'), items: z.array(z.object({ label: z.string(), value: z.number(), displayValue: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('process_flow'), direction: z.enum(['horizontal', 'vertical']).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('icon_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ icon: z.string(), title: z.string(), subtitle: z.string().optional() })) }),
    z.object({ type: z.literal('option_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })) }),
    z.object({ type: z.literal('layout_bar_chart'), title: z.string().optional(), unit: z.string().optional(), groups: z.array(z.string()), groupColors: z.array(z.string()), items: z.array(z.object({ label: z.string(), values: z.array(z.number()) })), showLegend: z.boolean().optional() }),
    z.object({ type: z.literal('radar_chart'), axes: z.array(z.object({ label: z.string(), value: z.number(), max: z.number().optional() })), color: z.string().optional() }),
    z.object({ type: z.literal('timeline'), items: z.array(z.object({ stage: z.string(), icon: z.string().optional(), value: z.string().optional(), highlight: z.boolean().optional() })) }),
  ])
);

const zClaudeSection = z.object({
  type: z.literal('claude_layout'),
  title: z.string(),
  points: z.array(z.string()).optional(),
  blocks: z.array(zLayoutBlock),
  bgStyle: z.enum(['white', 'light', 'dark', 'primary']).optional(),
  padding: z.enum(['normal', 'compact', 'wide']).optional(),
  imageSlots: z.array(z.object({ slotType: z.string(), promptHint: z.string().optional() })).optional(),
});

// ── 헬퍼 ──
/** 객체 트리의 모든 문자열에 콜백(path는 점/인덱스 표기) */
function forEachString(node: unknown, cb: (s: string, path: string) => void, prefix = ''): void {
  if (typeof node === 'string') { cb(node, prefix); return; }
  if (Array.isArray(node)) { node.forEach((v, i) => forEachString(v, cb, `${prefix}[${i}]`)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) forEachString(v, cb, prefix ? `${prefix}.${k}` : k);
  }
}

/** 섹션의 blocks(및 columns.cols 재귀)를 순회 */
function forEachBlock(sec: unknown, cb: (block: Record<string, unknown>, path: string) => void): void {
  const blocks = (sec as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return;
  const walk = (arr: unknown[], prefix: string): void => {
    arr.forEach((b, i) => {
      if (b && typeof b === 'object') {
        const path = `${prefix}[${i}]`;
        cb(b as Record<string, unknown>, path);
        const cols = (b as { cols?: unknown }).cols;
        if (Array.isArray(cols)) cols.forEach((col, ci) => { if (Array.isArray(col)) walk(col, `${path}.cols[${ci}]`); });
      }
    });
  };
  walk(blocks, 'blocks');
}

/** 텍스트/항목이 비어 렌더링이 무의미한 블록인지 */
export function isEmptyBlock(block: Record<string, unknown>): boolean {
  const t = block.type;
  if ((t === 'heading' || t === 'subtext' || t === 'badge') &&
      (typeof block.text !== 'string' || block.text.trim() === '')) return true;
  const itemTypes = ['bullet_list', 'stat_row', 'icon_grid', 'option_grid', 'process_flow', 'progress_bar', 'timeline'];
  if (itemTypes.includes(t as string) && Array.isArray(block.items) && block.items.length === 0) return true;
  return false;
}

/** JSON 값 트리를 재귀 순회하며 문자열에서 CJK·U+FFFD를 제거 */
export function stripCjk(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(CJK_GLOBAL, '').replace(/�/g, '').trim();
  if (Array.isArray(value)) return value.map(stripCjk);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripCjk(v)]));
  }
  return value;
}

export { zLayoutBlock, zClaudeSection };

/** 생성된 PRO 레이아웃을 결정적으로 검증한다. 의미 오류는 여기서 다루지 않는다(LLM 담당). */
export function validateProLayout(sections: unknown): ValidationResult {
  if (!Array.isArray(sections)) {
    return {
      violations: [{ code: 'schema', path: 'sections', message: 'sections는 배열이어야 합니다.', severity: 'error', autoFixable: false }],
      isClean: false,
    };
  }

  const violations: Violation[] = [];

  if (sections.length < 6 || sections.length > 10) {
    violations.push({ code: 'section_count', path: 'sections', message: `섹션 ${sections.length}개 (권장 6~10)`, severity: 'warning', autoFixable: false });
  }

  sections.forEach((sec, i) => {
    const base = `sections[${i}]`;

    // 스키마
    const parsed = zClaudeSection.safeParse(sec);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push({ code: 'schema', path: `${base}.${issue.path.join('.')}`, message: issue.message, severity: 'error', autoFixable: false });
      }
    }

    // 연속 중복
    if (i > 0 && JSON.stringify(sec) === JSON.stringify(sections[i - 1])) {
      violations.push({ code: 'duplicate', path: base, message: '이전 섹션과 완전 동일', severity: 'warning', autoFixable: true });
    }

    // 문자열 기반 검사(cjk/broken_text/prohibited)
    forEachString(sec, (str, spath) => {
      const fullPath = spath ? `${base}.${spath}` : base;
      if (CJK_TEST.test(str)) violations.push({ code: 'cjk', path: fullPath, message: `한자 포함: "${str}"`, severity: 'error', autoFixable: true });
      if (str.includes('�')) violations.push({ code: 'broken_text', path: fullPath, message: '깨진 문자(U+FFFD) 포함', severity: 'warning', autoFixable: true });
      const prob = checkProhibitedPhrases(str);
      if (prob.violations.length > 0) violations.push({ code: 'prohibited', path: fullPath, message: `금지어: ${prob.violations.join(', ')}`, severity: 'error', autoFixable: false });
    });

    // 빈 블록
    forEachBlock(sec, (block, bpath) => {
      if (isEmptyBlock(block)) violations.push({ code: 'empty_block', path: `${base}.${bpath}`, message: `빈 블록(${String(block.type)})`, severity: 'warning', autoFixable: true });
    });
  });

  const isClean = !violations.some((v) => v.severity === 'error');
  return { violations, isClean };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/layout-validator.test.ts
git commit -m "feat(pro-layout): 결정적 검증기 validateProLayout + 테스트"
```

---

## Task 4: 코드 최소교정 폴백 `sanitizeProLayout`

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts` (함수 추가)
- Test: `src/__tests__/lib/detail-page/layout-validator.test.ts` (describe 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

기존 테스트 파일 하단에 다음 describe 블록을 추가한다. 상단 import에 `sanitizeProLayout`를 추가:

```ts
// import 라인 수정
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';
```

```ts
// 파일 하단에 추가
describe('sanitizeProLayout', () => {
  it('잔여 한자/U+FFFD를 삭제한다', () => {
    const secs = [{ type: 'claude_layout', title: '溫도�', blocks: [{ type: 'heading', text: '溫度관리', size: 'xl' }] }];
    const { sections } = sanitizeProLayout(secs);
    const s = sections[0] as any;
    expect(s.title).not.toMatch(/[一-鿿�]/);
    expect(s.blocks[0].text).toBe('관리');
  });

  it('빈 블록과 스키마 무효 블록을 제거한다', () => {
    const secs = [{
      type: 'claude_layout', title: 'T',
      blocks: [
        { type: 'heading', text: '   ', size: 'xl' },     // 빈 → 제거
        { type: 'made_up' },                               // 무효 → 제거
        { type: 'heading', text: '유효', size: 'lg' },      // 유지
      ],
    }];
    const { sections } = sanitizeProLayout(secs);
    const blocks = (sections[0] as any).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('유효');
  });

  it('연속 중복 섹션을 하나로 합친다', () => {
    const a = { type: 'claude_layout', title: 'A', blocks: [{ type: 'heading', text: 'A', size: 'xl' }] };
    const { sections } = sanitizeProLayout([a, JSON.parse(JSON.stringify(a))]);
    expect(sections).toHaveLength(1);
  });

  it('교정 후 남은 위반을 warnings로 반환한다(예: 섹션 수 부족)', () => {
    const { warnings } = sanitizeProLayout([{ type: 'claude_layout', title: 'A', blocks: [{ type: 'heading', text: 'A', size: 'xl' }] }]);
    expect(warnings.some((w) => w.code === 'section_count')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: FAIL — `sanitizeProLayout` export 없음

- [ ] **Step 3: 구현 — `layout-validator.ts` 하단에 추가**

```ts
/** 섹션의 빈/스키마무효 블록을 제거 */
function pruneBlocks(sec: unknown): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (Array.isArray(s.blocks)) {
    s.blocks = (s.blocks as unknown[]).filter(
      (b) => b !== null && typeof b === 'object'
        && !isEmptyBlock(b as Record<string, unknown>)
        && zLayoutBlock.safeParse(b).success
    );
  }
  return s;
}

/**
 * 결정적 코드 폴백. autoFixable 문제를 코드로 강제 교정하고,
 * 교정 후에도 남은 위반을 warnings로 반환한다.
 */
export function sanitizeProLayout(sections: unknown[]): { sections: unknown[]; warnings: Violation[] } {
  if (!Array.isArray(sections)) return { sections: [], warnings: validateProLayout(sections).violations };

  // 1) CJK·U+FFFD 삭제
  let cleaned = stripCjk(sections) as unknown[];
  // 2) 빈/무효 블록 제거
  cleaned = cleaned.map(pruneBlocks);
  // 3) 연속 중복 섹션 제거
  cleaned = cleaned.filter((sec, i) => i === 0 || JSON.stringify(sec) !== JSON.stringify(cleaned[i - 1]));

  const { violations } = validateProLayout(cleaned);
  return { sections: cleaned, warnings: violations };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: PASS (11 + 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/layout-validator.test.ts
git commit -m "feat(pro-layout): sanitizeProLayout 코드 폴백 교정 + 테스트"
```

---

## Task 5: LLM 리뷰·수리 `repairProLayout`

**Files:**
- Create: `src/lib/ai/repair-pro-layout.ts`
- Test: `src/__tests__/lib/ai/repair-pro-layout.test.ts`

`callClaude`를 모킹하여 프롬프트 구성·응답 파싱·실패 폴백을 검증한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/ai/repair-pro-layout.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

import { repairProLayout } from '@/lib/ai/repair-pro-layout';
import type { Violation } from '@/lib/detail-page/layout-validator';

const PRODUCT = { name: '테스트상품', points: ['가벼움'], category: '' };
const VIOLATIONS: Violation[] = [
  { code: 'cjk', path: 'sections[0].blocks[0].text', message: '한자 포함: "溫度"', severity: 'error', autoFixable: true },
];

beforeEach(() => callClaudeMock.mockReset());

describe('repairProLayout', () => {
  it('수리된 JSON 배열을 파싱해 반환한다', async () => {
    callClaudeMock.mockResolvedValue('```json\n[{"type":"claude_layout","title":"온도","blocks":[]}]\n```');
    const out = await repairProLayout([{ type: 'claude_layout', title: '溫度', blocks: [] }], VIOLATIONS, PRODUCT);
    expect(out).toEqual([{ type: 'claude_layout', title: '온도', blocks: [] }]);
  });

  it('프롬프트에 루브릭과 위반 목록을 포함한다', async () => {
    callClaudeMock.mockResolvedValue('[{"type":"claude_layout","title":"x","blocks":[]}]');
    await repairProLayout([{ type: 'claude_layout', title: 'x', blocks: [] }], VIOLATIONS, PRODUCT);
    const [system, user, model] = callClaudeMock.mock.calls[0];
    expect(system).toContain('option_grid');          // 루브릭 주입
    expect(user).toContain('溫度');                     // 위반 메시지 포함
    expect(user).toContain('[cjk]');                   // 위반 코드 포함
    expect(model).toBe('sonnet');                      // 저비용 리뷰어
  });

  it('JSON 파싱 실패 시 원본을 반환한다', async () => {
    callClaudeMock.mockResolvedValue('no json at all');
    const orig = [{ type: 'claude_layout', title: 'x', blocks: [] }];
    expect(await repairProLayout(orig, VIOLATIONS, PRODUCT)).toBe(orig);
  });

  it('callClaude가 throw하면 원본을 반환한다', async () => {
    callClaudeMock.mockRejectedValue(new Error('CLI down'));
    const orig = [{ type: 'claude_layout', title: 'x', blocks: [] }];
    expect(await repairProLayout(orig, VIOLATIONS, PRODUCT)).toBe(orig);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/ai/repair-pro-layout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/repair-pro-layout'`

- [ ] **Step 3: 구현**

```ts
// src/lib/ai/repair-pro-layout.ts
import { callClaude } from '@/lib/ai/claude-cli';
import { extractJsonArray } from '@/lib/ai/json-extract';
import { DETAIL_PAGE_PERSONA, BLOCK_TYPE_RUBRIC } from '@/lib/ai/detail-page-rubric';
import type { Violation } from '@/lib/detail-page/layout-validator';

const REPAIR_SYSTEM = `${DETAIL_PAGE_PERSONA}

You are reviewing an ALREADY-GENERATED mobile detail-page layout (a JSON array of "claude_layout" sections).
Your job: fix problems and return the corrected JSON array only.

${BLOCK_TYPE_RUBRIC}

REVIEW CHECKLIST:
1. Fix every issue in the ISSUES list below.
2. Verify each block type fits its content per the rules above; reassign wrong types (예: 사이즈를 process_flow로 만든 경우 반드시 option_grid로 교체).
3. Rewrite any Chinese characters into Korean — never delete text leaving a broken sentence.
4. Keep all valid content and structure unchanged. If a section is already correct, return it unchanged.

Return ONLY the corrected JSON array — no explanation, no code fences.`;

export interface RepairProductInfo {
  name: string;
  points: string[];
  category: string;
}

/**
 * 생성된 레이아웃을 Claude(Sonnet)로 리뷰·수리한다.
 * 호출/파싱 실패 시 원본 sections를 그대로 반환한다(상위 폴백이 처리).
 */
export async function repairProLayout(
  sections: unknown[],
  violations: Violation[],
  productInfo: RepairProductInfo,
): Promise<unknown[]> {
  const issuesText = violations.length > 0
    ? violations.map((v) => `- [${v.code}] ${v.path}: ${v.message}`).join('\n')
    : '(no deterministic issues found — still verify block-type appropriateness per the rubric)';

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0 ? `Key points:\n${productInfo.points.map((p) => `- ${p}`).join('\n')}` : '',
    `ISSUES:\n${issuesText}`,
    `CURRENT LAYOUT JSON:\n${JSON.stringify(sections)}`,
  ].filter(Boolean).join('\n\n');

  let text: string;
  try {
    text = await callClaude(REPAIR_SYSTEM, userPrompt, 'sonnet', 16000);
  } catch {
    return sections;
  }

  const jsonStr = extractJsonArray(text);
  if (!jsonStr) return sections;
  try {
    const repaired = JSON.parse(jsonStr) as unknown[];
    return Array.isArray(repaired) && repaired.length > 0 ? repaired : sections;
  } catch {
    return sections;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/ai/repair-pro-layout.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/repair-pro-layout.ts src/__tests__/lib/ai/repair-pro-layout.test.ts
git commit -m "feat(pro-layout): repairProLayout LLM 리뷰·수리(Sonnet) + 테스트"
```

---

## Task 6: 오케스트레이션 `validateAndRepair`

**Files:**
- Create: `src/lib/detail-page/validate-and-repair.ts`
- Test: `src/__tests__/lib/detail-page/validate-and-repair.test.ts`

루프를 순수 함수로 분리해 repair 함수를 주입 가능하게 한다. 규칙: **pass 0은 항상 repair 실행(의미 점검)**, 재검증 후 error 잔존 시 pass 1 실행, 총 최대 2회 LLM 콜, 이후 `sanitizeProLayout`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/detail-page/validate-and-repair.test.ts
import { describe, it, expect, vi } from 'vitest';
import { validateAndRepair } from '@/lib/detail-page/validate-and-repair';

const PRODUCT = { name: 'p', points: [], category: '' };

function cleanSections(): unknown[] {
  return Array.from({ length: 6 }, (_, i) => ({
    type: 'claude_layout', title: `S${i}`, blocks: [{ type: 'heading', text: `H${i}`, size: 'xl' }],
  }));
}

describe('validateAndRepair', () => {
  it('clean 입력이어도 pass0에서 repair를 1회 실행한다(의미 점검)', async () => {
    const repair = vi.fn(async (s: unknown[]) => s);
    const res = await validateAndRepair(cleanSections(), PRODUCT, { repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(res.warnings.filter((w) => w.severity === 'error')).toHaveLength(0);
  });

  it('pass0 후에도 error가 남으면 pass1을 실행한다(총 2회)', async () => {
    // repair가 계속 한자를 남기는 나쁜 케이스
    const bad = [{ type: 'claude_layout', title: '溫度', blocks: [{ type: 'heading', text: '溫度', size: 'xl' }] }];
    const repair = vi.fn(async () => bad);
    await validateAndRepair(bad, PRODUCT, { repair });
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it('pass0가 error를 없애면 pass1은 실행하지 않는다', async () => {
    const dirty = [{ type: 'claude_layout', title: '溫度', blocks: [{ type: 'heading', text: '溫度', size: 'xl' }] }];
    const repair = vi.fn(async () => cleanSections()); // 한 번에 정상화
    await validateAndRepair(dirty, PRODUCT, { repair });
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('최종 결과는 sanitize를 거쳐 warnings를 포함한다', async () => {
    const bad = [{ type: 'claude_layout', title: '溫度', blocks: [{ type: 'heading', text: '溫度', size: 'xl' }] }];
    const repair = vi.fn(async () => bad); // 계속 실패
    const res = await validateAndRepair(bad, PRODUCT, { repair });
    // sanitize가 한자를 삭제했으므로 결과엔 한자가 없다
    expect(JSON.stringify(res.sections)).not.toMatch(/[一-鿿]/);
    // 섹션 수 부족 경고는 남는다
    expect(res.warnings.some((w) => w.code === 'section_count')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/validate-and-repair.test.ts`
Expected: FAIL — `Cannot find module '@/lib/detail-page/validate-and-repair'`

- [ ] **Step 3: 구현**

```ts
// src/lib/detail-page/validate-and-repair.ts
import { validateProLayout, sanitizeProLayout, type Violation } from '@/lib/detail-page/layout-validator';
import { repairProLayout, type RepairProductInfo } from '@/lib/ai/repair-pro-layout';

type RepairFn = (
  sections: unknown[],
  violations: Violation[],
  productInfo: RepairProductInfo,
) => Promise<unknown[]>;

interface Options {
  maxLlmPasses?: number; // 기본 2 (pass0 항상 + 필요 시 pass1)
  repair?: RepairFn;
}

/**
 * 생성된 PRO 레이아웃을 검증→수리 루프로 정제한다.
 * - pass 0: 항상 repair 실행(결정적 위반 + 의미 점검)
 * - pass ≥ 1: 재검증에서 error가 남을 때만 실행
 * - 총 maxLlmPasses회 후 sanitizeProLayout으로 마무리
 */
export async function validateAndRepair(
  sections: unknown[],
  productInfo: RepairProductInfo,
  opts: Options = {},
): Promise<{ sections: unknown[]; warnings: Violation[] }> {
  const repair = opts.repair ?? repairProLayout;
  const maxPasses = opts.maxLlmPasses ?? 2;

  let current = sections;
  for (let pass = 0; pass < maxPasses; pass++) {
    const { violations, isClean } = validateProLayout(current);
    if (pass > 0 && isClean) break;
    current = await repair(current, violations, productInfo);
  }

  return sanitizeProLayout(Array.isArray(current) ? current : sections);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/validate-and-repair.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/validate-and-repair.ts src/__tests__/lib/detail-page/validate-and-repair.test.ts
git commit -m "feat(pro-layout): validateAndRepair 오케스트레이션 루프 + 테스트"
```

---

## Task 7: route.ts 배선 — 프롬프트 루브릭화 + 검증·수리 + warnings

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`

기존 로컬 `stripCjk`/`extractJsonArray`를 제거하고 공용 유틸·검증 파이프라인을 연결한다.

- [ ] **Step 1: import 교체 및 로컬 헬퍼 제거**

`route.ts` 상단 import에 다음을 추가:

```ts
import { extractJsonArray } from '@/lib/ai/json-extract';
import { validateAndRepair } from '@/lib/detail-page/validate-and-repair';
import { DETAIL_PAGE_PERSONA, BLOCK_TYPE_RUBRIC } from '@/lib/ai/detail-page-rubric';
```

그리고 파일에서 로컬 정의 **`const CJK_REGEX`(80-81), `function stripCjk`(83-91), `function extractJsonArray`(93-116)를 삭제**한다(공용 유틸/검증기로 대체됨).

- [ ] **Step 2: `CLAUDE_SYSTEM`을 루브릭 기반으로 재구성**

기존 `CLAUDE_SYSTEM`(37-78) 전체를 아래로 교체. DSL 스키마 나열은 유지하고, 중복되던 텍스트/블록 선택 규칙(구 규칙 7·9)은 `BLOCK_TYPE_RUBRIC`로 일원화한다.

```ts
const CLAUDE_SYSTEM = `${DETAIL_PAGE_PERSONA}
Generate a complete page layout as a JSON array of sections for mobile (390px width).

Each section is a ClaudeLayoutContent object:
{
  "type": "claude_layout",
  "title": "section title",
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide",
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki", "promptHint": "..."}]
}

Available block types in blocks[]:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?, color? }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N }
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap? }
- divider: { type }
- spacer: { type, height: number }
- progress_bar: { type, items: [{label, value(0-100), displayValue?, highlight?}] }
- process_flow: { type, direction?: 'horizontal'|'vertical', items: [{label, sublabel?, highlight?}] }
- icon_grid: { type, cols?: 2|3, items: [{icon, title, subtitle?}] }
- option_grid: { type, cols?: 2|3, items: [{label, sublabel?, highlight?}] }
- layout_bar_chart: { type, title?, unit?, groups: string[], groupColors: string[], items: [{label, values: number[]}], showLegend? }

${BLOCK_TYPE_RUBRIC}

STRUCTURE RULES:
- Generate 6-10 sections for a complete detail page.
- imageSlots map to section images. For lifestyle images use slotType "flux_lifestyle" with a descriptive Korean promptHint.
- Use extracted chart data EXACTLY as provided — do not modify numbers.

Return ONLY valid JSON array — no explanation, no code fences:
[section1, section2, ...]`;
```

- [ ] **Step 3: 생성 후 파이프라인 교체**

기존 파싱 후 `sections = stripCjk(sections)` + `return NextResponse.json({ success: true, sections })`(183-185) 구간을 아래로 교체:

```ts
    let sections: unknown[];
    try {
      sections = JSON.parse(jsonStr) as unknown[];
    } catch {
      console.error('[generate-pro-layout] JSON 파싱 실패. 추출된 문자열:', jsonStr.slice(0, 500));
      return NextResponse.json({ success: false, error: 'Claude 응답 JSON 파싱 실패' }, { status: 500 });
    }

    // 검증 → LLM 리뷰·수리(항상 1회 + 필요 시 1회) → 코드 폴백
    const { sections: finalSections, warnings } = await validateAndRepair(sections, productInfo);

    console.log('[generate-pro-layout] warnings:', warnings.length);
    return NextResponse.json({ success: true, sections: finalSections, warnings });
```

- [ ] **Step 4: 타입체크 + 관련 테스트 재실행**

Run: `npx tsc --noEmit 2>&1 | grep -E 'generate-pro-layout|validate-and-repair|layout-validator|repair-pro-layout' || echo "OK"`
Expected: `OK`

Run: `npx vitest run src/__tests__/lib/detail-page/validate-and-repair.test.ts src/__tests__/lib/ai/repair-pro-layout.test.ts src/__tests__/lib/detail-page/layout-validator.test.ts src/__tests__/lib/json-extract.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/generate-pro-layout/route.ts
git commit -m "feat(pro-layout): 생성 프롬프트 루브릭화 + 검증·수리 파이프라인 연결"
```

---

## Task 8: 결과 화면 경고 배너

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: Violation 타입 import 및 상태 추가**

상단 import에 추가:

```ts
import type { Violation } from '@/lib/detail-page/layout-validator';
```

`generatedSections` 상태 선언(58 부근) 아래에 경고 상태 추가:

```ts
  const [layoutWarnings, setLayoutWarnings] = useState<Violation[]>([]);
```

- [ ] **Step 2: 응답 처리에서 warnings 수신**

`handleGenerate`의 응답 타입(175)과 성공 처리(183-184)를 수정:

```ts
      const data = await res.json() as { success: boolean; sections?: GeneratedSection[]; warnings?: Violation[]; error?: string; _debug?: string };
      if (!data.success || !data.sections) {
        const debugInfo = data._debug ? `\n[debug] ${data._debug}` : '';
        setError((data.error ?? '레이아웃 생성 실패') + debugInfo);
        setScreen('review');
        return;
      }

      setGeneratedSections(data.sections);
      setLayoutWarnings(data.warnings ?? []);
      setScreen('result');
```

- [ ] **Step 3: 결과 화면 상단에 배너 렌더링**

`screen === 'result'` 블록에서 섹션 미리보기 목록 바로 위에 다음 배너를 추가한다(경고가 있을 때만 표시). 스타일은 기존 다크 테마(`#1e1e2e`, `#374151`)에 맞춘다:

```tsx
{layoutWarnings.length > 0 && (
  <div style={{
    background: '#2a2320', border: '1px solid #b45309', borderRadius: 8,
    padding: '12px 14px', marginBottom: 16, color: '#fcd34d', fontSize: 13,
  }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>
      ⚠️ 자동 보정 후 {layoutWarnings.length}개 항목을 확인하세요
    </div>
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
      {layoutWarnings.slice(0, 8).map((w, i) => (
        <li key={i}>[{w.code}] {w.path}: {w.message}</li>
      ))}
      {layoutWarnings.length > 8 && <li>…외 {layoutWarnings.length - 8}건</li>}
    </ul>
  </div>
)}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep detail-maker-pro || echo "OK"`
Expected: `OK`

- [ ] **Step 5: 수동 검증(선택)**

로컬 dev 서버에서 PRO 모드 생성을 1회 실행하여, (a) 정상 케이스는 배너 미표시, (b) 의도적으로 한자 포함 참고 이미지로 경고 배너가 뜨는지 육안 확인. 자동화는 범위 밖(수동).

- [ ] **Step 6: Commit**

```bash
git add src/app/listing/[id]/detail-maker-pro/page.tsx
git commit -m "feat(pro-layout): 결과 화면 검증 경고 배너 추가"
```

---

## 최종 검증

- [ ] **전체 신규 테스트 통과 확인**

Run:
```bash
npx vitest run \
  src/__tests__/lib/json-extract.test.ts \
  src/__tests__/lib/detail-page/layout-validator.test.ts \
  src/__tests__/lib/ai/repair-pro-layout.test.ts \
  src/__tests__/lib/detail-page/validate-and-repair.test.ts
```
Expected: 전체 PASS

- [ ] **타입체크 전체**

Run: `npx tsc --noEmit`
Expected: 에러 없음(기존 무관 에러 제외)

- [ ] **타임아웃 실측(스펙 §4.5)**

로컬에서 PRO 생성 1회 실행 후 서버 로그로 총 소요시간이 `maxDuration=180s` 내인지 확인. 초과 위험 시 `route.ts`의 `maxDuration` 상향 또는 리뷰 `maxTokens`/모델 조정을 후속 이슈로 기록.

---

## Self-Review 체크리스트 결과

- **스펙 커버리지**: §4.1 루브릭(T1) / §4.2 검증기(T3) / §4.4 sanitize(T4) / §4.3 repair(T5) / §4.5 오케스트레이션(T6, route T7) / §4.6 UI(T8) / §6 테스트(각 Task) — 전 항목 대응.
- **의도적 편차**: radar/timeline 유효 허용, 오케스트레이션 별도 모듈화 — 상단에 명시.
- **타입 일관성**: `Violation`/`ValidationResult`/`RepairProductInfo`/`validateProLayout`/`sanitizeProLayout`/`repairProLayout`/`validateAndRepair` 시그니처가 Task 간 일치.
