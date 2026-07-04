# PRO 상세페이지 신뢰성 + 편집가능화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 모드 상세페이지의 생성 DSL을 검증·수리하고, claude_layout 텍스트를 인라인 편집 가능하게 하며, 작업물을 DB에 영속화한다.

**Architecture:** WS1 — 결정론적 Zod 검증/수리(`sanitizeProLayout`)를 생성·렌더 경계에 삽입. WS2 — `renderLayoutBlock`에 `basePath`를 주입해 `editableText`로 감싸 미리보기 클릭 편집 활성화(클라이언트 경로 리졸버는 이미 깊은 경로 지원). WS3 — `detail_page_drafts` 테이블 + service-role 라우트 + 디바운스 자동저장.

**Tech Stack:** Next.js(App Router), TypeScript, Zod, Supabase(service-role via `getSupabaseServerClient`), 자체 JWT 인증(`requireAuth`), vitest, Sharp/HTML 렌더러.

> **환경 주의:** 이 환경에서 `npx vitest run`은 worker 생성 60초 타임아웃으로 죽을 수 있다. 각 테스트 실행 단계는 `npx vitest run <path>`를 우선 시도하되, 타임아웃 시 **커밋된 테스트와 동일한 assertion을 `tsx` 하니스(`_tdd_*.ts`)로 구동**해 RED/GREEN을 관찰하고 하니스는 삭제한다. (앞선 option_grid 작업에서 검증된 우회.)

> **브랜치:** 작업은 `pro-detail-reliability-editability` 브랜치에서 진행(스펙 커밋이 이미 존재).

---

## File Structure

| 파일 | 책임 | 액션 |
|---|---|---|
| `src/lib/detail-page/layout-block-schema.ts` | LayoutBlock/ClaudeLayoutContent Zod 스키마 + `sanitizeProLayout` | Create |
| `src/__tests__/lib/detail-page/layout-block-schema.test.ts` | WS1 스키마/sanitize 단위 테스트 | Create |
| `src/app/api/ai/generate-pro-layout/route.ts` | sanitize 삽입 + rubric import 결선 | Modify |
| `src/app/api/detail-page/render/route.ts` | claude_layout content sanitize 삽입 | Modify |
| `src/lib/detail-page/section-renderer.ts` | `renderLayoutBlock` basePath+editableText+guards, `renderClaudeLayout` 경로 전달 | Modify |
| `src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts` | WS2 인라인 편집 렌더 테스트 | Modify |
| `supabase/migrations/063_detail_page_drafts.sql` | 드래프트 테이블 | Create |
| `src/app/api/detail-page/draft/route.ts` | POST upsert / GET load | Create |
| `src/__tests__/api/detail-page/draft-schema.test.ts` | 요청 스키마 단위 테스트 | Create |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 디바운스 자동저장 + 복원 배선 | Modify |

---

## WS1 — LayoutBlock 검증 + 수리

### Task 1: LayoutBlock Zod 스키마 + sanitizeProLayout

**Files:**
- Create: `src/lib/detail-page/layout-block-schema.ts`
- Test: `src/__tests__/lib/detail-page/layout-block-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/detail-page/layout-block-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { LayoutBlockSchema, sanitizeProLayout } from '@/lib/detail-page/layout-block-schema';

describe('LayoutBlockSchema', () => {
  it('유효한 option_grid 블록을 통과시킨다', () => {
    const block = { type: 'option_grid', items: [{ label: 'S', sublabel: '40cm' }] };
    expect(LayoutBlockSchema.safeParse(block).success).toBe(true);
  });

  it('items가 누락된 stat_row를 거부한다', () => {
    const block = { type: 'stat_row' };
    expect(LayoutBlockSchema.safeParse(block).success).toBe(false);
  });
});

describe('sanitizeProLayout', () => {
  it('불량 블록만 드롭하고 정상 블록은 유지한다', () => {
    const input = [
      { type: 'claude_layout', title: 'A', blocks: [
        { type: 'heading', text: '제목', size: 'xl' },
        { type: 'stat_row' }, // 불량: items 없음
      ] },
    ];
    const out = sanitizeProLayout(input);
    expect(out).toHaveLength(1);
    expect(out[0].blocks).toHaveLength(1);
    expect(out[0].blocks[0]).toMatchObject({ type: 'heading', text: '제목' });
  });

  it('모든 블록이 불량이면 그 섹션을 제거한다', () => {
    const input = [
      { type: 'claude_layout', title: 'X', blocks: [{ type: 'stat_row' }] },
      { type: 'claude_layout', title: 'Y', blocks: [{ type: 'divider' }] },
    ];
    const out = sanitizeProLayout(input);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Y');
  });

  it('배열이 아닌 입력에 throw하지 않고 빈 배열을 반환한다', () => {
    expect(sanitizeProLayout(null as unknown as unknown[])).toEqual([]);
    expect(sanitizeProLayout({} as unknown as unknown[])).toEqual([]);
  });

  it('imageSlots 등 추가 필드를 보존한다', () => {
    const input = [
      { type: 'claude_layout', title: 'A', blocks: [{ type: 'divider' }],
        imageSlots: [{ slotType: 'product_nukki', promptHint: 'x' }] },
    ];
    const out = sanitizeProLayout(input) as Array<Record<string, unknown>>;
    expect(out[0].imageSlots).toEqual([{ slotType: 'product_nukki', promptHint: 'x' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-block-schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/detail-page/layout-block-schema"` (파일 없음).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/detail-page/layout-block-schema.ts`:

```typescript
import { z } from 'zod';
import type { LayoutBlock } from '@/types/detail-page';

// LayoutBlock union의 런타임 반영. types/detail-page.ts의 LayoutBlock과 1:1.
// columns가 재귀적이므로 z.lazy 사용.
export const LayoutBlockSchema: z.ZodType<LayoutBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('badge'), text: z.string(), color: z.enum(['primary', 'accent', 'neutral']).optional() }),
    z.object({ type: z.literal('heading'), text: z.string(), size: z.enum(['xl', 'lg', 'md']), bold: z.boolean().optional(), color: z.enum(['primary', 'text', 'accent']).optional() }),
    z.object({ type: z.literal('subtext'), text: z.string(), align: z.enum(['left', 'center']).optional() }),
    z.object({ type: z.literal('image'), attachedIndex: z.number().int().min(0), width: z.string().optional(), align: z.enum(['center', 'left', 'right']).optional(), rounded: z.boolean().optional() }),
    z.object({ type: z.literal('stat_row'), items: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional() })).min(1) }),
    z.object({ type: z.literal('bullet_list'), items: z.array(z.string()).min(1), icon: z.enum(['dot', 'check', 'arrow']).optional() }),
    z.object({ type: z.literal('columns'), cols: z.array(z.array(LayoutBlockSchema)), gap: z.number().optional() }),
    z.object({ type: z.literal('divider') }),
    z.object({ type: z.literal('spacer'), height: z.number() }),
    z.object({ type: z.literal('progress_bar'), items: z.array(z.object({ label: z.string(), value: z.number(), displayValue: z.string().optional(), highlight: z.boolean().optional() })).min(1) }),
    z.object({ type: z.literal('process_flow'), direction: z.enum(['horizontal', 'vertical']).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })).min(1) }),
    z.object({ type: z.literal('icon_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ icon: z.string(), title: z.string(), subtitle: z.string().optional() })).min(1) }),
    z.object({ type: z.literal('option_grid'), cols: z.union([z.literal(2), z.literal(3)]).optional(), items: z.array(z.object({ label: z.string(), sublabel: z.string().optional(), highlight: z.boolean().optional() })).min(1) }),
    z.object({ type: z.literal('layout_bar_chart'), title: z.string().optional(), unit: z.string().optional(), groups: z.array(z.string()), groupColors: z.array(z.string()), items: z.array(z.object({ label: z.string(), values: z.array(z.number()) })).min(1), showLegend: z.boolean().optional() }),
    z.object({ type: z.literal('radar_chart'), axes: z.array(z.object({ label: z.string(), value: z.number(), max: z.number().optional() })).min(1), color: z.string().optional() }),
    z.object({ type: z.literal('timeline'), items: z.array(z.object({ stage: z.string(), icon: z.string().optional(), value: z.string().optional(), highlight: z.boolean().optional() })).min(1) }),
  ]) as unknown as z.ZodType<LayoutBlock>,
);

/**
 * PRO 레이아웃 생성 결과(unknown[])를 결정론적으로 검증·수리한다.
 * - 각 섹션의 blocks에서 스키마 통과 못 한 블록만 드롭
 * - 블록이 전부 드롭돼 빈 섹션이 되면 그 섹션 제거
 * - imageSlots 등 추가 필드는 보존
 * - 절대 throw하지 않음(비배열/오류 시 빈 배열)
 */
export function sanitizeProLayout(sections: unknown[]): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of sections) {
    if (typeof raw !== 'object' || raw === null) continue;
    const section = raw as Record<string, unknown>;
    const rawBlocks = Array.isArray(section.blocks) ? section.blocks : [];
    const goodBlocks = rawBlocks.filter((b) => LayoutBlockSchema.safeParse(b).success);
    if (goodBlocks.length === 0) continue;
    out.push({ ...section, blocks: goodBlocks });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-block-schema.test.ts`
Expected: PASS (5 tests). (vitest 타임아웃 시 tsx 하니스로 동일 assertion 관찰.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep layout-block-schema || echo "no errors"`
Expected: `no errors`

- [ ] **Step 6: Commit**

```bash
git add src/lib/detail-page/layout-block-schema.ts src/__tests__/lib/detail-page/layout-block-schema.test.ts
git commit -m "feat(detail-page): LayoutBlock Zod 스키마 + sanitizeProLayout"
```

---

### Task 2: generate-pro-layout에 sanitize 삽입 + rubric 결선

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`

- [ ] **Step 1: sanitize 적용**

`src/app/api/ai/generate-pro-layout/route.ts`에서 `sections = stripCjk(sections) as unknown[];` 다음 줄을 아래로 교체:

```typescript
    sections = stripCjk(sections) as unknown[];

    const cleaned = sanitizeProLayout(sections);
    const droppedSections = sections.length - cleaned.length;
    if (droppedSections > 0) {
      console.warn('[generate-pro-layout] sanitize: 드롭된 섹션', droppedSections);
    }

    return NextResponse.json({ success: true, sections: cleaned });
```

(기존 `return NextResponse.json({ success: true, sections });` 줄은 위 블록으로 대체된다.)

- [ ] **Step 2: import 추가**

파일 상단 import 블록에 추가:

```typescript
import { sanitizeProLayout } from '@/lib/detail-page/layout-block-schema';
import { DETAIL_PAGE_PERSONA, BLOCK_TYPE_RUBRIC } from '@/lib/ai/detail-page-rubric';
```

- [ ] **Step 3: rubric 결선 (단일 소스)**

`CLAUDE_SYSTEM`의 규칙 중 rubric과 중복되는 것을 제거하고, rubric 상수를 append한다. 3개의 구체적 편집:

(a) `CLAUDE_SYSTEM`의 첫 줄 `const CLAUDE_SYSTEM = \`You are a Korean e-commerce product detail page designer.` 를 persona로 교체:

```typescript
const CLAUDE_SYSTEM = `${DETAIL_PAGE_PERSONA}
Generate a complete page layout as a JSON array of sections for mobile (390px width).`;
```
(둘째 줄 `Generate a complete page layout...`은 기존 그대로 유지 — 위 교체는 첫 줄만 대상.)

(b) 아래 3개의 DESIGN RULES 항목을 **삭제**(rubric이 대체):
- `7. NEVER use Chinese characters (한자/漢字). ...` 로 시작하는 항목
- `8. Design for 390px mobile width — ...` 로 시작하는 항목
- `9. process_flow는 시간/순서가 있는 단계에만 ... 사이즈 안내(S/M/L 등)는 항상 option_grid입니다.` 항목

(c) `CLAUDE_SYSTEM` 템플릿 리터럴의 닫는 백틱 바로 앞에 rubric을 append:

```typescript
${BLOCK_TYPE_RUBRIC}`;
```

결과: 블록 선택 규칙·한자 금지·390px 규칙이 `detail-page-rubric.ts` 한 곳에서만 관리된다(고아 파일 → 실제 단일 소스). 블록 타입 목록/출력 JSON 형식 등 나머지 서술은 그대로 유지한다.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep generate-pro-layout || echo "no errors"`
Expected: `no errors`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/generate-pro-layout/route.ts
git commit -m "feat(detail-page): generate-pro-layout에 sanitize 삽입 + rubric 단일소스 결선"
```

---

### Task 3: render 라우트에 claude_layout sanitize 삽입

**Files:**
- Modify: `src/app/api/detail-page/render/route.ts`

- [ ] **Step 1: import 추가**

`src/app/api/detail-page/render/route.ts` 상단에 추가:

```typescript
import { sanitizeProLayout } from '@/lib/detail-page/layout-block-schema';
```

- [ ] **Step 2: 렌더 직전 claude_layout content 정화**

`const { sections, theme } = parseResult.data;` 다음에 삽입 (렌더 호출 전):

```typescript
  // claude_layout 섹션은 불량 블록이 렌더를 깨지 않도록 정화(블록 드롭)한다.
  const safeSections = sections.map((s) => {
    if (s.type !== 'claude_layout') return s;
    const [cleaned] = sanitizeProLayout([s.content]);
    // 정화 결과가 있으면 blocks만 교체, 전부 드롭됐으면 빈 blocks로.
    const content = cleaned
      ? { ...(s.content as Record<string, unknown>), blocks: (cleaned as { blocks: unknown[] }).blocks }
      : { ...(s.content as Record<string, unknown>), blocks: [] };
    return { ...s, content };
  });
```

그리고 아래 렌더 호출의 `sections`를 `safeSections`로 교체:

```typescript
    renderedSections = renderAllSections(safeSections as unknown as DetailSection[], theme as DetailPageTheme);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "detail-page/render" || echo "no errors"`
Expected: `no errors`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/detail-page/render/route.ts
git commit -m "fix(detail-page): render 라우트에서 claude_layout 불량 블록 정화"
```

---

## WS2 — claude_layout 인라인 편집

### Task 4: renderLayoutBlock basePath + editableText 배선

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Test: `src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts`의 `describe` 블록 안에 추가:

```typescript
  it('claude_layout 텍스트에 data-edit-path가 배선된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '편집 배선',
      blocks: [
        { type: 'badge', text: 'Point 1' },
        { type: 'heading', text: '핵심 제목', size: 'xl' },
        { type: 'option_grid', items: [{ label: 'S', sublabel: '40cm' }, { label: 'M', sublabel: '55cm', highlight: true }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('data-edit-path="content.blocks.0.text"');       // badge
    expect(html).toContain('data-edit-path="content.blocks.1.text"');       // heading
    expect(html).toContain('data-edit-path="content.blocks.2.items.0.label"'); // option_grid
    expect(html).toContain('data-edit-path="content.blocks.2.items.1.sublabel"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts`
Expected: FAIL — `data-edit-path="content.blocks.0.text"` 미포함 (현재 escapeHtml만 사용).

- [ ] **Step 3: 시그니처 + 호출부 변경**

`section-renderer.ts`에서 `renderLayoutBlock` 시그니처를 변경:

```typescript
function renderLayoutBlock(
  block: LayoutBlock,
  images: AttachedImage[],
  colors: PaletteColors,
  basePath: string = '',
): string {
```

`renderClaudeLayout`의 blocks 매핑을 변경:

```typescript
  const blocksHtml = (content.blocks ?? [])
    .map((b, i) => renderLayoutBlock(b, section.attachedImages, effectiveColors, `content.blocks.${i}`))
    .join('');
```

- [ ] **Step 4: 각 텍스트 블록에 editableText 배선**

아래 case들을 순서대로 교체한다(각 `escapeHtml(...)` → `editableText(path, ...)`):

**badge:**
```typescript
      return `<div style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:10px;">${editableText(`${basePath}.text`, block.text)}</div>`;
```

**heading:** 반환문의 `${escapeHtml(block.text)}` → `${editableText(`${basePath}.text`, block.text)}`

**subtext:** 반환문의 `${escapeHtml(block.text)}` → `${editableText(`${basePath}.text`, block.text)}`

**stat_row:** `.map((item) =>` → `.map((item, i) =>`, 내부:
```typescript
              <div style="font-size:44px;font-weight:900;color:${colors.accent};line-height:1.05;letter-spacing:-1px;">${editableText(`${basePath}.items.${i}.value`, item.value)}${item.unit ? `<span style="font-size:18px;font-weight:700;margin-left:2px;">${editableText(`${basePath}.items.${i}.unit`, item.unit)}</span>` : ''}</div>
              <div style="font-size:12px;color:${colors.textSub};margin-top:6px;line-height:1.4;">${editableText(`${basePath}.items.${i}.label`, item.label)}</div>
```

**bullet_list:** `.map((item) =>` → `.map((item, i) =>`, `<span>${escapeHtml(item)}</span>` → `<span>${editableText(`${basePath}.items.${i}`, item)}</span>`

**columns:** 외부 `.map((col) =>` → `.map((col, c) =>`, 내부 `col.map((b) => renderLayoutBlock(b, images, colors))` → `col.map((b, r) => renderLayoutBlock(b, images, colors, `${basePath}.cols.${c}.${r}`))`

**progress_bar:** `.map(item =>` → `.map((item, i) =>`, label/displayValue:
```typescript
            <span>${editableText(`${basePath}.items.${i}.label`, item.label)}</span>
            <span style="font-weight:700;color:${barColor};">${editableText(`${basePath}.items.${i}.displayValue`, item.displayValue ?? `${pct}%`)}</span>
```

**process_flow:** 기존 `.map((item, i) =>` 유지. `escapeHtml(item.label)` → `editableText(`${basePath}.items.${i}.label`, item.label)`, sublabel의 `escapeHtml(item.sublabel)` → `editableText(`${basePath}.items.${i}.sublabel`, item.sublabel)`

**icon_grid:** `.map(item =>` → `.map((item, i) =>`, title `escapeHtml(item.title)` → `editableText(`${basePath}.items.${i}.title`, item.title)`, subtitle `escapeHtml(item.subtitle)` → `editableText(`${basePath}.items.${i}.subtitle`, item.subtitle)`. (icon은 escapeHtml 유지.)

**option_grid:** `.map((item) =>` → `.map((item, i) =>`, label `escapeHtml(item.label)` → `editableText(`${basePath}.items.${i}.label`, item.label)`, sublabel `escapeHtml(item.sublabel)` → `editableText(`${basePath}.items.${i}.sublabel`, item.sublabel)`

(layout_bar_chart / radar_chart / timeline은 SVG·이미지라 변경하지 않음.)

- [ ] **Step 5: 방어 가드 추가 (WS1 이중 안전)**

`.items`를 접근하는 각 case(stat_row, bullet_list, progress_bar, process_flow, icon_grid, option_grid) 시작에 가드 추가:

```typescript
      if (!Array.isArray(block.items)) return '';
```

`columns`에는:
```typescript
      if (!Array.isArray(block.cols)) return '';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts`
Expected: PASS (기존 + 신규 테스트 모두). (타임아웃 시 tsx 하니스로 관찰.)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep section-renderer || echo "no errors"`
Expected: `no errors`

- [ ] **Step 8: Commit**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts
git commit -m "feat(detail-page): claude_layout 블록 인라인 편집(editableText) + 방어 가드"
```

---

## WS3 — 드래프트 영속화

### Task 5: detail_page_drafts 마이그레이션

**Files:**
- Create: `supabase/migrations/063_detail_page_drafts.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

Create `supabase/migrations/063_detail_page_drafts.sql`:

```sql
-- 상세페이지 편집 드래프트 (자동저장)
create table if not exists detail_page_drafts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  listing_id    uuid,
  product_name  text,
  sections      jsonb not null default '[]',
  theme         jsonb not null default '{}',
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists detail_page_drafts_user_updated
  on detail_page_drafts (user_id, updated_at desc);

alter table detail_page_drafts enable row level security;
create policy "본인 데이터만" on detail_page_drafts for all using (auth.uid() = user_id);
```

> 앱은 자체 JWT + service-role 클라이언트를 쓰므로 실제 접근 통제는 라우트의 `.eq('user_id', userId)`가 담당한다. RLS 정책은 기존 `assets_drafts`(062)와 동일한 방어선으로 유지한다.

- [ ] **Step 2: 마이그레이션 적용**

Supabase에 적용한다(택1):
- MCP: `apply_migration` (name: `063_detail_page_drafts`, query: 위 SQL)
- 또는 로컬 CLI: `supabase db push`

Expected: 테이블 생성 성공, 오류 없음.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/063_detail_page_drafts.sql
git commit -m "feat(detail-page): detail_page_drafts 마이그레이션 추가"
```

---

### Task 6: 드래프트 API 라우트 (POST upsert / GET load)

**Files:**
- Create: `src/app/api/detail-page/draft/route.ts`
- Test: `src/__tests__/api/detail-page/draft-schema.test.ts`

- [ ] **Step 1: Write the failing test (요청 스키마)**

Create `src/__tests__/api/detail-page/draft-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DraftUpsertSchema } from '@/app/api/detail-page/draft/route';

describe('DraftUpsertSchema', () => {
  it('id 없이(신규) sections/theme만으로 통과한다', () => {
    const body = { productName: '방석', sections: [], theme: {} };
    expect(DraftUpsertSchema.safeParse(body).success).toBe(true);
  });

  it('id가 있으면 uuid여야 한다', () => {
    const body = { id: 'not-a-uuid', sections: [], theme: {} };
    expect(DraftUpsertSchema.safeParse(body).success).toBe(false);
  });

  it('sections가 배열이 아니면 거부한다', () => {
    const body = { sections: 'x', theme: {} };
    expect(DraftUpsertSchema.safeParse(body).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api/detail-page/draft-schema.test.ts`
Expected: FAIL — `@/app/api/detail-page/draft/route` 해석 불가.

- [ ] **Step 3: 라우트 구현**

Create `src/app/api/detail-page/draft/route.ts`:

```typescript
/**
 * /api/detail-page/draft
 * POST — 상세페이지 드래프트 upsert (id 있으면 update, 없으면 insert)
 * GET  — ?id= 또는 ?listingId= 로 본인 드래프트 로드
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { sanitizeProLayout } from '@/lib/detail-page/layout-block-schema';

export const DraftUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  listingId: z.string().uuid().optional(),
  productName: z.string().max(200).optional(),
  sections: z.array(z.record(z.string(), z.unknown())),
  theme: z.record(z.string(), z.unknown()),
  thumbnailUrl: z.string().url().optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parsed = DraftUpsertSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ success: false, error: '입력값 검증 실패' }, { status: 400 });
  }
  const { id, listingId, productName, sections, theme, thumbnailUrl } = parsed.data;

  // claude_layout 섹션은 저장 전 정화(오염 저장 방지)
  const safeSections = sections.map((s) =>
    (s as { type?: string }).type === 'claude_layout'
      ? { ...s, content: sanitizeProLayout([(s as { content?: unknown }).content])[0] ?? (s as { content?: unknown }).content }
      : s,
  );

  const row = {
    user_id: userId,
    listing_id: listingId ?? null,
    product_name: productName ?? null,
    sections: safeSections,
    theme,
    thumbnail_url: thumbnailUrl ?? null,
    updated_at: new Date().toISOString(),
  };

  try {
    const supabase = getSupabaseServerClient();
    if (id) {
      const { data, error } = await supabase
        .from('detail_page_drafts')
        .update(row)
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .single();
      if (error || !data) {
        return Response.json({ success: false, error: '드래프트를 찾을 수 없거나 권한이 없습니다.' }, { status: 404 });
      }
      return Response.json({ id: (data as { id: string }).id });
    }
    const { data, error } = await supabase
      .from('detail_page_drafts')
      .insert(row)
      .select('id')
      .single();
    if (error) throw error;
    return Response.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/detail-page/draft]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const listingId = searchParams.get('listingId');
  if (!id && !listingId) {
    return Response.json({ success: false, error: 'id 또는 listingId가 필요합니다.' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from('detail_page_drafts')
      .select('id, listing_id, product_name, sections, theme, thumbnail_url, updated_at')
      .eq('user_id', userId);
    query = id ? query.eq('id', id) : query.eq('listing_id', listingId as string);

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ draft: null });

    const d = data as Record<string, unknown>;
    return Response.json({
      draft: {
        id: d.id,
        listingId: d.listing_id,
        productName: d.product_name,
        sections: d.sections,
        theme: d.theme,
        thumbnailUrl: d.thumbnail_url,
        updatedAt: d.updated_at,
      },
    });
  } catch (err) {
    console.error('[GET /api/detail-page/draft]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/api/detail-page/draft-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "detail-page/draft" || echo "no errors"`
Expected: `no errors`

- [ ] **Step 6: 수동 DB 왕복 검증**

로그인 상태에서 개발 서버로 확인:
```bash
# POST (신규) → id 반환
curl -s -X POST http://localhost:3000/api/detail-page/draft -H 'Content-Type: application/json' \
  --cookie "<auth cookie>" -d '{"productName":"테스트","sections":[],"theme":{}}'
# GET ?id=<반환 id> → draft 반환
```
Expected: POST가 `{ "id": "<uuid>" }`, GET이 저장한 draft 반환.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/detail-page/draft/route.ts src/__tests__/api/detail-page/draft-schema.test.ts
git commit -m "feat(detail-page): 드래프트 upsert/load API 라우트"
```

---

### Task 7: DetailMakerClient 자동저장 + 복원 배선

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: draftId 상태 추가**

`const [isFromPro, setIsFromPro] = useState(false);`(line 64 부근) 다음에 추가:

```typescript
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: 진입 시 복원 (listingId/draftId 우선, sessionStorage 폴백)**

sessionStorage 핸드오프 `useEffect`(line 66~) 안에서, `pro_sections`가 없을 때 URL 파라미터로 복원을 시도하도록 확장한다. 해당 effect 본문 시작에 추가:

```typescript
    const url = new URL(window.location.href);
    const qDraftId = url.searchParams.get('draftId');
    const qListingId = url.searchParams.get('listingId');
    if (qDraftId || qListingId) {
      const q = qDraftId ? `id=${qDraftId}` : `listingId=${qListingId}`;
      fetch(`/api/detail-page/draft?${q}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.draft) {
            setDraftId(j.draft.id);
            setSections(j.draft.sections ?? []);
            if (j.draft.theme && Object.keys(j.draft.theme).length > 0) setTheme(j.draft.theme);
            if (j.draft.productName) setProductName(j.draft.productName);
            setDetailStep('editing');
          }
        })
        .catch(() => {});
    }
```

(기존 sessionStorage 시드 로직은 그대로 두어, PRO 핸드오프 경로도 유지한다.)

- [ ] **Step 3: 디바운스 자동저장 effect 추가**

컴포넌트 내 다른 effect들 근처에 추가:

```typescript
  // sections/theme 변경 시 1.5s 디바운스 자동저장
  useEffect(() => {
    if (detailStep !== 'editing' || sections.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/detail-page/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId ?? undefined,
          productName: productName || undefined,
          sections,
          theme,
        }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.id) {
            setDraftId((prev) => prev ?? j.id);
            setSaveState('saved');
          } else {
            setSaveState('idle');
          }
        })
        .catch(() => setSaveState('idle'));
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sections, theme, productName, draftId, detailStep]);
```

- [ ] **Step 4: 저장 상태 표시**

편집 화면 헤더(HTML 복사/다운로드 버튼 근처, `handleHtmlCopy` 버튼이 있는 영역)에 표시 추가:

```tsx
{saveState === 'saving' && <span style={{ fontSize: 12, color: '#9ca3af' }}>저장 중…</span>}
{saveState === 'saved' && <span style={{ fontSize: 12, color: '#16a34a' }}>저장됨</span>}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep DetailMakerClient || echo "no errors"`
Expected: `no errors`

- [ ] **Step 6: 수동 검증**

개발 서버에서 PRO→편집 진입 후 텍스트를 편집하고 1.5s 뒤 "저장됨" 표시 확인 → 새로고침 시 `?draftId=<id>`로 접근하면 편집 내용이 복원되는지 확인.

- [ ] **Step 7: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-page): 드래프트 자동저장 + 복원 배선"
```

---

## 최종 통합 검증

### Task 8: 전체 타입체크 + 회귀 확인

- [ ] **Step 1: 전체 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep -E "layout-block-schema|section-renderer|detail-page/(render|draft)|generate-pro-layout|DetailMakerClient" || echo "관련 에러 없음"`
Expected: `관련 에러 없음` (기존 무관 label 컴포넌트 에러는 별개).

- [ ] **Step 2: WS1/WS2 테스트 재실행**

Run: `npx vitest run src/__tests__/lib/detail-page/layout-block-schema.test.ts src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts src/__tests__/api/detail-page/draft-schema.test.ts`
Expected: 전체 PASS. (타임아웃 시 tsx 하니스로 개별 관찰.)

- [ ] **Step 3: 렌더 회귀 확인 (기존 유효 페이지가 여전히 렌더되는지)**

기존 정상 claude_layout 섹션 샘플을 `render` 라우트 또는 `renderSection`으로 렌더해 blocks가 유지되는지 확인(정화가 정상 블록을 드롭하지 않아야 함).

- [ ] **Step 4: Commit (있으면)**

```bash
git add -A && git commit -m "chore(detail-page): 신뢰성+편집가능화 통합 검증" || echo "커밋할 변경 없음"
```

---

## 커버리지 요약 (스펙 대비)

- WS1 검증/수리: Task 1(스키마+sanitize) · Task 2(생성 결선+rubric) · Task 3(render 정화) · Task 4 Step5(렌더러 가드)
- WS2 인라인 편집: Task 4
- WS3 영속화: Task 5(마이그레이션) · Task 6(API) · Task 7(자동저장·복원)
- rubric 단일 소스화: Task 2 Step3
- 제외(YAGNI): LLM repair 1-pass, undo/history, 차트 인라인 편집, 템플릿 갤러리 — 계획에 포함하지 않음(스펙 비목표와 일치).
