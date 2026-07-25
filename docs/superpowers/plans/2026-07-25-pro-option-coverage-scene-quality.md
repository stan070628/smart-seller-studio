# PRO 옵션 고른 노출 + 씬 품질 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 상세페이지에서 상품 옵션(색상)이 한 페이지 안에 고르게 노출되고, 무의미한 지표·제미나이 워터마크·부정적 인물 씬이 나오지 않게 한다.

**Architecture:** 옵션은 업로드 이미지에 붙는 이름이며, 섹션이 쓰는 옵션은 `imageSlots[].imageRef`로 역산한다(DSL 스키마 무변경). 순수 로직은 `product-options.ts`에 모으고, 결정론적 교정은 `layout-validator.ts`가, 의미 교정은 기존 `repairProLayout` 1패스가 맡는다. 워터마크는 자동 감지를 철회하고 수동 제거 도구를 업로드 화면에 상시 노출한다.

**Tech Stack:** Next.js App Router, TypeScript, zod, vitest, sharp, Claude(레이아웃/수리) + Gemini(이미지)

**설계 문서:** `docs/superpowers/specs/2026-07-25-pro-option-coverage-scene-quality-design.md`

---

## 사전 확인

> **`page.tsx`는 지금도 병렬로 바뀌고 있다.** 이 계획을 쓰는 동안에만 `16f9a471` → `1c6b03d2` → `8ce88538`(shot-guide Phase3) 세 커밋이 들어와 1135 → 1222 → 1283줄이 됐고, 씬 생성부의 변수가 `uploadedImageUrls`에서 `effectiveProductUrls`로 바뀌었다.
>
> **줄번호를 앵커로 쓰지 말 것.** 인용된 코드 조각으로 찾고, 착수 전에 해당 블록을 먼저 읽어 현재 구조를 확인한다. 특히 Task 12·13·14는 시작 전에 아래를 돌려 구조가 계획과 같은지 본다:
>
> ```bash
> grep -n "uploadedImageUrls\|effectiveProductUrls\|productImageUrls\|realBySection" "src/app/listing/[id]/detail-maker-pro/page.tsx"
> ```

테스트 실행 시 `npx vitest run`을 인자 없이 돌리면 무관한 선재 실패가 섞인다. 항상 경로를 지정한다.

### 작업 순서 의존성

```
Task 1 (옵션 모듈)
  ├→ Task 2 (stat 위생) → Task 3 (커버리지) ─┐
  └────────────────────────────────────────┤
Task 4 (repair) ────────────────────────────┼→ Task 6 (라우트 결선)
Task 5 (프롬프트) ──────────────────────────┘

Task 7 (워터마크 철거)  ← 독립
Task 8 (API base64) → Task 9 (모달) ─→ Task 12 (PRO UI) → Task 13 → Task 14
Task 10 (중복 상수 제거) → Task 11 (프롬프트 규칙)   ← 순서 필수
```

---

## Task 1: 옵션 순수 모듈

**Files:**
- Create: `src/lib/detail-page/product-options.ts`
- Test: `src/__tests__/lib/detail-page/product-options.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/product-options.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveOptions,
  uniqueOptionNames,
  isOptionMode,
  optionNameByImageIndex,
  collectOptionCoverage,
  type OptionSection,
} from '@/lib/detail-page/product-options';

describe('deriveOptions', () => {
  it('이름이 붙은 이미지마다 항목을 하나씩 만든다 (중복을 접지 않는다)', () => {
    expect(deriveOptions(['화이트', '블랙', '블랙', ''])).toEqual([
      { name: '화이트', imageIndex: 0 },
      { name: '블랙', imageIndex: 1 },
      { name: '블랙', imageIndex: 2 },
    ]);
  });

  it('공백을 제거하고 빈 문자열은 버린다', () => {
    expect(deriveOptions(['  화이트  ', '   ', '블랙'])).toEqual([
      { name: '화이트', imageIndex: 0 },
      { name: '블랙', imageIndex: 2 },
    ]);
  });

  it('40자를 넘으면 자른다', () => {
    const long = 'ㄱ'.repeat(50);
    expect(deriveOptions([long])[0]!.name).toHaveLength(40);
  });
});

describe('uniqueOptionNames', () => {
  it('입력 순서를 유지하며 중복을 접는다', () => {
    const opts = deriveOptions(['블랙', '화이트', '블랙']);
    expect(uniqueOptionNames(opts)).toEqual(['블랙', '화이트']);
  });
});

describe('isOptionMode', () => {
  it('고유 옵션명이 2개 이상이면 true', () => {
    expect(isOptionMode(deriveOptions(['화이트', '블랙']))).toBe(true);
  });

  it('같은 이름만 여러 개면 false', () => {
    expect(isOptionMode(deriveOptions(['블랙', '블랙']))).toBe(false);
  });

  it('빈 입력이면 false', () => {
    expect(isOptionMode(deriveOptions(['', '']))).toBe(false);
  });
});

describe('optionNameByImageIndex', () => {
  it('이름이 붙은 모든 인덱스를 담는다', () => {
    const map = optionNameByImageIndex(deriveOptions(['화이트', '블랙', '블랙']));
    expect(map.get(0)).toBe('화이트');
    expect(map.get(1)).toBe('블랙');
    expect(map.get(2)).toBe('블랙');
    expect(map.has(3)).toBe(false);
  });
});

/** imageSlots만 가진 최소 섹션 */
function section(imageRefs: Array<number | undefined>): OptionSection {
  return { blocks: [], imageSlots: imageRefs.map((r) => ({ imageRef: r })) };
}

/** 옵션 수만큼 슬롯과 option_grid items를 가진 비교 섹션 */
function compareSection(imageRefs: number[]): OptionSection {
  return {
    blocks: [{ type: 'option_grid', items: imageRefs.map(() => ({ label: 'x' })) }],
    imageSlots: imageRefs.map((r) => ({ imageRef: r })),
  };
}

describe('collectOptionCoverage', () => {
  const nameByIdx = optionNameByImageIndex(deriveOptions(['화이트', '블랙']));

  it('비교 섹션을 집계에서 제외한다', () => {
    const cov = collectOptionCoverage([compareSection([0, 1]), section([0])], nameByIdx);
    expect(cov.compareSectionCount).toBe(1);
    expect(cov.counts.get('화이트')).toBe(1);
    expect(cov.counts.get('블랙')).toBe(0);
    expect(cov.total).toBe(1);
  });

  it('등장하지 않은 옵션도 0으로 채운다', () => {
    const cov = collectOptionCoverage([section([0, 0])], nameByIdx);
    expect(cov.counts.get('블랙')).toBe(0);
  });

  it('imageRef 미지정 슬롯을 unresolvedSlots로 센다', () => {
    const cov = collectOptionCoverage([section([undefined, 0])], nameByIdx);
    expect(cov.unresolvedSlots).toBe(1);
    expect(cov.counts.get('화이트')).toBe(1);
  });

  it('이름이 없는 인덱스를 가리키는 슬롯도 unresolvedSlots', () => {
    const cov = collectOptionCoverage([section([3])], nameByIdx);
    expect(cov.unresolvedSlots).toBe(1);
  });

  it('option_grid가 있어도 슬롯 수가 옵션 수와 다르면 비교 섹션이 아니다', () => {
    const sizeGrid: OptionSection = {
      blocks: [{ type: 'option_grid', items: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }],
      imageSlots: [{ imageRef: 0 }],
    };
    const cov = collectOptionCoverage([sizeGrid], nameByIdx);
    expect(cov.compareSectionCount).toBe(0);
    expect(cov.counts.get('화이트')).toBe(1);
  });

  it('imageSlots가 없는 섹션은 건너뛴다', () => {
    const cov = collectOptionCoverage([{ blocks: [] }], nameByIdx);
    expect(cov.total).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/product-options.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/detail-page/product-options"`

- [ ] **Step 3: 모듈 구현**

`src/lib/detail-page/product-options.ts`:

```ts
// src/lib/detail-page/product-options.ts
//
// PRO 상세페이지의 상품 옵션(색상·모델) 도출과 커버리지 집계.
// 옵션은 업로드 이미지에 붙는 이름이며, 섹션이 쓰는 옵션은
// imageSlots[].imageRef가 가리키는 이미지에서 역산한다.

/** 옵션명이 붙은 제품 이미지 한 장 */
export interface ProductOption {
  /** 판매자가 입력한 옵션명. 예: "화이트" */
  name: string;
  /** productImages 배열 인덱스 (0-based) */
  imageIndex: number;
}

/** 커버리지 집계에 필요한 만큼만 좁힌 섹션 형태 */
export interface OptionSection {
  blocks?: Array<{ type?: string; items?: unknown[] } | null | undefined>;
  imageSlots?: Array<{ imageRef?: number }>;
}

export interface OptionCoverage {
  /** 비교 섹션 개수 */
  compareSectionCount: number;
  /** 옵션명 → 비교 섹션 밖 imageSlot 등장 횟수 (0회 옵션도 포함) */
  counts: Map<string, number>;
  /** 집계 대상 슬롯 총수 (비교 섹션 제외) */
  total: number;
  /** imageRef가 없거나 이름 없는 인덱스를 가리킨 슬롯 수 */
  unresolvedSlots: number;
}

const MAX_NAME_LENGTH = 40;

/**
 * optionNames[i]는 productImages[i]의 옵션명. 빈 문자열은 미지정.
 * 중복을 접지 않는다 — 블랙 사진이 2장이면 두 항목이 남아야
 * imageRef=2인 슬롯도 블랙으로 역산된다.
 */
export function deriveOptions(optionNames: string[]): ProductOption[] {
  return optionNames
    .map((name, imageIndex) => ({
      name: (name ?? '').trim().slice(0, MAX_NAME_LENGTH),
      imageIndex,
    }))
    .filter((o) => o.name !== '');
}

/** 고유 옵션명. 입력 순서 유지 */
export function uniqueOptionNames(options: ProductOption[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (seen.has(o.name)) continue;
    seen.add(o.name);
    out.push(o.name);
  }
  return out;
}

/** 고유 옵션명이 2개 이상이면 옵션 모드 */
export function isOptionMode(options: ProductOption[]): boolean {
  return uniqueOptionNames(options).length >= 2;
}

/** imageIndex → 옵션명 (이름이 붙은 모든 인덱스를 담는다) */
export function optionNameByImageIndex(options: ProductOption[]): Map<number, string> {
  return new Map(options.map((o) => [o.imageIndex, o.name]));
}

/**
 * 옵션 비교 섹션인지 판정한다.
 * option_grid 존재만으로는 부족하다 — 사이즈 안내도 option_grid이므로
 * 슬롯 수가 옵션 수와 같고 items 수와도 같아야 비교 섹션으로 본다.
 */
export function isCompareSection(section: OptionSection, optionCount: number): boolean {
  const slots = section.imageSlots ?? [];
  if (slots.length !== optionCount) return false;
  const grid = (section.blocks ?? []).find((b) => b?.type === 'option_grid');
  if (!grid) return false;
  return Array.isArray(grid.items) && grid.items.length === slots.length;
}

/**
 * 비교 섹션을 제외한 이미지 슬롯에서 옵션별 등장 횟수를 센다.
 * 비교 섹션을 포함하면 그 섹션의 균등한 1:1이 나머지 편중을 가려버린다.
 */
export function collectOptionCoverage(
  sections: OptionSection[],
  nameByImageIndex: Map<number, string>,
): OptionCoverage {
  const optionNames = [...new Set(nameByImageIndex.values())];
  const counts = new Map<string, number>(optionNames.map((n) => [n, 0]));

  let compareSectionCount = 0;
  let total = 0;
  let unresolvedSlots = 0;

  for (const section of sections) {
    const slots = section?.imageSlots ?? [];
    if (slots.length === 0) continue;

    if (isCompareSection(section, optionNames.length)) {
      compareSectionCount++;
      continue;
    }

    for (const slot of slots) {
      total++;
      const name =
        typeof slot?.imageRef === 'number' ? nameByImageIndex.get(slot.imageRef) : undefined;
      if (name === undefined) {
        unresolvedSlots++;
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return { compareSectionCount, counts, total, unresolvedSlots };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/product-options.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/product-options.ts src/__tests__/lib/detail-page/product-options.test.ts
git commit -m "feat(pro): 옵션 도출·커버리지 집계 순수 모듈"
```

---

## Task 2: stat_row 위생 (statHygiene 게이트)

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts`
- Test: `src/__tests__/lib/detail-page/layout-validator.test.ts` (추가)

**주의:** `sanitizeProLayout`은 `draft/route.ts:44`(저장)와 `render/route.ts:125`(렌더)에서도 호출된다. 이 경로는 사용자가 직접 편집한 콘텐츠를 다루므로, 게이트 없이 넣으면 손으로 쓴 "당류 0g"가 저장할 때마다 사라진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/layout-validator.test.ts` **끝에 추가**:

```ts
describe('sanitizeProLayout — stat_row 위생', () => {
  /** stat_row 하나를 가진 섹션 */
  function statSection(items: Array<{ label: string; value: string; unit?: string }>): unknown {
    return {
      type: 'claude_layout',
      title: '지표',
      blocks: [
        { type: 'heading', text: '지표', size: 'xl' },
        { type: 'stat_row', items },
      ],
    };
  }

  function statBlockOf(section: unknown): { items?: unknown[] } | undefined {
    const blocks = (section as { blocks?: Array<{ type?: string; items?: unknown[] }> }).blocks ?? [];
    return blocks.find((b) => b.type === 'stat_row');
  }

  it('statHygiene 없으면 아무것도 지우지 않는다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
    ])];
    const { sections } = sanitizeProLayout(secs);
    expect(statBlockOf(sections[0])!.items).toHaveLength(3);
  });

  it('치수 계열의 0값을 제거한다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('치수가 아닌 0값은 남긴다 (설탕 0g은 정당한 지표)', () => {
    const secs = [statSection([
      { label: '설탕', value: '0', unit: 'g' },
      { label: '열량', value: '25', unit: 'kcal' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    expect(statBlockOf(sections[0])!.items).toHaveLength(2);
  });

  it('개수 단위가 unit에 있으면 제거한다', () => {
    const secs = [statSection([
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('숫자와 개수 단위가 value에 결합된 경우도 제거한다', () => {
    const secs = [statSection([
      { label: '사이즈', value: '4단계' },
      { label: '컬러', value: '2종' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('없음/무/-/N/A 값을 제거한다', () => {
    const secs = [statSection([
      { label: '소매', value: '없음' },
      { label: '부자재', value: '-' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('남은 항목이 2개 미만이면 블록을 제거한다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    expect(statBlockOf(sections[0])).toBeUndefined();
  });

  it('columns.cols 안의 stat_row도 정리하고, 2개 미만이면 배열에서 뺀다', () => {
    const secs = [{
      type: 'claude_layout',
      title: '지표',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'stat_row', items: [
              { label: '소매 길이', value: '0', unit: 'cm' },
              { label: '무게', value: '180', unit: 'g' },
            ] }],
            [{ type: 'heading', text: '오른쪽', size: 'md' }],
          ],
        },
      ],
    }];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const cols = ((sections[0] as { blocks: Array<{ cols: unknown[][] }> }).blocks[0]!).cols;
    expect(cols[0]).toEqual([]);
    expect(cols[1]).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts -t 'stat_row 위생'`
Expected: FAIL — 위생 규칙이 없어 항목이 그대로 남는다

- [ ] **Step 3: 구현**

`src/lib/detail-page/layout-validator.ts`의 `isEmptyBlock` **위에** 추가:

```ts
// ── stat_row 위생 ──
// 치수의 0(= 그 부위가 없음)과 옵션 개수는 임팩트 수치가 아니다.
// "설탕 0g"처럼 0 자체가 셀링포인트인 경우가 있어 0값 제거는 치수로 좁힌다.
const DIMENSION_WORDS = /(cm|mm|㎜|㎝|인치|길이|두께|높이|너비|폭|깊이|지름|둘레)/i;
const COUNT_WORDS = /(단계|종|가지|개|컬러|색상|종류|옵션|세트)/;
const COUNT_VALUE = /^\d+\s*(단계|종|가지|개|컬러|색상|종류|옵션|세트)$/;
const ABSENT_VALUES = new Set(['없음', '무', '-', '–', 'N/A', 'n/a']);

interface StatItem { label?: string; value?: string; unit?: string }

/** 임팩트 수치로 볼 수 없는 stat 항목인지 */
export function isNoiseStatItem(item: StatItem): boolean {
  const value = (item?.value ?? '').trim();
  const label = item?.label ?? '';
  const unit = item?.unit ?? '';

  if (value === '' || ABSENT_VALUES.has(value)) return true;
  if (COUNT_VALUE.test(value)) return true;

  const nums = value.match(/\d+(?:\.\d+)?/g);
  if (!nums) return false;

  // 값이 0 + 치수 계열 → "소매 길이 0cm"
  if (nums.every((n) => Number(n) === 0) && DIMENSION_WORDS.test(`${label} ${unit} ${value}`)) {
    return true;
  }
  // 값이 정수 + label/unit이 개수 단위 → "4" + "단계"
  if (/^\d+$/.test(value) && COUNT_WORDS.test(`${label} ${unit}`)) return true;

  return false;
}

/**
 * blocks 배열의 stat_row 항목을 걸러낸다.
 * topLevel이면 2개 미만일 때 items를 비워 pruneBlocks가 제거하게 하고,
 * cols 안(topLevel=false)이면 pruneBlocks가 닿지 않으므로 블록을 직접 뺀다.
 */
function cleanStatBlocks(blocks: unknown[], topLevel: boolean): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') { out.push(b); continue; }
    const block = { ...(b as Record<string, unknown>) };

    if (Array.isArray(block.cols)) {
      block.cols = (block.cols as unknown[]).map((col) =>
        Array.isArray(col) ? cleanStatBlocks(col, false) : col
      );
    }

    if (block.type === 'stat_row' && Array.isArray(block.items)) {
      const kept = (block.items as StatItem[]).filter(
        (it) => it && typeof it === 'object' && !isNoiseStatItem(it)
      );
      if (kept.length < 2) {
        if (!topLevel) continue; // cols 안: 블록 자체 제거
        block.items = [];        // 최상위: pruneBlocks가 제거
      } else {
        block.items = kept;
      }
    }
    out.push(block);
  }
  return out;
}

/** 섹션의 stat_row를 위생 처리 */
function sanitizeStatRows(sec: unknown): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (!Array.isArray(s.blocks)) return s;
  s.blocks = cleanStatBlocks(s.blocks as unknown[], true);
  return s;
}
```

`sanitizeProLayout` 시그니처와 파이프라인 교체:

```ts
export interface ProLayoutOpts {
  /** stat_row 위생. 생성 경로에서만 true (draft/render는 사용자 편집본이라 건드리지 않는다) */
  statHygiene?: boolean;
  /** 옵션 모드일 때 imageIndex → 옵션명 */
  optionNameByImageIndex?: Map<number, string>;
}

export function sanitizeProLayout(
  sections: unknown[],
  opts?: ProLayoutOpts,
): { sections: unknown[]; warnings: Violation[] } {
  if (!Array.isArray(sections)) return { sections: [], warnings: validateProLayout(sections, opts).violations };

  // 1) CJK·U+FFFD 삭제
  let cleaned = stripCjk(sections) as unknown[];
  // 2) stat_row 위생 (생성 경로 전용)
  if (opts?.statHygiene) cleaned = cleaned.map(sanitizeStatRows);
  // 3) 빈/무효 블록 제거
  cleaned = cleaned.map(pruneBlocks);
  // 4) 연속 중복 섹션 제거
  cleaned = cleaned.filter((sec, i) => i === 0 || JSON.stringify(sec) !== JSON.stringify(cleaned[i - 1]));
  // 5) image 블록 ↔ imageSlots 정합성 (범위 클램프 + 부재 시 주입)
  cleaned = cleaned.map(normalizeSectionImages);

  const { violations } = validateProLayout(cleaned, opts);
  return { sections: cleaned, warnings: violations };
}
```

`validateProLayout` 시그니처에 `opts`를 추가한다(본문은 Task 3에서 사용):

```ts
export function validateProLayout(sections: unknown, opts?: ProLayoutOpts): ValidationResult {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: PASS — 기존 테스트 + stat 위생 8개

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/layout-validator.test.ts
git commit -m "feat(pro): stat_row 위생 (statHygiene 게이트로 생성 경로 한정)"
```

---

## Task 3: 옵션 커버리지 검증

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts`
- Test: `src/__tests__/lib/detail-page/layout-validator.test.ts` (추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/layout-validator.test.ts` 끝에 추가:

```ts
describe('validateProLayout — 옵션 커버리지', () => {
  const nameByIdx = new Map<number, string>([[0, '화이트'], [1, '블랙']]);

  function imgSection(title: string, refs: Array<number | undefined>): unknown {
    return {
      type: 'claude_layout',
      title,
      blocks: [{ type: 'heading', text: title, size: 'xl' }],
      imageSlots: refs.map((r) => ({ slotType: 'flux_lifestyle', imageRef: r })),
    };
  }

  function compareSection(): unknown {
    return {
      type: 'claude_layout',
      title: '컬러',
      blocks: [{ type: 'option_grid', items: [{ label: '화이트' }, { label: '블랙' }] }],
      imageSlots: [
        { slotType: 'product_nukki', imageRef: 0 },
        { slotType: 'product_nukki', imageRef: 1 },
      ],
    };
  }

  /** 비교 1개 + 화이트 2 / 블랙 2 — 균형 잡힌 6섹션 */
  function balanced(): unknown[] {
    return [
      imgSection('히어로', [0]),
      imgSection('소재', [1]),
      compareSection(),
      imgSection('디테일', [0]),
      imgSection('활용', [1]),
      { type: 'claude_layout', title: '안내', blocks: [{ type: 'heading', text: '안내', size: 'xl' }] },
    ];
  }

  it('opts가 없으면 옵션 검사를 하지 않는다', () => {
    const secs = [imgSection('a', [0]), imgSection('b', [0]), ...balanced().slice(2)];
    const res = validateProLayout(secs);
    expect(res.violations.filter((v) => v.code.startsWith('option'))).toHaveLength(0);
  });

  it('옵션이 1개면 검사하지 않는다', () => {
    const single = new Map<number, string>([[0, '화이트']]);
    const res = validateProLayout(balanced(), { optionNameByImageIndex: single });
    expect(res.violations.filter((v) => v.code.startsWith('option'))).toHaveLength(0);
  });

  it('균형 잡힌 레이아웃은 옵션 위반이 없다', () => {
    const res = validateProLayout(balanced(), { optionNameByImageIndex: nameByIdx });
    expect(res.violations.filter((v) => v.code.startsWith('option'))).toHaveLength(0);
  });

  it('비교 섹션이 없으면 error', () => {
    const secs = balanced().filter((_, i) => i !== 2);
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    const v = res.violations.find((x) => x.code === 'option_compare');
    expect(v?.severity).toBe('error');
    expect(res.isClean).toBe(false);
  });

  it('한 옵션이 비교 섹션 밖에 한 번도 안 나오면 error', () => {
    const secs = balanced();
    secs[1] = imgSection('소재', [0]);
    secs[4] = imgSection('활용', [0]);
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    const v = res.violations.find((x) => x.code === 'option_coverage');
    expect(v?.severity).toBe('error');
    expect(v?.message).toContain('블랙');
  });

  it('등장 횟수 편차가 1을 넘으면 error', () => {
    const secs = balanced();
    secs[3] = imgSection('디테일', [0, 0]);
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    // 화이트 4 / 블랙 2 → 편차 2
    expect(res.violations.some((x) => x.code === 'option_coverage')).toBe(true);
  });

  it('편차가 정확히 1이면 통과한다', () => {
    const secs = balanced();
    secs[3] = imgSection('디테일', [0]);
    secs[4] = imgSection('활용', [1]);
    secs[0] = imgSection('히어로', [0]);
    secs[1] = imgSection('소재', [1]);
    secs.push(imgSection('추가', [0]));
    // 화이트 3 / 블랙 2 → 편차 1
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    expect(res.violations.filter((v) => v.code === 'option_coverage')).toHaveLength(0);
  });

  it('비교 섹션 밖 슬롯에 imageRef가 없으면 error', () => {
    const secs = balanced();
    secs[0] = imgSection('히어로', [undefined]);
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    const v = res.violations.find((x) => x.code === 'option_coverage' && x.message.includes('imageRef'));
    expect(v?.severity).toBe('error');
  });

  it('비교 섹션이 2개 이상이면 warning (error 아님)', () => {
    const secs = balanced();
    secs.splice(3, 0, compareSection());
    const res = validateProLayout(secs, { optionNameByImageIndex: nameByIdx });
    const v = res.violations.find((x) => x.code === 'option_compare');
    expect(v?.severity).toBe('warning');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts -t '옵션 커버리지'`
Expected: FAIL — `option_compare`/`option_coverage` 위반이 생성되지 않는다

- [ ] **Step 3: 구현**

`layout-validator.ts` 상단 import에 추가:

```ts
import { collectOptionCoverage, type OptionSection } from './product-options';
```

`Violation` 인터페이스의 `code` union에 두 값 추가:

```ts
export interface Violation {
  code:
    | 'schema' | 'cjk' | 'broken_text' | 'empty_block'
    | 'duplicate' | 'section_count' | 'prohibited'
    | 'option_compare' | 'option_coverage';
  path: string;
  message: string;
  severity: 'error' | 'warning';
  autoFixable: boolean;
}
```

`validateProLayout` 안, `sections.forEach(...)` 루프가 끝난 **뒤** `const isClean = ...` **앞에** 추가:

```ts
  // ── 옵션 커버리지 (옵션 모드에서만) ──
  const nameByIdx = opts?.optionNameByImageIndex;
  if (nameByIdx && new Set(nameByIdx.values()).size >= 2) {
    const cov = collectOptionCoverage(sections as OptionSection[], nameByIdx);

    if (cov.compareSectionCount === 0) {
      violations.push({
        code: 'option_compare', path: 'sections',
        message: '옵션 비교 섹션이 없습니다. option_grid + 옵션 수만큼의 imageSlots를 가진 섹션이 1개 필요합니다.',
        severity: 'error', autoFixable: false,
      });
    } else if (cov.compareSectionCount > 1) {
      violations.push({
        code: 'option_compare', path: 'sections',
        message: `옵션 비교 섹션이 ${cov.compareSectionCount}개입니다 (1개여야 함).`,
        severity: 'warning', autoFixable: false,
      });
    }

    if (cov.unresolvedSlots > 0) {
      violations.push({
        code: 'option_coverage', path: 'sections',
        message: `비교 섹션 밖 이미지 슬롯 ${cov.unresolvedSlots}개에 imageRef가 없거나 옵션명 없는 이미지를 가리킵니다.`,
        severity: 'error', autoFixable: false,
      });
    }

    const entries = [...cov.counts.entries()];
    const zero = entries.filter(([, c]) => c === 0).map(([n]) => n);
    if (zero.length > 0) {
      violations.push({
        code: 'option_coverage', path: 'sections',
        message: `비교 섹션 밖에서 한 번도 등장하지 않은 옵션: ${zero.join(', ')}`,
        severity: 'error', autoFixable: false,
      });
    } else if (entries.length > 0) {
      const counts = entries.map(([, c]) => c);
      if (Math.max(...counts) - Math.min(...counts) > 1) {
        violations.push({
          code: 'option_coverage', path: 'sections',
          message: `옵션 편중: ${entries.map(([n, c]) => `${n} ${c}회`).join(', ')} (편차 1 이하여야 함)`,
          severity: 'error', autoFixable: false,
        });
      }
    }
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator.test.ts`
Expected: PASS — 옵션 커버리지 9개 포함 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/layout-validator.test.ts
git commit -m "feat(pro): 옵션 커버리지 검증 (비교 섹션 필수 + 편차 1 이하)"
```

---

## Task 4: repair에 옵션 컨텍스트 전달

**Files:**
- Modify: `src/lib/ai/repair-pro-layout.ts`

테스트 없음 — 프롬프트 문자열 조립만 바뀌고 동작 분기가 없다. Task 6의 라우트 테스트가 결선을 덮는다.

- [ ] **Step 1: `RepairProductInfo`에 필드 추가**

`src/lib/ai/repair-pro-layout.ts:22-26`을 교체:

```ts
export interface RepairProductInfo {
  name: string;
  points: string[];
  category: string;
  /** 옵션 모드일 때만. 예: ['이미지 0 = "화이트"', '이미지 1 = "블랙"'] */
  optionLines?: string[];
}
```

- [ ] **Step 2: 체크리스트에 옵션 항목 추가**

`REPAIR_SYSTEM`의 `4. Keep all valid content...` 줄 **뒤에** 추가:

```
5. 옵션 편중(option_coverage) 이슈가 있으면 imageSlots[].imageRef를 재배정해 옵션을 고르게 만든다. 단 섹션 내용과 옵션이 충돌하면 내용을 우선하고 다른 섹션에서 균형을 맞춘다. 비교 섹션(option_compare)은 옵션당 imageSlot 1개를 유지한다.
```

- [ ] **Step 3: userPrompt에 옵션 줄 삽입**

`repair-pro-layout.ts:41-47`의 `userPrompt` 배열에서 `Key points` 줄 **뒤에** 한 항목 추가:

```ts
  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0 ? `Key points:\n${productInfo.points.map((p) => `- ${p}`).join('\n')}` : '',
    productInfo.optionLines && productInfo.optionLines.length > 0
      ? `옵션(색상/모델): ${productInfo.optionLines.join(', ')}`
      : '',
    `ISSUES:\n${issuesText}`,
    `CURRENT LAYOUT JSON:\n${JSON.stringify(sections)}`,
  ].filter(Boolean).join('\n\n');
```

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: `repair-pro-layout.ts` 관련 오류 없음 (선재 오류는 무시)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/repair-pro-layout.ts
git commit -m "feat(pro): repair 프롬프트에 옵션 컨텍스트 전달"
```

---

## Task 5: 시스템 프롬프트 — D1 교체, C4 강화, D3 신규

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/system-prompt.ts`

- [ ] **Step 1: C4 교체**

`system-prompt.ts:52`의 기존 C4 한 줄을 찾아 교체한다.

찾을 문자열:
```
C4. stat_row에는 진짜 임팩트 수치만. "색상 2종" 같은 무의미한 값은 stat_row가 아니라 option_grid로 표현하세요.
```

교체:
```
C4. stat_row에는 실측 가능한 크기·무게·용량·시간·온도·비율만 넣으세요. 다음은 금지: (a) 값이 0이거나 "없음/무"인 항목 — 예: "소매 길이 0cm". 없다는 사실은 bullet_list로 말하세요("소매가 없어 겨드랑이 땀 자국이 남지 않음"). (b) 옵션·구성의 개수 — 예: "4단계 사이즈", "색상 2종", "3가지 구성"은 option_grid로.
```

- [ ] **Step 2: D1 교체**

찾을 문자열 (`:56`):
```
D1. 색상 내러티브: 대표 색상 1개를 정해 히어로·소재·착용 섹션은 그 색상 이미지만 쓰고, 두 색이 함께 나오는 곳은 컬러 비교 option_grid 단 한 곳으로 제한하세요.
```

교체:
```
D1. 옵션 내러티브: 옵션(색상·모델)이 2개 이상 제공되면 —
    (a) 옵션 비교 섹션을 정확히 1개 포함하세요. option_grid items를 옵션 수만큼 만들고, imageSlots도 같은 수로 선언해 각 슬롯의 imageRef를 해당 옵션 이미지로 지정합니다.
    (b) 나머지 이미지 섹션은 옵션을 돌려쓰세요. 비교 섹션 밖 이미지 슬롯에서 모든 옵션이 최소 1회 등장해야 하고, 가장 많이 쓴 옵션과 가장 적게 쓴 옵션의 횟수 차이가 1을 넘으면 안 됩니다.
    (c) 모든 이미지 슬롯에 imageRef를 반드시 명시하세요. 생략하면 어느 옵션인지 판정할 수 없습니다.
    (d) 섹션 내용이 옵션과 충돌하면 내용을 우선하세요. 예: "블랙 등판 로고" 섹션엔 블랙 이미지를 쓰고, 균형은 다른 섹션에서 맞춥니다.
    (e) 카피에 옵션명을 억지로 넣지 마세요. 그 섹션에서 실제로 그 옵션을 보여줄 때만 언급합니다.
    옵션이 1개 이하면 이 규칙은 무시하고 제품 이미지를 내용에 맞게 배정하세요.
```

- [ ] **Step 3: D3 추가**

`D2.` 줄 (`:57`, "텍스트만 있는 섹션을 2개 연속 배치하지 마세요…") **뒤에** 추가:

```
D3. 긍정 원칙: 인물이 등장하는 씬의 promptHint는 제품을 쓰는 즐거움·성취·편안함이 드러나야 합니다. 지침·통증·불편·좌절·땀에 지친 표정, 무릎을 짚거나 주저앉은 자세, 찡그린 표정을 쓰지 마세요. 문제 상황은 이미지가 아니라 카피로 말합니다. 예외: 비교 대상(타사 제품·기존 방식·개선 전)의 단점을 드러내는 표현. 우리 제품을 착용·사용하는 인물은 예외 없이 긍정적입니다.
```

- [ ] **Step 4: 확인**

Run: `grep -c "D1\. 옵션 내러티브\|D3\. 긍정 원칙\|C4\. stat_row에는 실측" src/app/api/ai/generate-pro-layout/system-prompt.ts`
Expected: `3`

Run: `grep -c "대표 색상 1개" src/app/api/ai/generate-pro-layout/system-prompt.ts`
Expected: `0`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/system-prompt.ts
git commit -m "feat(pro): D1 옵션 고른 노출 규칙, C4 지표 강화, D3 긍정 원칙"
```

---

## Task 6: generate-pro-layout 라우트 결선

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`
- Test: `src/__tests__/api/generate-pro-layout.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/generate-pro-layout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
const callClaudeVisionMock = vi.fn();

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
  callClaudeVision: (...args: unknown[]) => callClaudeVisionMock(...args),
}));
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('k'),
}));
vi.mock('@/lib/ai/repair-pro-layout', () => ({
  repairProLayout: vi.fn(async (s: unknown[]) => s),
}));

import { POST } from '@/app/api/ai/generate-pro-layout/route';

/** 옵션 균형이 맞는 유효 레이아웃 (비교 1 + 화이트 2 / 블랙 2) */
function validLayout(): unknown[] {
  const img = (title: string, ref: number) => ({
    type: 'claude_layout',
    title,
    blocks: [{ type: 'heading', text: title, size: 'xl' }, { type: 'image', attachedIndex: 0 }],
    imageSlots: [{ slotType: 'flux_lifestyle', promptHint: 'h', imageRef: ref }],
  });
  return [
    img('히어로', 0),
    img('소재', 1),
    {
      type: 'claude_layout',
      title: '컬러',
      blocks: [
        { type: 'option_grid', items: [{ label: '화이트' }, { label: '블랙' }] },
        { type: 'image', attachedIndex: 0 },
        { type: 'image', attachedIndex: 1 },
      ],
      imageSlots: [
        { slotType: 'product_nukki', imageRef: 0 },
        { slotType: 'product_nukki', imageRef: 1 },
      ],
    },
    img('디테일', 0),
    img('활용', 1),
    { type: 'claude_layout', title: '안내', blocks: [{ type: 'heading', text: '안내', size: 'xl' }] },
  ];
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/generate-pro-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-pro-layout', () => {
  beforeEach(() => {
    callClaudeMock.mockReset();
    callClaudeVisionMock.mockReset();
    callClaudeMock.mockResolvedValue(JSON.stringify(validLayout()));
  });

  it('productOptions를 주면 유저 프롬프트에 옵션 매핑이 들어간다', async () => {
    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
      productOptions: [
        { name: '화이트', imageIndex: 0 },
        { name: '블랙', imageIndex: 1 },
      ],
    }) as never);

    expect(res.status).toBe(200);
    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).toContain('옵션(색상/모델)');
    expect(userPrompt).toContain('이미지 0 = "화이트"');
    expect(userPrompt).toContain('이미지 1 = "블랙"');
  });

  it('productOptions가 없으면 옵션 줄이 없다', async () => {
    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).not.toContain('옵션(색상/모델)');
  });

  it('옵션이 1개면 옵션 줄을 넣지 않는다', async () => {
    await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
      productOptions: [{ name: '화이트', imageIndex: 0 }],
    }) as never);

    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).not.toContain('옵션(색상/모델)');
  });

  it('stat_row의 0값 치수 항목이 응답에서 제거된다', async () => {
    const layout = validLayout();
    (layout[0] as { blocks: unknown[] }).blocks.push({
      type: 'stat_row',
      items: [
        { label: '소매 길이', value: '0', unit: 'cm' },
        { label: '가슴둘레', value: '95~110', unit: 'cm' },
        { label: '무게', value: '180', unit: 'g' },
      ],
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    const json = await res.json() as { sections: Array<{ blocks: Array<{ type: string; items?: Array<{ label: string }> }> }> };
    const stat = json.sections[0]!.blocks.find((b) => b.type === 'stat_row');
    expect(stat!.items!.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/api/generate-pro-layout.test.ts`
Expected: FAIL — `productOptions`가 스키마에 없어 프롬프트에 반영되지 않는다

- [ ] **Step 3: 요청 스키마에 productOptions 추가**

`route.ts`의 `RequestSchema`에서 `productImages` 항목 **뒤에** 추가:

```ts
  // 이미지에 붙은 옵션명. 이름이 붙은 이미지마다 한 항목(중복 허용).
  productOptions: z
    .array(z.object({
      name: z.string().min(1).max(40),
      imageIndex: z.number().int().min(0).max(3),
    }))
    .max(4)
    .default([]),
```

- [ ] **Step 4: 옵션 파생값과 프롬프트 결선**

`route.ts` 상단 import에 추가:

```ts
import {
  uniqueOptionNames,
  isOptionMode,
  optionNameByImageIndex,
  type ProductOption,
} from '@/lib/detail-page/product-options';
```

`const { productInfo, analyzedSections, productImageCount, productImages } = parsed.data;`를 교체:

```ts
  const { productInfo, analyzedSections, productImageCount, productImages, productOptions } = parsed.data;

  const options: ProductOption[] = productOptions;
  const optionMode = isOptionMode(options);
  const optionLines = optionMode
    ? options.map((o) => `이미지 ${o.imageIndex} = "${o.name}"`)
    : [];
  const layoutOpts = optionMode
    ? { statHygiene: true, optionNameByImageIndex: optionNameByImageIndex(options) }
    : { statHygiene: true };
```

`userPrompt` 배열에서 `imageCount > 0 ? … : ''` 항목 **뒤에** 추가:

```ts
    optionLines.length > 0
      ? `옵션(색상/모델): ${optionLines.join(', ')}\n` +
        `옵션 비교 섹션을 정확히 1개 만들고, 나머지 이미지 섹션에는 ${uniqueOptionNames(options).join('·')}를 고르게 배분하세요. 모든 imageSlot에 imageRef를 명시하세요.`
      : '',
```

- [ ] **Step 5: 정화·검증·수리 호출 교체**

`route.ts:157-168`의 블록을 교체:

```ts
    // 결정론적 정화(CJK 제거 + stat 위생 + 무효/빈 블록 prune + 중복 제거)
    let cleaned = sanitizeProLayout(sections, layoutOpts).sections;
    // error-severity 위반이 남으면 Claude로 1-pass 수리 후 재정화 (조건부)
    const { violations, isClean } = validateProLayout(cleaned, layoutOpts);
    if (!isClean) {
      console.warn('[generate-pro-layout] 위반 발견, repair 실행:', violations.length);
      const repaired = await repairProLayout(cleaned, violations, {
        name: productInfo.name,
        points: productInfo.points,
        category: productInfo.category,
        optionLines: optionLines.length > 0 ? optionLines : undefined,
      });
      cleaned = sanitizeProLayout(repaired, layoutOpts).sections;

      // 재정화 후에도 남으면 경고만 남기고 결과를 준다 — 루프를 만들지 않는다.
      const after = validateProLayout(cleaned, layoutOpts);
      if (!after.isClean) {
        console.warn(
          '[generate-pro-layout] repair 후에도 위반 잔존:',
          after.violations.filter((v) => v.severity === 'error').map((v) => `${v.code}: ${v.message}`),
        );
      }
    }
    return NextResponse.json({ success: true, sections: cleaned });
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/generate-pro-layout.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/route.ts src/__tests__/api/generate-pro-layout.test.ts
git commit -m "feat(pro): generate-pro-layout에 productOptions 결선"
```

---

## Task 7: 워터마크 자동 제거 코드 철거

**Files:**
- Modify: `src/app/api/listing/upload-image/route.ts`
- Modify: `src/app/api/image/upload-ai/route.ts`
- Modify: `src/app/api/ai/generate-detail-html/route.ts`
- Delete: `src/lib/image/watermark-removal.ts`
- Delete: `src/__tests__/lib/watermark-removal.test.ts`

**근거:** 정답을 아는 이미지 6장 실측에서 TP 2 / FP 3 / FN 1 / TN 0 (특이도 0%). 이 정확도로 자동 인페인팅을 유지하면 깨끗한 제품 사진을 소리 없이 덧칠한다. 설계 문서 §7.1 참조.

- [ ] **Step 1: 호출부 3곳 확인**

Run: `grep -rn "removeGeminiWatermark\|hasWatermarkCandidate" --include="*.ts" src | grep -v " 2.ts"`
Expected: import 3줄 + 호출 3줄 + 모듈 정의 + 테스트 import

- [ ] **Step 2: `upload-ai` 호출 제거**

`src/app/api/image/upload-ai/route.ts`에서 import 줄 삭제:

```ts
import { removeGeminiWatermark } from '@/lib/image/watermark-removal';
```

그리고 아래 두 줄 삭제:

```ts
    // 워터마크 제거 (STABILITY_API_KEY 미설정 시 원본 반환)
    buffer = await removeGeminiWatermark(buffer);
```

`buffer`는 이후 그대로 쓰이므로 `let buffer: Buffer;` 선언은 유지한다.

- [ ] **Step 3: `upload-image` 호출 제거**

`src/app/api/listing/upload-image/route.ts`에서 import 줄과 호출부를 삭제한다. 호출부 주석은 `// Gemini 워터마크 제거 (감지된 경우에만 API 호출)`로 시작한다.

- [ ] **Step 4: `generate-detail-html` 호출 제거**

`src/app/api/ai/generate-detail-html/route.ts`에서 import 줄(`:35`)과 호출부(`:204` 부근, 주석 `// Gemini 워터마크 제거 (STABILITY_API_KEY 미설정 시 원본 반환)`)를 삭제한다.

- [ ] **Step 5: 모듈과 테스트 삭제**

```bash
git rm src/lib/image/watermark-removal.ts src/__tests__/lib/watermark-removal.test.ts
```

- [ ] **Step 6: 잔여 참조가 없는지 확인**

Run: `grep -rn "watermark-removal\|removeGeminiWatermark\|hasWatermarkCandidate" --include="*.ts" --include="*.tsx" src | grep -v " 2.ts"`
Expected: 출력 없음

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "watermark" | head`
Expected: 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add -A src/app/api/listing/upload-image/route.ts src/app/api/image/upload-ai/route.ts src/app/api/ai/generate-detail-html/route.ts src/lib/image/watermark-removal.ts src/__tests__/lib/watermark-removal.test.ts
git commit -m "refactor: 워터마크 자동 감지 철거 (실측 특이도 0%)"
```

---

## Task 8: remove-watermark-region에 base64 입력 분기

**Files:**
- Modify: `src/app/api/ai/remove-watermark-region/route.ts`
- Test: `src/__tests__/api/ai/remove-watermark-region.test.ts` (신규)

- [ ] **Step 1: 현재 입력 검증부 읽기**

Run: `sed -n '44,80p' src/app/api/ai/remove-watermark-region/route.ts`

`imageUrl`이 Supabase URL이 아니면 403, `region`이 없으면 400을 내는 구조를 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`src/__tests__/api/ai/remove-watermark-region.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('k'),
}));
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: generateContentMock } }),
}));

import sharp from 'sharp';
import { POST } from '@/app/api/ai/remove-watermark-region/route';

async function pngBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
  }).png().toBuffer();
  return buf.toString('base64');
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/remove-watermark-region', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REGION = { x: 0.7, y: 0.8, width: 0.2, height: 0.15 };

describe('POST /api/ai/remove-watermark-region', () => {
  beforeEach(async () => {
    generateContentMock.mockReset();
    const clean = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 210, g: 210, b: 210 } },
    }).png().toBuffer();
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: clean.toString('base64'), mimeType: 'image/png' } }] } }],
    });
  });

  it('imageBase64로 호출하면 처리된다', async () => {
    const res = await POST(request({
      imageBase64: await pngBase64(),
      mimeType: 'image/png',
      region: REGION,
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { imageBase64?: string };
    expect(json.imageBase64).toBeTruthy();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('imageUrl 분기의 SSRF 검사는 그대로 유지된다', async () => {
    const res = await POST(request({
      imageUrl: 'https://evil.example.com/a.jpg',
      region: REGION,
    }) as never);

    expect(res.status).toBe(403);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('imageUrl도 imageBase64도 없으면 400', async () => {
    const res = await POST(request({ region: REGION }) as never);
    expect(res.status).toBe(400);
  });

  it('region이 없으면 400', async () => {
    const res = await POST(request({
      imageBase64: await pngBase64(),
      mimeType: 'image/png',
    }) as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run src/__tests__/api/ai/remove-watermark-region.test.ts`
Expected: FAIL — `imageBase64` 분기가 없어 403

- [ ] **Step 4: 입력 분기 구현**

`route.ts`에서 아래 블록을 찾는다:

```ts
  const { imageUrl, region } = (body ?? {}) as Record<string, unknown>;

  if (typeof imageUrl !== 'string' || !SUPABASE_PATTERN.test(imageUrl)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }
```

교체:

```ts
  const { imageUrl, imageBase64, mimeType, region } = (body ?? {}) as Record<string, unknown>;

  // 입력은 Supabase URL 또는 클라이언트가 보낸 base64 둘 중 하나.
  // SSRF 방어는 URL 분기에만 필요하다 — base64는 서버가 외부를 호출하지 않는다.
  const hasBase64 = typeof imageBase64 === 'string' && imageBase64.length > 0;
  const hasUrl = typeof imageUrl === 'string' && imageUrl.length > 0;

  if (!hasBase64 && !hasUrl) {
    return NextResponse.json({ error: 'imageUrl 또는 imageBase64가 필요합니다.' }, { status: 400 });
  }
  if (!hasBase64 && !SUPABASE_PATTERN.test(imageUrl as string)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }
```

이어서 `try {` 블록 맨 앞의 fetch 구간을 교체한다. 현재 코드:

```ts
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) {
      return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();

    if (arrayBuffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지 크기가 너무 큽니다.' }, { status: 413 });
    }

    let img = sharp(Buffer.from(arrayBuffer)).rotate();
```

교체:

```ts
  try {
    let sourceBuffer: Buffer;
    if (hasBase64) {
      const raw = imageBase64 as string;
      sourceBuffer = Buffer.from(raw.includes(';base64,') ? raw.split(';base64,')[1]! : raw, 'base64');
    } else {
      const imgRes = await fetch(imageUrl as string, { signal: AbortSignal.timeout(15_000) });
      if (!imgRes.ok) {
        return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
      }
      sourceBuffer = Buffer.from(await imgRes.arrayBuffer());
    }

    if (sourceBuffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지 크기가 너무 큽니다.' }, { status: 413 });
    }

    let img = sharp(sourceBuffer).rotate();
```

이후 코드(`MAX_DIM` 리사이즈, crop, Gemini 호출, 합성)는 `img`만 쓰므로 그대로 둔다. 요청의 `mimeType`은 별도 검증하지 않는다 — sharp가 실제 포맷을 판별하고, 응답 `mimeType`은 기존 로직이 정한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/ai/remove-watermark-region.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/remove-watermark-region/route.ts src/__tests__/api/ai/remove-watermark-region.test.ts
git commit -m "feat: remove-watermark-region에 base64 입력 분기"
```

---

## Task 9: ImageCleanupModal base64 입출력

**Files:**
- Modify: `src/components/common/ImageCleanupModal.tsx`

테스트 없음 — optional prop 추가이며 기존 호출부 동작이 바뀌지 않는다. Task 12의 수동 확인이 덮는다.

- [ ] **Step 1: props 확장**

`ImageCleanupModal.tsx:5-12`의 인터페이스를 교체:

```ts
interface ImageCleanupModalProps {
  /** 표시용 이미지. blob: URL 허용 */
  imageUrl: string;
  /** 있으면 API 호출에 imageUrl 대신 사용 (업로드 전 File 대응) */
  imageBase64?: string;
  mimeType?: string;
  onReplace: (newUrl: string) => void;
  /** 있으면 Storage 업로드를 건너뛰고 결과 base64를 그대로 넘긴다 */
  onResultBase64?: (base64: string, mimeType: string) => void;
  onAdd: (newUrl: string) => void;
  onClose: () => void;
  canAdd: boolean;
  mode?: 'chinese' | 'watermark';
}
```

구조분해에도 추가:

```ts
export default function ImageCleanupModal({
  imageUrl,
  imageBase64,
  mimeType,
  onReplace,
  onResultBase64,
  onAdd,
  onClose,
  canAdd,
  mode = 'chinese',
}: ImageCleanupModalProps) {
```

- [ ] **Step 2: API 호출에 base64 우선 사용**

`handleExecute`의 `body` 조립(`:94`)을 교체:

```ts
        body: JSON.stringify(
          imageBase64
            ? { imageBase64, mimeType: mimeType ?? 'image/jpeg', region: selection }
            : { imageUrl, region: selection },
        ),
```

- [ ] **Step 3: 결과 반환에 콜백 우선 사용**

`handleReplace`(`:122`)를 교체:

```ts
  async function handleReplace() {
    if (onResultBase64 && resultBase64) {
      onResultBase64(resultBase64, resultMime);
      return;
    }
    setIsUploading(true);
    try {
      const url = await uploadResult();
      onReplace(url);
    } catch {
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setIsUploading(false);
    }
  }
```

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ImageCleanupModal" | head`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/common/ImageCleanupModal.tsx
git commit -m "feat: ImageCleanupModal base64 입출력 지원 (업로드 전 File 대응)"
```

---

## Task 10: 씬 프롬프트 중복 상수 제거 (선결 리팩터)

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`

**왜 먼저 하나:** `PRODUCT_FIDELITY_INSTRUCTION`(`:65`)과 동일한 문자열이 `SCENE_PROMPT_SYSTEM`(`:55`)에 하드코딩돼 있고, `:510`이 그 상수로 `replace` 스트립을 한다. 상수만 고치면 매칭이 실패해 배경 프롬프트에 제품 지시가 남고 **배경에 제품이 그려지는 회귀**가 난다.

- [ ] **Step 1: 상수 선언을 위로 이동**

`PRODUCT_FIDELITY_INSTRUCTION` 선언(`:65`)을 잘라내어 `SCENE_PROMPT_SYSTEM` 선언(`:44`) **바로 위**에 붙인다. 내용은 그대로 둔다.

- [ ] **Step 2: SCENE_PROMPT_SYSTEM의 내장 사본을 보간으로 교체**

`SCENE_PROMPT_SYSTEM` 안의 아래 줄을 찾는다 (`- CRITICAL: The generated prompt MUST end with this exact instruction: "` 로 시작하고 `...composite image compositions."` 로 끝나는 한 줄):

교체:

```
- CRITICAL: The generated prompt MUST end with this exact instruction: "${PRODUCT_FIDELITY_INSTRUCTION}"
```

- [ ] **Step 3: 스트립이 여전히 동작하는지 확인**

Run: `node -e "const s=require('fs').readFileSync('src/app/api/ai/generate-scene-image/route.ts','utf8'); const m=s.match(/const PRODUCT_FIDELITY_INSTRUCTION = \`([^\`]+)\`/); console.log('상수 길이:', m[1].length); console.log('SCENE_PROMPT_SYSTEM 내 보간:', s.includes('exact instruction: \"\${PRODUCT_FIDELITY_INSTRUCTION}\"'));"`
Expected: `상수 길이:` 양수, `SCENE_PROMPT_SYSTEM 내 보간: true`

Run: `grep -c "as an independent creative work" src/app/api/ai/generate-scene-image/route.ts`
Expected: `1` (사본이 사라져 상수 정의 한 곳에만 남음)

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "generate-scene-image" | head`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/route.ts
git commit -m "refactor(scene): PRODUCT_FIDELITY_INSTRUCTION 중복 사본 제거"
```

---

## Task 11: 씬 프롬프트 — 스파클 금지 + 긍정 감정

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`

- [ ] **Step 1: PRODUCT_FIDELITY_INSTRUCTION에 두 규칙 추가**

상수 문자열 끝(`...composite image compositions.` 뒤)에 이어 붙인다:

```
 NO SPARKLE MARKS: Do NOT render any four-pointed star, sparkle, glitter, or diamond glyph anywhere in the image — not on the garment, product surface, or background. If such a mark appears in the reference image, treat it as an artifact and omit it. POSITIVE SUBJECT: If a person appears, they must look confident, comfortable, and at ease — relaxed or lightly positive expression, upright active posture. No grimacing, exhaustion, hunching over, hands on knees, slumping, distress, or discomfort.
```

Task 10에서 보간으로 바꿨으므로 이 한 번의 수정이 `SCENE_PROMPT_SYSTEM`과 `:453` 폴백 경로에 동시에 반영되고, `:510`의 스트립도 계속 정확히 매칭된다.

- [ ] **Step 2: SCENE_PROMPT_SYSTEM Rules에 한 줄 추가**

`- Do NOT include any text, logos, watermarks, or price tags in the scene description` **뒤에** 추가:

```
- Do NOT describe any four-pointed star, sparkle, or glitter mark on the product or background. If a person appears, describe a confident, comfortable, energetic subject — never fatigue, strain, or discomfort.
```

- [ ] **Step 3: BACKGROUND_PROMPT_SYSTEM에 sparkle 추가**

`- Photorealistic commercial photography only. No text, logos, watermarks, split panels, or collages.`를 교체:

```
- Photorealistic commercial photography only. No text, logos, watermarks, sparkles, four-pointed stars, split panels, or collages.
```

- [ ] **Step 4: 확인**

Run: `grep -c "four-pointed star" src/app/api/ai/generate-scene-image/route.ts`
Expected: `3`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/route.ts
git commit -m "feat(scene): 스파클 글리프 금지 + 인물 긍정 감정 규칙"
```

---

## Task 12: PRO 화면 — 옵션명 입력 + ✦ 버튼

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: import와 상태 추가**

파일 상단 import에 추가:

```ts
import ImageCleanupModal from '@/components/common/ImageCleanupModal';
import { deriveOptions, isOptionMode } from '@/lib/detail-page/product-options';
```

`const [productImages, setProductImages] = useState<File[]>([]);` **뒤에** 추가:

```ts
  const [optionNames, setOptionNames] = useState<string[]>([]);
  const [cleanupTarget, setCleanupTarget] = useState<{
    index: number; url: string; base64: string; mimeType: string;
  } | null>(null);
```

- [ ] **Step 2: 이미지 상태 변경 3곳에 optionNames 동기화**

추가 input의 `onChange`(`setProductImages(prev => [...prev, ...newFiles].slice(0, 4));`)를 교체:

```ts
              const newFiles = Array.from(e.target.files ?? []);
              setProductImages(prev => [...prev, ...newFiles].slice(0, 4));
              setOptionNames(prev => [...prev, ...newFiles.map(() => '')].slice(0, 4));
              e.target.value = '';
```

교체 input의 `onChange`를 교체:

```ts
            onChange={e => {
              const files = Array.from(e.target.files ?? []).slice(0, 4);
              setProductImages(files);
              setOptionNames(files.map(() => ''));
              e.target.value = '';
            }}
```

삭제 버튼의 `onClick`을 교체:

```ts
                      onClick={e => {
                        e.stopPropagation();
                        setProductImages(prev => prev.filter((_, i) => i !== idx));
                        setOptionNames(prev => prev.filter((_, i) => i !== idx));
                      }}
```

- [ ] **Step 3: 썸네일에 ✦ 버튼 추가**

`prodPreviews.map((url, idx) => (...))` 안, × 버튼 **뒤에** 추가:

```tsx
                    <button
                      type="button"
                      title="워터마크 제거"
                      onClick={async e => {
                        e.stopPropagation();
                        const file = productImages[idx];
                        if (!file) return;
                        const { base64, mimeType } = await fileToDownscaledBase64(file, 2000);
                        setCleanupTarget({ index: idx, url, base64, mimeType });
                      }}
                      style={{
                        position: 'absolute', top: 3, left: 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.65)', border: 'none',
                        color: '#fff', fontSize: 10, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >✦</button>
```

- [ ] **Step 4: 옵션명 입력칸 추가**

`prodPreviews` 그리드 `</div>` 바로 뒤(추가/교체 버튼 줄 **앞**)에 삽입:

```tsx
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
                {prodPreviews.map((_, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={optionNames[idx] ?? ''}
                    onChange={e => {
                      const v = e.target.value.slice(0, 40);
                      setOptionNames(prev => {
                        const next = [...prev];
                        while (next.length <= idx) next.push('');
                        next[idx] = v;
                        return next;
                      });
                    }}
                    placeholder="옵션명"
                    style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px' }}
                  />
                ))}
              </div>
              <p style={{ fontSize: '11px', color: '#6b7280', margin: '0 0 8px' }}>
                옵션명을 2개 이상 적으면 옵션별로 고르게 노출되는 상세페이지가 만들어집니다. (선택)
              </p>
```

- [ ] **Step 5: 모달 렌더링**

업로드 화면 `return`의 `{lightbox && (...)}` 블록 **뒤에** 추가:

```tsx
        {cleanupTarget && (
          <ImageCleanupModal
            mode="watermark"
            imageUrl={cleanupTarget.url}
            imageBase64={cleanupTarget.base64}
            mimeType={cleanupTarget.mimeType}
            canAdd={false}
            onReplace={() => setCleanupTarget(null)}
            onAdd={() => setCleanupTarget(null)}
            onClose={() => setCleanupTarget(null)}
            onResultBase64={(base64, mime) => {
              const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              const ext = mime === 'image/png' ? 'png' : 'jpg';
              const file = new File([bytes], `cleaned-${cleanupTarget.index}.${ext}`, { type: mime });
              setProductImages(prev => prev.map((f, i) => (i === cleanupTarget.index ? file : f)));
              setCleanupTarget(null);
            }}
          />
        )}
```

`optionNames`는 인덱스 기준이라 교체해도 그대로 유지된다.

- [ ] **Step 6: fileToDownscaledBase64에 최대 변 인자 전달 확인**

기존 시그니처가 `(file: File, max = 512)`이므로 `fileToDownscaledBase64(file, 2000)` 호출이 그대로 동작한다.

Run: `grep -n "const fileToDownscaledBase64 = async" -A 2 "src/app/listing/[id]/detail-maker-pro/page.tsx"`
Expected: `max = 512` 기본값이 있는 시그니처

- [ ] **Step 7: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "detail-maker-pro" | head`
Expected: 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(pro): 이미지별 옵션명 입력 + 워터마크 수동 제거 버튼"
```

---

## Task 13: PRO 화면 — 업로드 자리 유지 (인덱스 시프트 수정)

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

**왜 필요한가:** `imageRef`는 업로드 **전** `productImages` 인덱스 기준인데, 현재 `uploadedImageUrls`는 실패 건을 filter로 제거해 인덱스가 당겨진다. 화이트 업로드가 실패하면 화이트 슬롯에 블랙이 들어간다. 지금도 잠재 버그지만 옵션 기능이 이를 기능 실패로 승격시킨다.

- [ ] **Step 0: 현재 구조 확인**

Run: `grep -n "uploadedImageUrls\|effectiveProductUrls\|productImageUrls" "src/app/listing/[id]/detail-maker-pro/page.tsx"`

기대 구조(2026-07-25 `8ce88538` 기준):

```ts
let uploadedImageUrls: string[] = [];                       // 업로드 결과, 실패분 filter로 제거됨
const effectiveProductUrls = uploadedImageUrls.length > 0    // 재개 시 저장된 URL로 폴백
  ? uploadedImageUrls : productImageUrls;
```

구조가 다르면 아래 코드를 현재 변수명에 맞춰 조정한다.

- [ ] **Step 1: 업로드 결과를 자리 유지로 변경**

선언을 교체:

```ts
            let uploadedImageUrls: (string | null)[] = [];
```

`.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')` 와 `.map((r) => r.value);` 두 줄을 한 줄로 교체:

```ts
                // 자리 유지 — imageRef는 업로드 전 productImages 인덱스 기준이라
                // 실패분을 당겨내면 화이트 슬롯에 블랙이 들어간다.
                .map((r) => (r.status === 'fulfilled' ? r.value : null));
```

`effectiveProductUrls` 선언에 타입을 명시:

```ts
            const effectiveProductUrls: (string | null)[] =
              uploadedImageUrls.length > 0 ? uploadedImageUrls : productImageUrls;
```

- [ ] **Step 2: 부분 실패 경고**

`effectiveProductUrls` 선언 **뒤에** 추가:

```ts
            if (uploadedImageUrls.some((u) => u === null) && isOptionMode(deriveOptions(optionNames))) {
              setError('일부 이미지 업로드에 실패했습니다. 옵션 배분이 정확하지 않을 수 있습니다.');
            }
```

- [ ] **Step 3: 씬 참조 선택을 옵션 인식으로 교체**

`await Promise.allSettled(genItems.map(async ({ s, i }) => {` 안의 `const refImages = ...` 블록(현재 `typeof slot?.imageRef === 'number' && effectiveProductUrls[slot.imageRef] ? [...] : effectiveProductUrls.slice(0, 2)`)을 교체:

```ts
                    // 옵션 모드에선 다른 옵션 사진이 섞이면 Gemini가 색을 섞는다 →
                    // imageRef가 가리키는 1장만(같은 옵션명이면 최대 2장) 보낸다.
                    const options = deriveOptions(optionNames);
                    const optionMode = isOptionMode(options);
                    const nameByIdx = new Map(options.map(o => [o.imageIndex, o.name]));
                    const ref = typeof slot?.imageRef === 'number' ? slot.imageRef : null;
                    const primary = ref !== null ? effectiveProductUrls[ref] ?? null : null;

                    let refImages: string[];
                    if (optionMode) {
                      if (!primary || ref === null) return; // 해당 옵션 이미지가 없으면 이 슬롯은 건너뛴다
                      const refName = nameByIdx.get(ref);
                      const sameOption = effectiveProductUrls
                        .map((u, idx) => ({ u, idx }))
                        .filter(({ u, idx }) => !!u && idx !== ref && nameByIdx.get(idx) === refName)
                        .map(({ u }) => u as string);
                      refImages = [primary, ...sameOption].slice(0, 2);
                    } else {
                      const available = effectiveProductUrls.filter((u): u is string => !!u);
                      refImages = primary ? [primary, ...available].slice(0, 2) : available.slice(0, 2);
                    }
                    if (refImages.length === 0) return;
```

- [ ] **Step 4: sceneHint에 옵션명 부착 + 600자 절단**

`sceneHint: slot?.promptHint,`를 교체:

```ts
                        // zod가 600자로 제한한다(generate-scene-image/route.ts:35).
                        // 넘기면 400이 나고 아래 catch가 삼켜 이 섹션 이미지만 조용히 사라진다.
                        sceneHint: (() => {
                          const optionName = ref !== null ? nameByIdx.get(ref) : undefined;
                          const base = slot?.promptHint ?? '';
                          const withOption = optionName ? `${base} (제품 색상: ${optionName})` : base;
                          return withOption.slice(0, 600);
                        })(),
```

- [ ] **Step 5: 섹션 조립부는 그대로 둔다 (확인만)**

`attachedImages`의 `chosen`은 이미 `?? undefined`로 받고 `url`이 `chosen ?? ''`가 되며, 마지막에 `.filter(item => item.url)`이 빈 문자열을 걷어낸다. `null`이 들어와도 안전하다.

Run: `grep -n "const chosen" -A 8 "src/app/listing/[id]/detail-maker-pro/page.tsx"`
Expected: `.filter(item => item.url)`가 보인다 — 보이지 않으면 추가한다.

또한 `refIdx % effectiveProductUrls.length` 로테이션은 자리 유지 덕에 인덱스가 보존되어 오히려 정확해진다.

- [ ] **Step 6: sessionStorage 저장에서 null 제거**

`sessionStorage.setItem('pro_meta', ...)` 줄의 `uploadedImageUrls: effectiveProductUrls`를 교체:

```ts
              uploadedImageUrls: effectiveProductUrls.filter((u): u is string => !!u),
```

재개용 저장값은 `string[]` 계약이다. 재개 시에는 `productImages`(File)가 없어 옵션 매핑이 어차피 근사이므로 여기서는 null을 걷어낸다.

- [ ] **Step 6: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "detail-maker-pro" | head`
Expected: 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "fix(pro): 업로드 부분 실패 시 인덱스 자리 유지 + 옵션별 씬 참조"
```

---

## Task 14: PRO 화면 — 레이아웃 생성에 productOptions 전달

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: handleGenerate의 요청 바디에 추가**

`body: JSON.stringify({ ... })` 안, `productImages: productImagePayload,` **뒤에** 추가:

```ts
          productOptions: deriveOptions(optionNames),
```

- [ ] **Step 2: useCallback 의존성 배열에 추가**

`handleGenerate`의 의존성 배열을 교체:

```ts
  }, [isGenerating, productName, productPoints, editedSections, productImages, optionNames]);
```

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "detail-maker-pro" | head`
Expected: 출력 없음

- [ ] **Step 4: 전체 관련 테스트 실행**

Run:
```bash
npx vitest run \
  src/__tests__/lib/detail-page/product-options.test.ts \
  src/__tests__/lib/detail-page/layout-validator.test.ts \
  src/__tests__/api/generate-pro-layout.test.ts \
  src/__tests__/api/ai/remove-watermark-region.test.ts
```
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx"
git commit -m "feat(pro): 레이아웃 생성 요청에 productOptions 전달"
```

---

## Task 15: 수동 검증

**Files:** 없음 (실행 확인)

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev`

- [ ] **Step 2: 옵션 모드 시나리오**

`/listing/<id>/detail-maker-pro`에서:

1. 상품명 입력, 참고 스크린샷 1장 업로드
2. 제품 이미지 2장 업로드 후 옵션명에 각각 `화이트`, `블랙` 입력
3. 분석 → 생성

확인 항목:
- 옵션 비교 섹션이 정확히 1개 나오는가
- 비교 섹션 밖에서 화이트·블랙이 모두 등장하며 횟수 차이가 1 이하인가
- `stat_row`에 0값 치수나 개수형 항목이 없는가
- 인물 씬이 지치거나 찡그린 표정이 아닌가

- [ ] **Step 3: 서버 로그 확인**

repair가 돌았다면 `[generate-pro-layout] 위반 발견, repair 실행:` 로그가, 그 후에도 남으면 `repair 후에도 위반 잔존:` 로그가 보인다. 후자가 반복되면 D1 프롬프트 문구를 조정한다.

- [ ] **Step 4: 워터마크 수동 제거 시나리오**

제미나이 앱으로 만든 ✦ 있는 이미지를 업로드하고 썸네일의 ✦ 버튼을 눌러 영역을 드래그한다.

확인 항목:
- 모달이 blob URL 이미지를 표시하는가
- 제거 후 "이 이미지로 교체"를 누르면 썸네일이 갱신되는가
- 그 자리의 옵션명이 유지되는가
- 이후 생성한 씬에 ✦가 복제되지 않는가

- [ ] **Step 5: 비옵션 회귀 확인**

옵션명을 아무것도 입력하지 않고 생성해 기존과 동일하게 동작하는지 본다. 옵션 위반 로그가 찍히면 안 된다.

- [ ] **Step 6: 초안 저장·렌더 회귀 확인**

에디터에서 `stat_row`에 "설탕 0g"을 직접 입력하고 저장 후 다시 열어 값이 남아 있는지 확인한다. `statHygiene` 게이트가 동작하면 남는다.

---

## 완료 기준

- [ ] 화이트/블랙 2옵션 생성 시 비교 섹션 1개 + 편차 1 이하
- [ ] `stat_row`에 0값 치수·개수형 항목 없음
- [ ] 에디터에서 손으로 쓴 "설탕 0g"이 저장·렌더 후에도 유지됨
- [ ] 어떤 업로드 경로도 사용자 이미지를 자동 편집하지 않음
- [ ] ✦ 버튼으로 지운 이미지가 레이아웃 생성·씬 참조에 반영됨
- [ ] 인물 씬에 지친 표정·자세가 나오지 않음
- [ ] 옵션명 미입력 시 기존 동작과 동일
