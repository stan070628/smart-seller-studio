# 상세페이지 다듬기 (AI 냄새 제거 + 보태니컬 비누 리뉴얼) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 상세페이지 파이프라인의 구조 층위 AI 냄새(번호 배지·구분선·넘버링)를 제거하고, 개선판으로 보태니컬 비누(쿠팡 16202992314) 상세를 리뉴얼한다.

**Architecture:** 선형 아이콘은 `lucide-static`(devDependency)에서 빌드 스크립트로 추출해 `icon-library.ts`에 인라인 임베드한다(런타임 의존성 0). 배경 리듬은 기존 `bgStyle` 필드를 프롬프트가 로테이션하도록 지시하고, divider는 렌더만 여백으로 바꾼다. 검증 규칙은 `narrative.ts`/`layout-validator.ts`의 기존 warning 패턴을 따른다.

**Tech Stack:** TypeScript, Next.js, vitest (`npm test`), lucide-static (dev만).

**스펙:** `docs/superpowers/specs/2026-09-04-detail-page-polish-design.md`

**참고할 기존 코드 (작업 전 반드시 읽기):**
- `src/lib/detail-page/section-renderer.ts:700-716` — `accentNumberBadge` (폴백 대상)
- `src/lib/detail-page/section-renderer.ts:879-897` — `icon_grid` 케이스
- `src/lib/detail-page/section-renderer.ts:810-811` — `divider` 케이스
- `src/lib/detail-page/section-renderer.ts:150` — hero h2 clamp
- `src/app/api/ai/generate-pro-layout/system-prompt.ts:61` — DESIGN RULE 10
- `src/lib/detail-page/narrative.ts` — `NarrativeRule`/`NarrativeIssue`/`checkNarrative` 패턴
- `src/lib/detail-page/palette-config.ts` — `PaletteColors` (bg/bgAlt/accent)
- `src/types/detail-page.ts:176` — `icon_grid` 블록 타입 (icon: string 이미 존재)
- 기존 테스트 스타일: `src/lib/detail-page/image-usage.test.ts`

---

### Task 1: 선형 아이콘 라이브러리 생성

**Files:**
- Create: `scripts/_gen_icon_library.mjs`
- Create: `src/lib/detail-page/icon-library.ts` (스크립트가 생성)
- Test: `src/lib/detail-page/icon-library.test.ts`

- [ ] **Step 1: lucide-static 설치 (devDependency)**

Run: `npm i -D lucide-static`
Expected: package.json devDependencies에 추가됨.

- [ ] **Step 2: 생성 스크립트 작성**

`scripts/_gen_icon_library.mjs`:

```js
// icon-library.ts 생성기 — lucide-static SVG를 인라인 임베드한다.
// 실행: node scripts/_gen_icon_library.mjs  (재생성 시에만; 결과 파일은 커밋한다)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 우리 키 → lucide 아이콘 파일명. 키는 상세페이지 도메인 어휘로 짓는다.
const KEY_MAP = {
  // 계절·기간
  season_sun: 'sun', season_winter: 'snowflake', season_leaf: 'leaf',
  duration_clock: 'clock', duration_calendar: 'calendar-days', duration_timer: 'timer',
  // 성분·재질
  ingredient_droplet: 'droplet', ingredient_sprout: 'sprout', ingredient_flower: 'flower-2',
  ingredient_feather: 'feather', texture_layers: 'layers', natural_leafy: 'leafy-green',
  // 세척·관리
  wash_droplets: 'droplets', wash_waves: 'waves', care_refresh: 'refresh-cw',
  care_hand: 'hand', care_thermometer: 'thermometer',
  // 보관·포장·배송
  storage_box: 'box', storage_archive: 'archive', pack_package: 'package',
  pack_sealed: 'package-check', gift_box: 'gift', delivery_truck: 'truck',
  // 용량·구성·수치
  size_ruler: 'ruler', weight_scale: 'scale', count_grid: 'layout-grid',
  plus_bonus: 'plus-circle',
  // 사용감·효익
  feel_sparkle: 'sparkles', feel_heart: 'heart', feel_smile: 'smile',
  safe_shield: 'shield-check', mild_baby: 'baby', scent_wind: 'wind',
  bubble_cloud: 'cloud', moisture_droplet: 'glass-water',
  // 의류
  cloth_shirt: 'shirt', fit_move: 'move-vertical', stretch_expand: 'expand',
  // 범용
  check_badge: 'badge-check', star_point: 'star', home_house: 'house',
};

const dir = resolve('node_modules/lucide-static/icons');
const entries = [];
const missing = [];
for (const [key, lucideName] of Object.entries(KEY_MAP)) {
  try {
    const svg = readFileSync(resolve(dir, `${lucideName}.svg`), 'utf8');
    // <svg ...> 래퍼를 벗기고 내부 path만 남긴다. 렌더 시 우리가 다시 감싼다.
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    entries.push(`  ${JSON.stringify(key)}: ${JSON.stringify(inner)},`);
  } catch {
    missing.push(`${key} -> ${lucideName}`);
  }
}
if (missing.length) {
  console.error('누락된 lucide 아이콘 (이름을 고쳐라):\n' + missing.join('\n'));
  process.exit(1);
}
const out = `// 자동 생성 파일 — 수정하지 말 것. 재생성: node scripts/_gen_icon_library.mjs
// 출처: lucide-static (ISC). stroke 기반 선형 아이콘의 내부 마크업만 임베드한다.

const ICON_PATHS: Record<string, string> = {
${entries.join('\n')}
};

export const ICON_KEYS = Object.keys(ICON_PATHS);

/** 유효한 키면 인라인 SVG 문자열, 아니면 null. color는 stroke 색. */
export function getIcon(key: string, size = 26, color = 'currentColor'): string | null {
  const inner = ICON_PATHS[key];
  if (!inner) return null;
  return \`<svg xmlns="http://www.w3.org/2000/svg" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="\${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 8px;">\${inner}</svg>\`;
}
`;
writeFileSync(resolve('src/lib/detail-page/icon-library.ts'), out);
console.log(`icon-library.ts 생성: ${entries.length}개 아이콘`);
```

- [ ] **Step 3: 실패하는 테스트 작성**

`src/lib/detail-page/icon-library.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getIcon, ICON_KEYS } from './icon-library';

describe('icon-library', () => {
  it('35개 이상의 키를 제공한다', () => {
    expect(ICON_KEYS.length).toBeGreaterThanOrEqual(35);
  });
  it('유효한 키는 선형 SVG를 돌려준다', () => {
    const svg = getIcon('pack_sealed', 26, '#7A5C10');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#7A5C10"');
  });
  it('무효한 키는 null', () => {
    expect(getIcon('없는키')).toBeNull();
    expect(getIcon('')).toBeNull();
  });
  it('이모지가 섞여 있지 않다', () => {
    for (const k of ICON_KEYS) expect(getIcon(k)!).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run src/lib/detail-page/icon-library.test.ts`
Expected: FAIL — icon-library 모듈 없음.

- [ ] **Step 5: 생성 스크립트 실행**

Run: `node scripts/_gen_icon_library.mjs`
Expected: `icon-library.ts 생성: 38개 아이콘`. 누락 오류가 나오면 lucide-static 실제 파일명(`ls node_modules/lucide-static/icons | grep <추정어>`)으로 KEY_MAP을 고치고 재실행.

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/lib/detail-page/icon-library.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/_gen_icon_library.mjs src/lib/detail-page/icon-library.ts src/lib/detail-page/icon-library.test.ts package.json package-lock.json
git commit -m "feat(detail-page): 선형 아이콘 라이브러리 (lucide-static 임베드)"
```

---

### Task 2: icon_grid 렌더러 — 선형 아이콘 + 번호 배지 폴백

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts` (상단 import, `icon_grid` 케이스 ~879행)
- Test: `src/lib/detail-page/icon-render.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/detail-page/icon-render.test.ts` — `renderSection`을 통해 icon_grid를 렌더한다:

```ts
import { describe, expect, it } from 'vitest';
import { renderSection } from './section-renderer';
import type { DetailSection } from '@/types/detail-page';

function iconGridSection(icon: string): DetailSection {
  return {
    id: 's1', type: 'claude_layout', order: 0, attachedImages: [],
    content: {
      type: 'claude_layout', title: '', blocks: [
        { type: 'icon_grid', cols: 2, items: [{ icon, title: '낱개 밀봉' }, { icon, title: '대용량' }] },
      ],
    },
  } as unknown as DetailSection;
}
const theme = { palette: 'cream_cozy' } as never;

describe('icon_grid 선형 아이콘', () => {
  it('유효한 키면 선형 SVG를 그린다', () => {
    const html = renderSection(iconGridSection('pack_sealed'), theme);
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-width="2"');
  });
  it('빈 키면 기존 번호 배지로 폴백한다', () => {
    const html = renderSection(iconGridSection(''), theme);
    expect(html).toContain('>1</div>');
    expect(html).toContain('>2</div>');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/detail-page/icon-render.test.ts`
Expected: 첫 테스트 FAIL (아직 번호 배지만 그림), 둘째 PASS.

- [ ] **Step 3: 구현**

`section-renderer.ts` 상단 import에 추가:

```ts
import { getIcon } from './icon-library';
```

`accentNumberBadge` 함수 바로 아래에 헬퍼 추가:

```ts
// 유효한 라이브러리 키면 선형 아이콘, 아니면 번호 배지 — 절대 깨지지 않는 폴백.
function iconOrBadge(iconKey: string | undefined, index: number, colors: PaletteColors): string {
  const isDark = colors.text === '#ffffff';
  const c = isDark ? '#ffffff' : colors.accent;
  const svg = iconKey ? getIcon(iconKey, 26, c) : null;
  return svg ?? accentNumberBadge(index, colors);
}
```

`icon_grid` 케이스의 `${accentNumberBadge(i + 1, colors)}`를 다음으로 교체:

```ts
${iconOrBadge(item.icon, i + 1, colors)}
```

(496행의 다른 `accentNumberBadge(i + 1, colors)` 호출은 timeline용 — 건드리지 않는다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/detail-page/icon-render.test.ts`
Expected: PASS (2 tests). 이어서 `npx vitest run src/lib/detail-page` 전체 회귀 통과 확인.

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/lib/detail-page/icon-render.test.ts
git commit -m "feat(detail-page): icon_grid에 선형 아이콘 렌더 (번호 배지 폴백)"
```

---

### Task 3: divider 렌더를 여백으로 교체

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts:810-811`
- Test: `src/lib/detail-page/icon-render.test.ts` (같은 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
describe('divider는 선을 긋지 않는다', () => {
  it('hr 대신 여백을 그린다', () => {
    const section = {
      id: 's2', type: 'claude_layout', order: 0, attachedImages: [],
      content: { type: 'claude_layout', title: '', blocks: [{ type: 'divider' }] },
    } as unknown as DetailSection;
    const html = renderSection(section, theme);
    expect(html).not.toContain('<hr');
    expect(html).toContain('height:28px');
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

Run: `npx vitest run src/lib/detail-page/icon-render.test.ts` → FAIL 확인 후, `case 'divider':`를 교체:

```ts
    case 'divider':
      // 실제 쇼핑몰 상세는 선으로 섹션을 가르지 않는다 — 여백과 배경 전환이 리듬을 만든다.
      // (위키 [[상세페이지 AI 냄새 신호]] 구조 신호 2번)
      return `<div style="height:28px;"></div>`;
```

- [ ] **Step 3: 통과 확인 + 전체 회귀**

Run: `npx vitest run src/lib/detail-page` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/lib/detail-page/icon-render.test.ts
git commit -m "feat(detail-page): divider를 선 대신 여백으로 렌더"
```

---

### Task 4: 넘버링 나열 금지 — narrative 규칙

**Files:**
- Modify: `src/lib/detail-page/narrative.ts` (`NarrativeRule` 유니온, `checkNarrative`)
- Test: 기존 narrative 테스트 파일이 있으면 거기, 없으면 `src/lib/detail-page/narrative-numbering.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from 'vitest';
import { checkNarrative } from './narrative';

const base = (heading: string) => ([{
  beat: 'hook', title: heading,
  blocks: [{ type: 'heading', text: heading }],
}] as never);

describe('numbered_worry — 고민 넘버링 나열 금지', () => {
  it('「첫 번째 고민」을 잡는다', () => {
    const issues = checkNarrative(base('여름 비누의 첫 번째 고민'));
    expect(issues.some((i) => i.rule === 'numbered_worry')).toBe(true);
  });
  it('일반 순서 표현(사용 1단계 등)은 잡지 않는다', () => {
    const issues = checkNarrative(base('사용 방법 1단계'));
    expect(issues.some((i) => i.rule === 'numbered_worry')).toBe(false);
  });
});
```

주의: `checkNarrative`의 실제 `NarrativeSection` 형태를 먼저 읽고(`narrative.ts:75` 부근) 테스트 입력을 그 형태에 맞춘다 — 위 `base`는 골격이며 실제 필드명(`sections[i].blocks` leaf 수집 방식)에 맞춰 조정한다.

- [ ] **Step 2: 실패 확인 → 구현**

`NarrativeRule` 유니온에 `| 'numbered_worry'` 추가. `COMPARATIVE_MARKER` 근처에 상수 추가:

```ts
// 「첫 번째 고민, 두 번째 고민…」 목차식 나열 — 쇼핑몰이 아니라 문서를 쓰는 AI의 습관이다.
// 장면으로 보여줘야 할 고민을 세는 순간 "잘하는 AI가 만든 냄새"가 난다(온크트리 실측).
const NUMBERED_WORRY = /(첫|두|세|네|다섯)\s*번째\s*(고민|장점|이유|문제|걱정)/;
```

`checkNarrative` 본문에서 섹션 텍스트를 이미 평탄화해 검사하는 compare_claim 루프와 같은 위치에 추가:

```ts
if (NUMBERED_WORRY.test(sectionText)) {
  issues.push({
    rule: 'numbered_worry',
    severity: 'warning',
    sectionIndex: i,
    message: `sections[${i}]에 「n번째 고민」식 넘버링 나열 — 장면·소제목으로 풀어 쓴다.`,
  });
}
```

(`sectionText` 변수명·`NarrativeIssue` 필수 필드는 기존 compare_claim 구현을 그대로 따른다.)

- [ ] **Step 3: 통과 + 전체 회귀 → Commit**

```bash
npx vitest run src/lib/detail-page && git add -A src/lib/detail-page && git commit -m "feat(detail-page): 넘버링 나열(numbered_worry) 검출 규칙"
```

---

### Task 5: system-prompt 개정 — 아이콘 키·배경 리듬·넘버링·구분선

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/system-prompt.ts`

- [ ] **Step 1: DESIGN RULE 10 교체**

기존 61행:
```
10. icon_grid·timeline의 icon 필드는 반드시 빈 문자열("")로 두세요. 이모지(🌙🪶🎒 등)를 절대 넣지 마세요 — 렌더러가 번호 배지를 그립니다. 이모지는 저품질로 보입니다.
```
을 다음으로 교체 (ICON_KEYS를 import해 동적으로 주입):

```ts
import { ICON_KEYS } from '@/lib/detail-page/icon-library';
```

```
10. icon_grid의 icon 필드에는 아래 아이콘 키 중 항목 의미에 맞는 것을 넣으세요. 이모지(🌙🪶🎒 등)는 절대 금지 — 저품질로 보입니다. 맞는 키가 없으면 빈 문자열("")로 두세요(렌더러가 번호 배지로 대체). timeline의 icon은 계속 빈 문자열.
    사용 가능한 키: ${ICON_KEYS.join(', ')}
```

- [ ] **Step 2: 규칙 2건 추가 (DESIGN RULE 목록 끝에)**

```
11. divider 블록을 쓰지 마세요. 실제 쇼핑몰 상세는 선으로 섹션을 가르지 않습니다 — 섹션 전환은 bgStyle 교대로 만드세요. 인접 섹션이 같은 bgStyle로 3개 이상 이어지지 않게 white → light → white 리듬을 유지하고, dark 또는 primary는 페이지에서 강조 1~2곳에만 쓰세요.
12. 「첫 번째 고민, 두 번째 고민」처럼 고민·장점·이유를 순번으로 세지 마세요. 목차식 나열은 AI가 쓴 문서처럼 읽힙니다. 고민은 장면으로, 장점은 소제목으로 보여주세요.
```

- [ ] **Step 3: 빌드·타입 확인**

Run: `npx tsc --noEmit 2>&1 | head -20` (기존 오류와 diff로 신규 오류 없음 확인)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/generate-pro-layout/system-prompt.ts
git commit -m "feat(detail-page): 프롬프트에 아이콘 키·배경 리듬·넘버링 금지 규칙"
```

---

### Task 6: layout-validator — 무효 아이콘 키 warning + autofix

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts`
- Test: `src/lib/detail-page/icon-validator.test.ts`

- [ ] **Step 1: 기존 패턴 파악**

`layout-validator.ts`에서 `broken_text` 또는 `empty_block` warning의 구현(Violation 생성 + autoFix 함수)을 읽는다. 신규 코드는 그 형태를 그대로 따른다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from 'vitest';
import { validateProLayout } from './layout-validator';
// 기존 테스트 파일에서 최소 유효 레이아웃 fixture를 가져와 icon_grid만 끼운다.

describe('icon_key 검증', () => {
  it('무효 키는 warning + 빈 문자열로 autofix', () => {
    // fixture의 한 섹션 blocks에 { type:'icon_grid', items:[{ icon:'없는키', title:'x' }] } 삽입
    // validateProLayout 결과에 code==='icon_key' warning이 있고,
    // autoFix 적용 후 icon === '' 이어야 한다.
  });
});
```

(fixture 형태는 `layout-validator.ts` 기존 테스트/타입을 읽고 완성한다 — Violation code는 `'icon_key'`, severity `'warning'`, autoFix ✓.)

- [ ] **Step 3: 구현**

검증 루프에서 icon_grid 블록 순회 시:

```ts
if (block.type === 'icon_grid') {
  block.items.forEach((item, j) => {
    if (item.icon && getIcon(item.icon) === null) {
      violations.push({
        code: 'icon_key', severity: 'warning', autoFix: true,
        message: `sections[${i}].blocks[${b}].items[${j}] icon "${item.icon}"는 라이브러리에 없다 — 번호 배지로 폴백`,
      });
      item.icon = ''; // sanitize 단계에서 빈 문자열로 치환
    }
  });
}
```

(Violation 객체의 실제 필드명은 기존 코드에 맞춘다. 치환은 기존 autofix가 수행되는 위치 — `sanitizeProLayout` 또는 fix 루틴 — 와 같은 곳에서 한다.)

- [ ] **Step 4: 통과 + 전체 회귀 → Commit**

```bash
npx vitest run src/lib/detail-page && git add -A src/lib/detail-page && git commit -m "feat(detail-page): 무효 아이콘 키 warning/autofix"
```

---

### Task 7: 훅 대형 타이포

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts:150`

- [ ] **Step 1: clamp 상향**

150행 hero h2:
```
font-size:clamp(20px,4vw,32px)
```
→
```
font-size:clamp(26px,7vw,40px)
```

- [ ] **Step 2: 시각 확인은 Task 9의 렌더 산출물에서 한다** (모바일 390px 스크린샷). 회귀 테스트만 확인:

Run: `npx vitest run src/lib/detail-page`

- [ ] **Step 3: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts
git commit -m "feat(detail-page): 훅 헤드라인 타이포 상향 (clamp 26-40px)"
```

---

### Task 8: 팔레트 톤을 씬 생성 프롬프트에 주입

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/user-prompt.ts` (`buildSceneUserPrompt`)

- [ ] **Step 1: 함수 시그니처와 호출부 파악**

`user-prompt.ts`의 `buildSceneUserPrompt` 정의와 `route.ts`의 호출부를 읽는다. 팔레트명이 요청에 없으면 optional 파라미터로 추가한다.

- [ ] **Step 2: 톤 힌트 문단 추가**

```ts
import { PALETTES, type PaletteName } from '@/lib/detail-page/palette-config';

export function paletteToneHint(palette?: PaletteName): string {
  if (!palette) return '';
  const c = PALETTES[palette];
  return `\nColor tone: match the page palette — background tones near ${c.bg}, accents near ${c.accent}. Keep overall color temperature consistent with these hex values. Muted, natural saturation.`;
}
```

프롬프트 조립 끝에 `paletteToneHint(palette)`를 이어 붙인다. 호출부(route.ts)에서 요청 body의 palette를 전달한다 (없으면 undefined — 기존 동작 불변).

- [ ] **Step 3: 타입 확인 → Commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add src/app/api/ai/generate-scene-image/ && git commit -m "feat(scene): 팔레트 톤 힌트를 씬 프롬프트에 주입"
```

---

### Task 9: 보태니컬 비누 리뉴얼 실행 (파이프라인 소비자)

**Files:**
- Create: `scripts/_soap_gen.ts` (레이아웃 생성 — `scripts/_puma_gen.ts`를 읽고 같은 구조로)
- Create: `scripts/_soap_render.ts` (`scripts/_puma_render.ts` 참조)
- 자산: `/Volumes/Mac_SSD/Seller/26.09월/보태니컬 비누 리뉴얼/`

이 태스크는 코드가 아니라 산출물 작업이다. 스펙의 시나리오 v1(10섹션)을 그대로 따른다.

- [ ] **Step 1: 기존 스크립트 패턴 확인** — `scripts/_puma_gen.ts`·`_puma_render.ts`·`_dewrinkle_section.ts`를 읽는다. lib 직접 import + `npx --no-install tsx` 실행 패턴.
- [ ] **Step 2: `_soap_gen.ts` 작성** — 제품 정보(스펙의 코스트코 확정 팩트: 200g×4, 팩3 4종 향, 호주, SLS 무첨가, 36개월)와 시나리오 beat 배열을 넣고 generate-pro-layout의 lib 경로로 레이아웃 JSON 생성. 카피 규칙 12개 + AI 냄새 신호 4종을 프롬프트에 전문 주입. 금지: 습진·아토피 효능, 고트밀크 함량, 100% 천연, 향 과장, 트리플 밀드.
- [ ] **Step 3: 레이아웃 검증** — validateProLayout isClean 확인. icon_grid에 라이브러리 키가 실제로 들어왔는지, bgStyle 리듬(white→light 교대·dark 1~2곳)인지, divider 0개인지 눈으로 확인.
- [ ] **Step 4: 이미지 제작** — 훅·비교·해결은 실촬영 포장컷(기존 IMG_3619 계열) 픽셀 보정(AI 배경교체 금지). 각인 매크로는 실물컷. 거품 사용컷은 캐릭터 시트 모델컷 2장 이상. 씬 생성 시 palette 파라미터 전달(Task 8). 검수본(문제 부위 확대) 동봉.
  🔴 **AI로 생성한 모든 이미지(씬컷·모델컷)는 렌더에 투입하기 전 사용자 승인을 먼저 받는다** — 생성 즉시 파일로 전달하고, 승인된 컷만 Step 5 렌더에 쓴다. 반려된 컷은 사유를 받아 재생성한다 (2026-09-05 사용자 지시).
- [ ] **Step 5: 전후 비교 렌더** — 같은 레이아웃 JSON을 ① 개선 렌더러 ② `git stash`로 Task 2·3·7 이전 렌더러 두 버전으로 렌더해 HTML 2부 저장. 파일명에 버전 명시 (`soap_v2_개선.html` / `soap_v1_현행.html`).
- [ ] **Step 6: 모바일 검수** — 390px 폭 확인 + 최종 HTML font-size 1.8배 스케일 적용. 파일 경로를 사용자에게 알리고 **검수 승인 대기**.
- [ ] **Step 7 (승인 후): 채널 반영** — 쿠팡(조회 전문에 얹어 PUT + `requested:true`) → 네이버(프록시 경유) → 토스(렌더 이미지) 3채널 모두. 검색태그에 답례품·집들이선물 추가(금지어 검증 후). 재조회로 검증.
- [ ] **Step 8: 위키 기록** — [[상세페이지 AI 냄새 신호]]에 실측 결과, log.md append.

---

## Self-Review 결과

- 스펙 커버리지: 변경 5건 = Task 1-2(아이콘) · 3+5(구분선/리듬) · 4+5(넘버링) · 7(타이포) · 8(팔레트), 시나리오 실행 = Task 9, 검증(전후 비교·모바일·3채널·위키) = Task 9 Step 5-8. 누락 없음.
- Task 6·8의 fixture/시그니처는 기존 코드 확인 후 완성하도록 명시 — 파일을 읽지 않고 지어내지 않기 위함.
- 타입 일관성: `getIcon(key, size, color)` — Task 1 정의·Task 2 사용 일치. Violation code `'icon_key'` 단일.
