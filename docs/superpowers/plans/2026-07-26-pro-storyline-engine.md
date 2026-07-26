# PRO 스토리라인 엔진 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 상세페이지가 스펙 나열이 아니라 서사 구조를 갖게 하고, 근거 없는 수치가 페이지에 남지 않게 한다.

**Architecture:** 각 섹션에 `beat` 라벨을 부여해 서사를 검증 가능한 형태로 만든다. 검증은 순수 모듈 두 개(`narrative.ts`, `progress-hygiene.ts`)로 분리하고, 기존 `validateProLayout`/`sanitizeProLayout`이 이를 호출한다. 새 검증은 `ProLayoutOpts` 플래그로 감싸 생성 경로에서만 켠다 — 기존 draft·render 경로와 기존 테스트를 보호하기 위해서다.

**Tech Stack:** TypeScript, Zod, Vitest, Next.js App Router

**설계 문서:** `docs/superpowers/specs/2026-07-26-pro-storyline-engine-design.md`

---

## 중요: 테스트 실행 규칙

**인자 없이 `npx vitest run`을 실행하지 말 것.** 이 저장소는 라이브러리 테스트까지 함께 돌아 대량의 선재 실패가 나오며, 회귀 판단이 불가능해진다. **항상 경로를 지정한다:**

```bash
npx vitest run src/__tests__/lib/detail-page/narrative.test.ts
```

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/detail-page/narrative.ts` (생성) | beat 어휘 정의 + 서사 규칙 검증. 순수 함수, 의존성 없음 |
| `src/lib/detail-page/progress-hygiene.ts` (생성) | progress_bar item의 provenance 판정 + 블록 정리. 순수 함수 |
| `src/lib/detail-page/layout-validator.ts` (수정) | 위 두 모듈 결선, `beat` 스키마, `ProLayoutOpts` 플래그 |
| `src/app/api/ai/generate-pro-layout/system-prompt.ts` (수정) | beat 필드 지시, 아크 템플릿, compare 규칙 D4 |
| `src/lib/ai/repair-pro-layout.ts` (수정) | beat 보존 + 순서 재배치 허용 |
| `src/app/api/ai/generate-pro-layout/route.ts` (수정) | 플래그 켜기, provenance 입력 전달, warnings 응답 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` (수정) | 잔존 위반 경고 배너 |

검증 로직을 `layout-validator.ts`에 직접 넣지 않고 두 모듈로 분리하는 이유: 해당 파일이 이미 375줄이 넘고 CJK 처리·스키마·옵션 커버리지·stat 위생을 모두 담당하고 있다. 새 관심사 두 개를 더하면 한 번에 파악하기 어려워진다.

---

## Task 1: narrative 순수 모듈

**Files:**
- Create: `src/lib/detail-page/narrative.ts`
- Test: `src/__tests__/lib/detail-page/narrative.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/lib/detail-page/narrative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkNarrative, BEATS } from '@/lib/detail-page/narrative';

/** beat를 지정한 최소 섹션 */
function sec(beat: string, blocks: unknown[] = [{ type: 'heading', text: 'x', size: 'xl' }]) {
  return { beat, blocks };
}

/** compare 섹션은 columns 2단을 가져야 통과한다 */
function compareSec() {
  return sec('compare', [
    { type: 'columns', cols: [[{ type: 'subtext', text: '기존' }], [{ type: 'subtext', text: '우리' }]] },
  ]);
}

describe('checkNarrative', () => {
  it('규칙을 모두 지킨 레이아웃은 이슈가 없다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('assure')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('beat 필드가 없으면 error', () => {
    const sections = [sec('hook'), { blocks: [] }, compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('beat'))).toBe(true);
  });

  it('알 수 없는 beat 값은 error', () => {
    const sections = [sec('hook'), sec('나열'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('나열'))).toBe(true);
  });

  it('첫 섹션이 hook이 아니면 error', () => {
    const sections = [sec('detail'), sec('hook'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('hook'))).toBe(true);
  });

  it('compare가 하나도 없으면 error', () => {
    const sections = [sec('hook'), sec('detail'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('비교'))).toBe(true);
  });

  it('compare 섹션에 columns 2단이 없으면 error', () => {
    const sections = [sec('hook'), sec('compare'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('columns'))).toBe(true);
  });

  it('cols가 1개뿐인 columns는 compare 구조로 인정하지 않는다', () => {
    const sections = [
      sec('hook'),
      sec('compare', [{ type: 'columns', cols: [[{ type: 'subtext', text: '하나' }]] }]),
      sec('assure'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.message.includes('columns'))).toBe(true);
  });

  it('problem이 있는데 solution이 없으면 error', () => {
    const sections = [sec('hook'), sec('problem'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('solution'))).toBe(true);
  });

  it('problem과 solution이 둘 다 있으면 통과', () => {
    const sections = [sec('hook'), sec('problem'), sec('solution'), compareSec(), sec('assure')];
    expect(checkNarrative(sections).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('assure가 마지막 3섹션 밖에 있으면 warning', () => {
    const sections = [sec('hook'), sec('assure'), compareSec(), sec('detail'), sec('usecase'), sec('option')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('assure'))).toBe(true);
  });

  it('assure가 아예 없어도 warning', () => {
    const sections = [sec('hook'), sec('detail'), compareSec()];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('assure'))).toBe(true);
  });

  it('BEATS는 9종이다', () => {
    expect(BEATS).toHaveLength(9);
  });

  it('빈 배열은 이슈를 만들지 않는다 (다른 검증이 담당)', () => {
    expect(checkNarrative([])).toEqual([]);
  });
});

describe('compare 섹션의 금지 표현', () => {
  /** columns 구조를 갖추되 텍스트만 바꾼 compare 섹션 */
  function compareWithText(text: string) {
    return sec('compare', [
      { type: 'columns', cols: [[{ type: 'subtext', text }], [{ type: 'subtext', text: '우리' }]] },
    ]);
  }

  it('배수 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 3배 빠른 건조'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('배수'))).toBe(true);
  });

  it('퍼센트 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 40% 향상'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('퍼센트'))).toBe(true);
  });

  it('순위 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('업계 1위 흡수력'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('순위'))).toBe(true);
  });

  it('카테고리 상식 비교는 통과', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100%는 땀을 머금어 무거워집니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.message.includes('배수') || i.message.includes('퍼센트') || i.message.includes('순위'))).toBe(false);
  });

  it('compare가 아닌 섹션의 수치 표현은 검사하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      sec('detail', [{ type: 'subtext', text: '3배 두꺼운 원단' }]),
      compareSec(),
      sec('assure'),
    ]);
    expect(issues.some(i => i.message.includes('배수'))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/narrative.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/detail-page/narrative"`

- [ ] **Step 3: 구현한다**

`src/lib/detail-page/narrative.ts`:

```ts
/**
 * 서사(narrative) 검증 — PRO 레이아웃이 스펙 나열이 아니라 아크를 갖는지 본다.
 * 순수 함수만 두고 Violation 변환은 layout-validator가 담당한다.
 */

/** 섹션이 아크에서 맡는 역할. 검증이 참조하는 것은 hook/problem/solution/compare/assure 5종이다. */
export const BEATS = [
  'hook',      // 첫 화면. 이게 뭐고 왜 봐야 하는가
  'problem',   // 기존 방식·대체재의 불편
  'solution',  // 우리 제품이 그것을 어떻게 푸는가
  'compare',   // 기존 방식 대비 우위
  'evidence',  // 관찰 가능한 근거
  'detail',    // 물리적 마감·소재·구조
  'usecase',   // 언제 어디서 쓰는가
  'option',    // 색상·사이즈 등 선택지
  'assure',    // 세탁·보관·제품정보
] as const;

export type Beat = (typeof BEATS)[number];

const BEAT_SET: ReadonlySet<string> = new Set(BEATS);

export interface NarrativeIssue {
  message: string;
  severity: 'error' | 'warning';
}

export interface NarrativeSection {
  beat?: unknown;
  blocks?: unknown;
}

/** assure가 이 위치 안에 있어야 한다 — 뒤에서 세 섹션 */
const ASSURE_TAIL = 3;

/**
 * compare 섹션에서 금지하는 표현.
 * 근거 없는 우위 주장은 실증 책임이 걸린다 — 카테고리 공지의 사실만 허용한다.
 * severity가 warning이므로 오탐 비용이 낮아 패턴을 단순하게 둔다.
 */
const FORBIDDEN_COMPARE = [
  { re: /\d+\s*배/, label: '배수' },
  { re: /\d+\s*%/, label: '퍼센트' },
  { re: /\d+\s*위/, label: '순위' },
] as const;

/** 값 트리의 모든 문자열에 콜백을 적용한다 */
function forEachString(node: unknown, cb: (s: string) => void): void {
  if (typeof node === 'string') { cb(node); return; }
  if (Array.isArray(node)) { node.forEach((v) => forEachString(v, cb)); return; }
  if (node !== null && typeof node === 'object') {
    Object.values(node as Record<string, unknown>).forEach((v) => forEachString(v, cb));
  }
}

/**
 * compare 섹션은 columns 2단 이상을 가져야 한다.
 * beat는 LLM 자기신고 라벨이라 구조 조건을 걸지 않으면 라벨만 붙이고 통과한다.
 */
function hasCompareStructure(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => {
    if (!b || typeof b !== 'object') return false;
    const block = b as Record<string, unknown>;
    return block.type === 'columns' && Array.isArray(block.cols) && block.cols.length >= 2;
  });
}

/** 서사 규칙 위반 목록을 반환한다. 위반이 없으면 빈 배열. */
export function checkNarrative(sections: NarrativeSection[]): NarrativeIssue[] {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const issues: NarrativeIssue[] = [];
  const beats: (string | null)[] = [];

  sections.forEach((sec, i) => {
    const raw = sec?.beat;
    if (typeof raw !== 'string' || raw.trim() === '') {
      issues.push({ message: `sections[${i}]에 beat 필드가 없습니다.`, severity: 'error' });
      beats.push(null);
      return;
    }
    if (!BEAT_SET.has(raw)) {
      issues.push({
        message: `sections[${i}]의 beat "${raw}"는 정의되지 않은 값입니다. 허용: ${BEATS.join(', ')}`,
        severity: 'error',
      });
      beats.push(null);
      return;
    }
    beats.push(raw);
  });

  // 첫 섹션은 hook
  if (beats[0] !== null && beats[0] !== 'hook') {
    issues.push({ message: `첫 섹션의 beat는 hook이어야 합니다 (현재: ${beats[0]}).`, severity: 'error' });
  }

  // compare 최소 1개 + 구조 조건
  const compareIdx = beats.reduce<number[]>((acc, b, i) => (b === 'compare' ? [...acc, i] : acc), []);
  if (compareIdx.length === 0) {
    issues.push({
      message: '비교(compare) 섹션이 없습니다. 기존 방식 대비 우위를 보여주는 섹션이 최소 1개 필요합니다.',
      severity: 'error',
    });
  } else {
    for (const i of compareIdx) {
      if (!hasCompareStructure(sections[i]?.blocks)) {
        issues.push({
          message: `sections[${i}]는 beat=compare지만 columns 2단 대비 구조가 없습니다.`,
          severity: 'error',
        });
      }
      // 근거 없는 우위 주장 검출 — 프롬프트 지시만으로는 막히지 않는다
      const found = new Set<string>();
      forEachString(sections[i]?.blocks, (s) => {
        for (const { re, label } of FORBIDDEN_COMPARE) {
          if (re.test(s)) found.add(label);
        }
      });
      if (found.size > 0) {
        issues.push({
          message: `sections[${i}](compare)에 ${[...found].join('·')} 표현이 있습니다. 카테고리 공지의 사실만 쓰세요.`,
          severity: 'warning',
        });
      }
    }
  }

  // problem이 있으면 solution도 있어야 한다 (미완결 서사 방지)
  if (beats.includes('problem') && !beats.includes('solution')) {
    issues.push({
      message: 'problem 섹션이 있는데 solution 섹션이 없습니다. 문제를 제기했으면 해법을 보여야 합니다.',
      severity: 'error',
    });
  }

  // assure는 끝부분에
  const assureIdx = beats.lastIndexOf('assure');
  if (assureIdx === -1 || assureIdx < sections.length - ASSURE_TAIL) {
    issues.push({
      message: `assure 섹션이 마지막 ${ASSURE_TAIL}개 섹션 안에 없습니다.`,
      severity: 'warning',
    });
  }

  return issues;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/narrative.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/narrative.ts src/__tests__/lib/detail-page/narrative.test.ts
git commit -m "feat(pro): 서사 비트 어휘 + narrative 검증 순수 모듈

compare 섹션의 배수·퍼센트·순위 표현 검출 포함 —
프롬프트 지시만으로는 막히지 않는다(progress_bar 사고와 동일 구조)."
```

---

## Task 2: progress_bar provenance 위생 모듈

`displayValue`의 숫자가 상품 입력에 실제로 등장할 때만 남긴다. 형식 검사로는 `"92%"`를 막을 수 없기 때문이다.

**Files:**
- Create: `src/lib/detail-page/progress-hygiene.ts`
- Test: `src/__tests__/lib/detail-page/progress-hygiene.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/lib/detail-page/progress-hygiene.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isGroundedProgressItem, cleanProgressBlocks } from '@/lib/detail-page/progress-hygiene';

const SOURCE = '무게 180g, 건조 시간 30초, 가슴둘레 95cm까지 지원';

describe('isGroundedProgressItem', () => {
  it('입력에 등장하는 수치는 통과', () => {
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '180g' }, SOURCE)).toBe(true);
  });

  it('입력에 없는 수치는 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '92%' }, SOURCE)).toBe(false);
  });

  it('displayValue가 없으면 거부 — 렌더러가 바 길이를 그대로 노출한다', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92 }, SOURCE)).toBe(false);
  });

  it('빈 displayValue도 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '  ' }, SOURCE)).toBe(false);
  });

  it('숫자 없는 정성 표현은 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '높음' }, SOURCE)).toBe(false);
    expect(isGroundedProgressItem({ label: '건조', value: 85, displayValue: 'Omni-Wick' }, SOURCE)).toBe(false);
  });

  it('여러 숫자 중 하나라도 입력에 없으면 거부', () => {
    expect(isGroundedProgressItem({ label: '범위', value: 50, displayValue: '180~200g' }, SOURCE)).toBe(false);
  });

  it('여러 숫자가 모두 입력에 있으면 통과', () => {
    expect(isGroundedProgressItem({ label: '범위', value: 50, displayValue: '30초/180g' }, SOURCE)).toBe(true);
  });

  it('소수점 수치도 완전일치로 판정한다', () => {
    expect(isGroundedProgressItem({ label: '두께', value: 40, displayValue: '1.5mm' }, '두께 1.5mm')).toBe(true);
    expect(isGroundedProgressItem({ label: '두께', value: 40, displayValue: '1.6mm' }, '두께 1.5mm')).toBe(false);
  });

  it('입력이 비어 있으면 모든 수치가 거부된다', () => {
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '180g' }, '')).toBe(false);
  });
});

describe('cleanProgressBlocks', () => {
  it('근거 없는 item만 제거한다', () => {
    const blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '무게', value: 70, displayValue: '180g' },
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '건조', value: 85, displayValue: '30초' },
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toHaveLength(2);
    expect(out[0].items.map((i: any) => i.displayValue)).toEqual(['180g', '30초']);
  });

  it('남은 item이 2개 미만이면 items를 비워 pruneBlocks가 제거하게 한다 (topLevel)', () => {
    const blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '흡수', value: 88, displayValue: '우수' },
          { label: '무게', value: 70, displayValue: '180g' },
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toEqual([]);
  });

  it('cols 안에서는 블록 자체를 제거한다', () => {
    const blocks = [
      {
        type: 'columns',
        cols: [
          [{ type: 'progress_bar', items: [{ label: 'x', value: 1, displayValue: '높음' }] }],
          [{ type: 'subtext', text: '남는다' }],
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].cols).toHaveLength(1);
    expect(out[0].cols[0][0].type).toBe('subtext');
  });

  it('원래 1개였던 블록은 필터링이 없으면 그대로 둔다', () => {
    const blocks = [
      { type: 'progress_bar', items: [{ label: '무게', value: 70, displayValue: '180g' }] },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toHaveLength(1);
  });

  it('progress_bar가 아닌 블록은 건드리지 않는다', () => {
    const blocks = [{ type: 'heading', text: '제목', size: 'xl' }];
    expect(cleanProgressBlocks(blocks, true, SOURCE)).toEqual(blocks);
  });

  it('모든 컬럼이 비면 columns 블록을 드롭한다', () => {
    const blocks = [
      {
        type: 'columns',
        cols: [[{ type: 'progress_bar', items: [{ label: 'x', value: 1, displayValue: '높음' }] }]],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/progress-hygiene.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/detail-page/progress-hygiene"`

- [ ] **Step 3: 구현한다**

`src/lib/detail-page/progress-hygiene.ts`:

```ts
/**
 * progress_bar 수치 위생.
 *
 * 렌더러(section-renderer.ts)는 displayValue가 없으면 바 길이를 `${pct}%`로 그대로 찍는다.
 * 따라서 근거 없는 수치를 방치하면 지어낸 숫자가 화면에 노출된다.
 *
 * 형식 검사로는 막을 수 없다 — "92%"는 형식상 완벽히 유효하다.
 * 판정 기준은 출처다: displayValue의 숫자가 상품 입력에 실제로 등장해야 한다.
 */

export interface ProgressItem {
  label?: string;
  value?: number;
  displayValue?: string;
  highlight?: boolean;
}

/** 숫자 토큰(정수·소수)을 뽑는다 */
const NUM_TOKEN = /\d+(?:\.\d+)?/g;

/** 문자열에서 숫자 토큰 집합을 만든다 */
function numberSet(text: string): Set<string> {
  return new Set(text.match(NUM_TOKEN) ?? []);
}

/**
 * displayValue의 모든 숫자가 입력 원천에 등장하는지 판정한다.
 *
 * 완전일치만 인정한다 — 단위 환산(0.18kg vs 180g)과 반올림은 대조 실패로 본다.
 * 오탐(정당한 수치를 제거)은 감수하고 미탐(지어낸 수치를 통과)을 0으로 만드는 선택이다.
 * 부분일치 정규식이 오탐을 낸 선례가 있어(커밋 5b0a49ba) 집합 완전일치를 쓴다.
 */
export function isGroundedProgressItem(item: ProgressItem, sourceText: string): boolean {
  const display = (item?.displayValue ?? '').trim();
  if (display === '') return false;

  const nums = display.match(NUM_TOKEN);
  // 숫자가 없는 정성 표현("높음", "Omni-Wick")은 근거로 볼 수 없다
  if (!nums || nums.length === 0) return false;

  const source = numberSet(sourceText ?? '');
  return nums.every((n) => source.has(n));
}

/**
 * blocks 배열의 progress_bar를 위생 처리한다.
 *
 * topLevel이면 2개 미만일 때 items를 비워 pruneBlocks가 제거하게 하고,
 * cols 안(topLevel=false)이면 pruneBlocks가 닿지 않으므로 블록을 직접 뺀다.
 * cleanStatBlocks(layout-validator.ts)와 동일한 규약이다.
 */
export function cleanProgressBlocks(
  blocks: unknown[],
  topLevel: boolean,
  sourceText: string,
): unknown[] {
  const out: unknown[] = [];

  for (const b of blocks) {
    if (!b || typeof b !== 'object') {
      out.push(b);
      continue;
    }
    const block = { ...(b as Record<string, unknown>) };

    if (Array.isArray(block.cols)) {
      const cols = (block.cols as unknown[])
        .map((col) => (Array.isArray(col) ? cleanProgressBlocks(col, false, sourceText) : col))
        .filter((col) => !Array.isArray(col) || col.length > 0);
      if (cols.length === 0) continue; // 모든 컬럼이 비면 columns 자체를 드롭
      block.cols = cols;
    }

    if (block.type === 'progress_bar' && Array.isArray(block.items)) {
      const original = block.items as ProgressItem[];
      const kept = original.filter(
        (it) => it && typeof it === 'object' && isGroundedProgressItem(it, sourceText),
      );
      // 위생의 목적은 잡음 제거지 구조 개편이 아니다 —
      // 필터링이 실제로 일어난 경우에만 2개 미만 규칙을 적용한다.
      if (kept.length < 2 && kept.length < original.length) {
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

/** 섹션의 progress_bar를 위생 처리한다 */
export function sanitizeProgressBars(sec: unknown, sourceText: string): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (!Array.isArray(s.blocks)) return s;
  s.blocks = cleanProgressBlocks(s.blocks as unknown[], true, sourceText);
  return s;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/progress-hygiene.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/progress-hygiene.ts src/__tests__/lib/detail-page/progress-hygiene.test.ts
git commit -m "feat(pro): progress_bar 수치 provenance 위생 모듈"
```

---

## Task 3: layout-validator 결선

두 모듈을 기존 검증·정화 흐름에 연결한다. **플래그로 감싸 생성 경로에서만 켠다** — 기존 테스트(`layout-validator.test.ts`)가 beat 없는 fixture로 `isClean=true`를 기대하고 있어, 무조건 켜면 전부 깨진다.

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts`
- Test: `src/__tests__/lib/detail-page/layout-validator-narrative.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/lib/detail-page/layout-validator-narrative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

function validSections(count = 6): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

/** beat까지 갖춘 유효 레이아웃 6섹션 */
function narrativeSections(): unknown[] {
  const beats = ['hook', 'problem', 'solution', 'compare', 'detail', 'assure'];
  return beats.map((beat, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    beat,
    blocks:
      beat === 'compare'
        ? [
            {
              type: 'columns',
              cols: [[{ type: 'subtext', text: '기존' }], [{ type: 'subtext', text: '우리' }]],
            },
          ]
        : [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

describe('narrative 플래그 게이트', () => {
  it('플래그가 꺼져 있으면 beat 없는 레이아웃도 isClean=true', () => {
    const res = validateProLayout(validSections());
    expect(res.isClean).toBe(true);
    expect(res.violations.some(v => v.code === 'narrative')).toBe(false);
  });

  it('플래그를 켜면 beat 누락이 error', () => {
    const res = validateProLayout(validSections(), { narrative: true });
    expect(res.isClean).toBe(false);
    expect(res.violations.some(v => v.code === 'narrative')).toBe(true);
  });

  it('beat를 갖춘 레이아웃은 플래그를 켜도 통과', () => {
    const res = validateProLayout(narrativeSections(), { narrative: true });
    expect(res.violations.filter(v => v.code === 'narrative' && v.severity === 'error')).toEqual([]);
  });
});

describe('beat 스키마', () => {
  it('beat는 optional이라 없어도 schema 위반이 아니다', () => {
    const res = validateProLayout(validSections());
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('beat 값이 유효하면 schema 위반이 아니다', () => {
    const res = validateProLayout(narrativeSections());
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('sanitize를 거쳐도 beat 필드가 보존된다', () => {
    const { sections } = sanitizeProLayout(narrativeSections());
    expect((sections[0] as any).beat).toBe('hook');
  });
});

describe('progress_bar provenance (provenanceSource 옵션)', () => {
  function withProgress(items: unknown[]): unknown[] {
    const secs = validSections();
    (secs[0] as any).blocks = [{ type: 'progress_bar', items }];
    return secs;
  }

  it('옵션이 없으면 progress_bar를 건드리지 않는다', () => {
    const secs = withProgress([
      { label: '신축성', value: 92, displayValue: '높음' },
      { label: '흡수', value: 88, displayValue: '우수' },
    ]);
    const { sections } = sanitizeProLayout(secs);
    expect((sections[0] as any).blocks[0].items).toHaveLength(2);
  });

  it('옵션이 있으면 근거 없는 item이 제거되고 블록째 사라진다', () => {
    const secs = withProgress([
      { label: '신축성', value: 92, displayValue: '높음' },
      { label: '흡수', value: 88, displayValue: '우수' },
    ]);
    const { sections } = sanitizeProLayout(secs, { provenanceSource: '무게 180g' });
    // items가 비면 pruneBlocks가 블록을 제거한다
    expect((sections[0] as any).blocks).toHaveLength(0);
  });

  it('근거 있는 수치는 살아남는다', () => {
    const secs = withProgress([
      { label: '무게', value: 70, displayValue: '180g' },
      { label: '건조', value: 60, displayValue: '30초' },
    ]);
    const { sections } = sanitizeProLayout(secs, { provenanceSource: '무게 180g, 건조 30초' });
    expect((sections[0] as any).blocks[0].items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator-narrative.test.ts`
Expected: FAIL — `narrative`/`provenanceSource` 옵션이 없어 플래그 테스트가 실패

- [ ] **Step 3: `Violation` code union에 `narrative`를 추가한다**

`src/lib/detail-page/layout-validator.ts:9` 부근의 code union에 `'narrative'`를 넣는다:

```ts
export interface Violation {
  code:
    | 'schema'
    | 'cjk'
    | 'broken_text'
    | 'prohibited'
    | 'duplicate'
    | 'empty_block'
    | 'section_count'
    | 'option_compare'
    | 'option_coverage'
    | 'narrative'
  // ... 나머지 필드는 그대로
```

> 기존 union의 정확한 멤버 목록은 파일을 열어 확인하고 `'narrative'`만 추가한다. 다른 멤버를 지우지 않는다.

- [ ] **Step 4: `ProLayoutOpts`에 옵션 두 개를 추가한다**

`layout-validator.ts:24~29`의 인터페이스:

```ts
export interface ProLayoutOpts {
  statHygiene?: boolean;
  /** 옵션 모드일 때 imageIndex → 옵션명. */
  optionNameByImageIndex?: Map<number, string>;
  /** 서사 검증 활성화 — 생성 경로 전용. draft/render는 사용자 편집본이라 켜지 않는다. */
  narrative?: boolean;
  /**
   * progress_bar 수치 대조용 입력 원천.
   * 지정하면 displayValue의 숫자가 이 문자열에 등장하는 item만 남긴다.
   * undefined면 progress_bar를 건드리지 않는다.
   */
  provenanceSource?: string;
}
```

- [ ] **Step 5: `zClaudeSection`에 `beat`를 optional로 추가한다**

`layout-validator.ts:58~66`:

```ts
const zClaudeSection = z.object({
  type: z.literal('claude_layout'),
  title: z.string(),
  points: z.array(z.string()).optional(),
  blocks: z.array(zLayoutBlock),
  bgStyle: z.enum(['white', 'light', 'dark', 'primary']).optional(),
  padding: z.enum(['normal', 'compact', 'wide']).optional(),
  imageSlots: z.array(z.object({ slotType: z.string(), promptHint: z.string().optional(), imageRef: z.number().optional() })).optional(),
  // 서사 비트. optional인 이유는 기존 draft 로드가 깨져서가 아니라(draft GET은 검증을
  // 거치지 않는다), draft 저장·render 경로의 warnings에 스키마 노이즈를 만들지
  // 않기 위해서다. 누락 검증은 narrative 플래그가 켜진 생성 경로에서만 한다.
  beat: z.enum(BEATS).optional(),
});
```

파일 상단에 import를 추가한다:

```ts
import { BEATS, checkNarrative, type NarrativeSection } from './narrative';
import { sanitizeProgressBars } from './progress-hygiene';
```

- [ ] **Step 6: `validateProLayout`에 narrative 검증을 결선한다**

`layout-validator.ts`의 `const isClean = ...` **직전**에 삽입한다:

```ts
  // ── 서사 검증 (생성 경로 전용) ──
  if (opts?.narrative) {
    for (const issue of checkNarrative(sections as NarrativeSection[])) {
      violations.push({
        code: 'narrative',
        path: 'sections',
        message: issue.message,
        severity: issue.severity,
        autoFixable: false,
      });
    }
  }

  const isClean = !violations.some((v) => v.severity === 'error');
```

- [ ] **Step 7: `sanitizeProLayout`에 progress 위생을 결선한다**

`layout-validator.ts:344~363`의 함수 본문에서 stat 위생 **바로 다음**에 넣는다:

```ts
  // 2) stat_row 위생 (생성 경로 전용 — draft/render는 사용자 편집본이라 건드리지 않는다)
  if (opts?.statHygiene) cleaned = cleaned.map(sanitizeStatRows);
  // 2-b) progress_bar 수치 위생 — 입력 원천에 없는 수치를 제거한다.
  //      pruneBlocks(3단계)보다 앞에 와야 items가 빈 블록이 제거된다.
  if (opts?.provenanceSource !== undefined) {
    const src = opts.provenanceSource;
    cleaned = cleaned.map((sec) => sanitizeProgressBars(sec, src));
  }
  // 3) 빈/무효 블록 제거
  cleaned = cleaned.map(pruneBlocks);
```

- [ ] **Step 8: 새 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-validator-narrative.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 9: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/`
Expected: PASS — 기존 `layout-validator.test.ts` 포함 전부 통과. 플래그 게이트가 제대로 걸렸다면 beat 없는 fixture가 여전히 `isClean=true`여야 한다.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/layout-validator-narrative.test.ts
git commit -m "feat(pro): narrative 검증 + progress 위생을 validator에 결선 (플래그 게이트)"
```

---

## Task 4: CLAUDE_SYSTEM 프롬프트 — beat·아크·compare 규칙

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/system-prompt.ts`

- [ ] **Step 1: 섹션 스키마 설명에 `beat`를 추가한다**

`system-prompt.ts:6~16`의 ClaudeLayoutContent 설명 블록에서 `imageSlots` 줄 다음에 `beat`를 넣는다:

```
{
  "type": "claude_layout",
  "beat": "hook"|"problem"|"solution"|"compare"|"evidence"|"detail"|"usecase"|"option"|"assure",
  "title": "section title",
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide",
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki"|"detail_closeup", "promptHint": "...", "imageRef": 0}]
}
```

- [ ] **Step 2: 서사 규칙 블록을 추가한다**

`CONSISTENCY & PACING` 섹션의 D3 다음, `${BENCHMARK_PATTERNS}` 앞에 삽입한다:

```
NARRATIVE (서사 — 이 페이지가 스펙 나열이 아니라 이야기가 되게 하는 규칙):
N0. 모든 섹션에 beat 필드를 반드시 붙이세요. 누락하면 레이아웃이 거부됩니다.
    hook=첫 화면(이게 뭐고 왜 봐야 하는가) / problem=기존 방식·대체재의 불편
    solution=우리 제품이 그것을 어떻게 푸는가 / compare=기존 방식 대비 우위
    evidence=관찰 가능한 근거 / detail=물리적 마감·소재·구조
    usecase=언제 어디서 쓰는가 / option=색상·사이즈 등 선택지
    assure=세탁·보관·제품정보
N1. 먼저 상품이 어떤 유형인지 판단하고 아래 아크 중 하나를 골라 섹션을 배열하세요.
    아크 이름은 출력하지 말고 순서만 따르세요. 상품에 맞게 비트를 가감해도 됩니다.
    - 기능형 (성능이 구매 이유 — 원단·도구·가전):
      hook → problem → solution → compare → evidence → detail → option → assure
    - 감성형 (장면이 구매 이유 — 패션·리빙):
      hook → usecase → detail → solution → compare → option → assure
    - 신뢰형 (믿음이 구매 이유 — 식품·고가):
      hook → detail → evidence → compare → usecase → option → assure
N2. 첫 섹션의 beat는 반드시 hook, assure는 마지막 3개 섹션 안에 두세요.
N3. compare 섹션을 최소 1개 만드세요. 반드시 columns 블록으로 2단 대비 구조를 쓰고
    (좌: 기존 방식의 한계 / 우: 우리 제품), 카테고리 공지의 사실만 다루세요.
    특정 경쟁사·브랜드 지목 금지. 배수·퍼센트·순위 표현 금지.
    ○ "면 100%는 땀을 머금어 무거워진다"
    ✗ "타사 대비 3배 빠른 건조"  ✗ "업계 1위 흡수력"
N4. problem 비트를 쓰면 solution 비트도 반드시 두세요. 문제만 제기하고 끝내지 마세요.
N5. evidence 비트는 관찰 가능한 물리적 근거만 다루세요 (봉제 밀도, 자로 잰 치수,
    물이 스며들지 않는 모습). 시험성적서·인증서류는 다루지 마세요.
    evidence 섹션에는 detail_closeup 슬롯을 배정해 판매자가 직접 촬영할 수 있게 하세요.
```

- [ ] **Step 3: progress_bar 사용 규칙을 C4 다음에 추가한다**

`COPYWRITING RULES` 섹션의 C5 다음에 넣는다:

```
C6. progress_bar는 입력에서 받은 실측 수치가 있을 때만 쓰세요. displayValue에는 반드시
    단위가 붙은 실측치를 넣으세요(예: "180g", "30초", "95cm"). "높음"·"빠름"·"우수" 같은
    정성 표현이나 근거 없는 퍼센트를 넣지 마세요 — 그런 항목은 자동 제거되어 섹션이
    비게 됩니다. 측정하지 않은 성능은 bullet_list로 서술하세요.
```

- [ ] **Step 4: 프롬프트 문자열이 정상 빌드되는지 확인한다**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: `system-prompt.ts` 관련 오류 없음 (다른 선재 오류는 무시)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/system-prompt.ts
git commit -m "feat(pro): CLAUDE_SYSTEM에 서사 비트·아크·compare 규칙 추가"
```

---

## Task 5: REPAIR_SYSTEM — beat 보존과 순서 재배치 허용

현행 규칙 4 *"Keep all valid content and structure unchanged"* 는 비트 재배치와 정면 충돌한다. 또한 beat 어휘를 알려주지 않으면 repair가 미지 필드를 지워버릴 수 있다.

**Files:**
- Modify: `src/lib/ai/repair-pro-layout.ts`

- [ ] **Step 1: 규칙 4를 완화하고 규칙 6~7을 추가한다**

`repair-pro-layout.ts`의 `REPAIR_SYSTEM` 안에서 규칙 4를 아래로 교체하고 6·7을 덧붙인다:

```
4. Keep all valid content unchanged. If a section is already correct, return it unchanged.
   Section ORDER may be changed only when fixing a narrative issue (rule 7).
5. 옵션 편중(option_coverage) 이슈가 있으면 imageSlots[].imageRef를 재배정해 옵션을 고르게 만든다. 단 섹션 내용과 옵션이 충돌하면 내용을 우선하고 다른 섹션에서 균형을 맞춘다. 비교 섹션(option_compare)은 옵션당 imageSlot 1개를 유지한다.
6. 모든 섹션은 beat 필드를 가져야 한다. beat 값은 다음 중 하나다:
   hook, problem, solution, compare, evidence, detail, usecase, option, assure
   beat 필드를 절대 삭제하지 마라. 없으면 섹션 내용을 보고 알맞은 값을 채워라.
7. narrative 이슈가 있으면 다음을 고쳐라:
   - 첫 섹션의 beat가 hook이 아니면 hook 섹션을 맨 앞으로 옮긴다.
   - compare 섹션이 없으면 하나를 만든다. columns 블록으로 2단 대비 구조를 쓰고
     (좌: 기존 방식의 한계 / 우: 우리 제품), 배수·퍼센트·순위 표현은 쓰지 않는다.
   - beat=compare인데 columns 2단이 없으면 columns 구조로 다시 쓴다.
   - problem이 있는데 solution이 없으면 solution 섹션을 추가한다.
   - assure 섹션을 마지막 3개 섹션 안으로 옮긴다.
```

> 기존 규칙 5(옵션 편중)는 번호만 유지하고 내용은 그대로 둔다. 위 블록에 원문을 그대로 포함해두었다.

- [ ] **Step 2: 기존 repair 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/ai/repair-pro-layout.test.ts`
Expected: PASS — 프롬프트 문자열만 바뀌었으므로 기존 동작(호출 실패 시 원본 반환 등)은 그대로여야 한다.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/ai/repair-pro-layout.ts
git commit -m "feat(pro): repair에 beat 보존 + narrative 수리 규칙 추가"
```

---

## Task 6: generate-pro-layout 라우트 결선

플래그를 켜고, provenance 입력을 전달하고, 잔존 위반을 응답에 싣는다.

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`
- Test: `src/__tests__/api/generate-pro-layout-narrative.test.ts` (신규)

- [ ] **Step 1: `layoutOpts` 구성에 새 옵션을 넣는다**

`route.ts:129~132`을 아래로 교체한다:

```ts
  // provenance 원천: 사용자가 실제로 입력한 값만 모은다.
  // progress_bar의 displayValue 숫자가 여기 등장해야 살아남는다.
  const provenanceSource = [
    ...productInfo.points,
    ...analyzedSections.map((s) => JSON.stringify(s.extractedData)),
  ].join(' ');

  // stat 위생·서사 검증은 생성 경로 전용 — draft/render는 사용자 편집본이라 켜지 않는다.
  const layoutOpts = optionMode
    ? {
        statHygiene: true,
        narrative: true,
        provenanceSource,
        optionNameByImageIndex: optionNameByImageIndex(options),
      }
    : { statHygiene: true, narrative: true, provenanceSource };
```

- [ ] **Step 2: 잔존 위반을 응답에 싣는다**

`route.ts`의 성공 응답 두 곳을 수정한다. 먼저 repair 분기 뒤의 최종 반환:

```ts
      // 재정화 후에도 남으면 경고만 남기고 결과를 준다 — 루프를 만들지 않는다.
      const after = validateProLayout(cleaned, layoutOpts);
      if (!after.isClean) {
        console.warn(
          '[generate-pro-layout] repair 후에도 위반 잔존:',
          after.violations.filter((v) => v.severity === 'error').map((v) => `${v.code}: ${v.message}`),
        );
      }
      // 잔존 error를 클라이언트에 전달해 결과 화면에서 알린다.
      return NextResponse.json({
        success: true,
        sections: cleaned,
        warnings: after.violations
          .filter((v) => v.severity === 'error')
          .map((v) => `${v.code}: ${v.message}`),
      });
    }
    return NextResponse.json({ success: true, sections: cleaned });
```

> 기존 코드는 repair 분기 안에서 반환하지 않고 아래로 흘러 하나의 `return`을 공유한다. 위처럼 분기 안에서 반환하도록 바꾸고, 분기 밖 `return`은 `warnings` 없이 그대로 둔다(위반이 없었던 경우).

- [ ] **Step 3: 테스트를 작성한다**

`src/__tests__/api/generate-pro-layout-narrative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/**
 * 라우트가 구성하는 layoutOpts와 동일한 형태로 검증이 동작하는지 확인한다.
 * (라우트 자체는 Claude 호출을 포함해 통합 테스트 대상이 아니다.)
 */
describe('생성 경로 옵션 조합', () => {
  const layoutOpts = {
    statHygiene: true,
    narrative: true,
    provenanceSource: '무게 180g 건조 30초',
  };

  function sections(beats: string[]): unknown[] {
    return beats.map((beat, i) => ({
      type: 'claude_layout',
      title: `섹션 ${i}`,
      beat,
      blocks:
        beat === 'compare'
          ? [{ type: 'columns', cols: [[{ type: 'subtext', text: 'a' }], [{ type: 'subtext', text: 'b' }]] }]
          : [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
      bgStyle: 'white',
    }));
  }

  it('서사를 갖춘 레이아웃은 error 없이 통과', () => {
    const secs = sections(['hook', 'problem', 'solution', 'compare', 'detail', 'assure']);
    const res = validateProLayout(secs, layoutOpts);
    expect(res.violations.filter(v => v.severity === 'error')).toEqual([]);
  });

  it('compare가 없으면 error → repair 트리거', () => {
    const secs = sections(['hook', 'detail', 'usecase', 'option', 'evidence', 'assure']);
    const res = validateProLayout(secs, layoutOpts);
    expect(res.isClean).toBe(false);
  });

  it('근거 없는 progress_bar가 생성 경로에서 제거된다', () => {
    const secs = sections(['hook', 'problem', 'solution', 'compare', 'detail', 'assure']) as any[];
    secs[4].blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '흡수', value: 88, displayValue: 'Omni-Wick' },
        ],
      },
    ];
    const { sections: out } = sanitizeProLayout(secs, layoutOpts);
    expect((out[4] as any).blocks).toHaveLength(0);
  });
});
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/api/generate-pro-layout-narrative.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: 기존 라우트 테스트가 깨지지 않았는지 확인한다**

Run: `npx vitest run src/__tests__/api/generate-pro-layout.test.ts src/__tests__/api/generate-pro-layout-patterns.test.ts`
Expected: PASS

**깨진다면**: 이 테스트들은 `repairProLayout`을 identity mock으로 두고 있어, fixture에 beat가 없으면 모든 케이스가 repair 분기로 들어간다. fixture 섹션에 `beat` 필드를 추가해 해결한다 (`hook`으로 시작, `compare` 하나에 columns 2단, `assure`로 끝).

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/route.ts src/__tests__/api/generate-pro-layout-narrative.test.ts
git commit -m "feat(pro): 생성 라우트에 narrative·provenance 결선 + 잔존 위반 응답"
```

---

## Task 7: 결과 화면 경고 배너

repair가 실패해도 200이 나가므로, 서사가 없는 페이지가 조용히 전달된다. 사용자가 알 수 있게 한다.

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`

- [ ] **Step 1: 레이아웃 응답에서 warnings를 받아 상태에 저장한다**

`page.tsx`에서 `/api/ai/generate-pro-layout` 응답을 파싱하는 지점을 찾는다 (`sections`를 꺼내 `setGeneratedSections`하는 곳). 응답 타입에 `warnings`를 추가하고 상태를 하나 만든다.

컴포넌트 상단 상태 선언부(다른 `useState`들 옆)에 추가:

```tsx
  // 레이아웃 검증에서 repair 후에도 남은 위반 — 결과 화면에 배너로 알린다.
  const [layoutWarnings, setLayoutWarnings] = useState<string[]>([]);
```

응답 파싱부에서:

```tsx
      const layoutJson = await layoutRes.json() as {
        success: boolean;
        sections?: unknown[];
        warnings?: string[];
        error?: string;
      };
      setLayoutWarnings(layoutJson.warnings ?? []);
```

> 기존 응답 파싱 코드의 타입 단언에 `warnings?: string[]`만 더하면 된다. `sections` 처리 로직은 바꾸지 않는다.

- [ ] **Step 2: `result` 화면에 배너를 렌더한다**

`result` 화면 JSX의 최상단(제목 위)에 삽입한다:

```tsx
        {layoutWarnings.length > 0 && (
          <div style={{
            background: '#FEF3C7',
            border: '1px solid #F59E0B',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            color: '#78350F',
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            <strong>이 페이지의 구성이 일부 기준에 못 미칩니다.</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {layoutWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              그대로 사용할 수 있지만, 다시 생성하면 개선될 수 있습니다.
            </div>
          </div>
        )}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "detail-maker-pro" | head -20`
Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/listing/\[id\]/detail-maker-pro/page.tsx
git commit -m "feat(pro): 레이아웃 검증 잔존 위반을 결과 화면에 표시"
```

---

## Task 8: 실물 픽스처 회귀 테스트

현재 문제가 된 민소매 티셔츠 레이아웃이 실제로 걸리는지 고정한다.

**Files:**
- Test: `src/__tests__/lib/detail-page/narrative-fixture.test.ts` (신규)

- [ ] **Step 1: 픽스처 테스트를 작성한다**

`src/__tests__/lib/detail-page/narrative-fixture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/**
 * 2026-07-26 실제 생성물(Columbia 민소매) 축약 픽스처.
 * 서사 없음 + 근거 없는 progress_bar가 실제로 검출되는지 고정한다.
 */
function tshirtLayout(): unknown[] {
  const titles = [
    '민소매 오버핏', '당겨도 돌아오는 신축 원단', '등판 스플래터 로고',
    '컬러 2가지', '사이즈 가이드', '넓은 암홀, 두툼한 목시보리',
    '휴가부터 동네 러닝까지', '세탁 순서', '제품 정보',
  ];
  return titles.map((title, i) => ({
    type: 'claude_layout',
    title,
    // beat 없음 — 현재 생성물의 상태
    blocks:
      i === 1
        ? [
            {
              type: 'progress_bar',
              items: [
                { label: '좌우 신축성', value: 92, displayValue: '높음' },
                { label: '땀 흡수·확산', value: 88, displayValue: 'Omni-Wick' },
                { label: '건조 속도', value: 85, displayValue: '빠름' },
              ],
            },
          ]
        : [{ type: 'heading', text: title, size: 'xl' }],
    bgStyle: 'white',
  }));
}

const GEN_OPTS = {
  statHygiene: true,
  narrative: true,
  // 실제 입력에는 이 수치들이 없었다
  provenanceSource: 'Columbia Omni-Wick 민소매 오버핏 M(95) L(100) XL(105) XXL(110)',
};

describe('민소매 티셔츠 실물 픽스처', () => {
  it('beat 누락이 검출된다', () => {
    const res = validateProLayout(tshirtLayout(), GEN_OPTS);
    expect(res.violations.some(v => v.code === 'narrative' && v.message.includes('beat'))).toBe(true);
  });

  it('compare 섹션 누락이 검출된다', () => {
    const res = validateProLayout(tshirtLayout(), GEN_OPTS);
    expect(res.violations.some(v => v.code === 'narrative' && v.message.includes('비교'))).toBe(true);
  });

  it('isClean=false라 repair가 트리거된다', () => {
    expect(validateProLayout(tshirtLayout(), GEN_OPTS).isClean).toBe(false);
  });

  it('근거 없는 progress_bar 3개 item이 전부 제거되고 블록이 사라진다', () => {
    const { sections } = sanitizeProLayout(tshirtLayout(), GEN_OPTS);
    expect((sections[1] as any).blocks).toHaveLength(0);
  });

  it('92 같은 지어낸 수치가 결과물 어디에도 남지 않는다', () => {
    const { sections } = sanitizeProLayout(tshirtLayout(), GEN_OPTS);
    const json = JSON.stringify(sections);
    expect(json).not.toContain('92');
    expect(json).not.toContain('88');
    expect(json).not.toContain('85');
  });
});
```

- [ ] **Step 2: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/narrative-fixture.test.ts`
Expected: PASS — 5 tests

**"92를 포함하지 않는다" 테스트가 실패하면**: `sanitizeProLayout`의 단계 순서를 확인한다. progress 위생(2-b)이 `pruneBlocks`(3)보다 앞에 있어야 items가 빈 블록이 제거된다.

- [ ] **Step 3: 전체 detail-page 테스트를 돌린다**

Run: `npx vitest run src/__tests__/lib/detail-page/ src/__tests__/api/generate-pro-layout-narrative.test.ts`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/__tests__/lib/detail-page/narrative-fixture.test.ts
git commit -m "test(pro): 민소매 실물 픽스처로 서사 누락·수치 제거 회귀 고정"
```

---

## 완료 확인

- [ ] `npx vitest run src/__tests__/lib/detail-page/ src/__tests__/lib/ai/ src/__tests__/api/generate-pro-layout.test.ts src/__tests__/api/generate-pro-layout-patterns.test.ts src/__tests__/api/generate-pro-layout-narrative.test.ts` 전부 통과
- [ ] `npx tsc --noEmit` 에서 이번에 만진 파일의 오류 없음
- [ ] 실제 PRO 생성을 한 번 돌려 결과물에 `compare` 섹션이 생기고 근거 없는 progress_bar가 없는지 눈으로 확인

## 이 계획의 범위 밖

- 이미지 소스 라우팅(`existing`/`generate`/`shoot`) — 2단계
- `model_wearing` 인물 씬 — 2단계
- 촬영 제안 UX, shot-guide 슬롯 확장 — 3단계
- progress_bar 바 길이의 임의 스케일 문제 — 2단계 이후 재평가
