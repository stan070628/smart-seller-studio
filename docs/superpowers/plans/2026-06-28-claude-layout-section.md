# Claude Layout 섹션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `claude_layout` 섹션 타입을 추가해 Claude가 JSON 블록 DSL로 레이아웃을 생성하고 Gemini/사용자 업로드 이미지에 Replicate 배경 제거를 적용한 누끼 이미지를 삽입하는 파이프라인을 구현한다.

**Architecture:** Claude가 `badge / heading / subtext / image / stat_row / bullet_list / columns / spacer` 블록 배열(JSON DSL)을 생성하고, 서버 렌더러가 이를 안전한 인라인-스타일 HTML로 조립한다. 이미지는 사용자 업로드(Replicate 배경 제거)와 Gemini 생성(Replicate 배경 제거)을 모두 지원하며, Claude JSON 생성과 이미지 처리는 단일 API 라우트에서 병렬 실행한다.

**Tech Stack:** Claude Sonnet 4.6 (JSON DSL), Gemini (`generateFrameImage`), Replicate (`removeImageBackgrounds`), Sharp, Next.js App Router API Routes, Zod, Vitest

---

## 파일 구조

| 경로 | 역할 |
|------|------|
| `src/types/detail-page.ts` | `LayoutBlock`, `ClaudeLayoutContent` 타입 추가; `SectionType`/`SectionContent`/`AttachedImage` 확장 |
| `src/app/api/ai/generate-claude-layout-section/route.ts` | 신규 — Claude JSON DSL 생성 + 이미지 처리 병렬 실행 |
| `src/lib/detail-page/section-renderer.ts` | `renderClaudeLayout()` + 블록 렌더러 추가; `SECTION_LABELS` + `renderSection` switch 확장 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `generateSceneImages()` 분기 추가 |
| `src/components/listing/detail-maker/ClaudeLayoutEditor.tsx` | 신규 — `claude_layout` 섹션 이미지 슬롯·포인트 편집 UI |
| `src/__tests__/api/generate-claude-layout-section.test.ts` | API route 단위 테스트 |
| `src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts` | 렌더러 단위 테스트 |

---

### Task 1: 타입 정의

**Files:**
- Modify: `src/types/detail-page.ts:3-20` (SectionType), `:37-41` (AttachedImage), `:159-176` (SectionContent), `:204-255` (타입가드)

- [ ] **Step 1: `SectionType`에 `claude_layout` 추가**

`src/types/detail-page.ts` line 20 (`'infographic_steps';`) 뒤에:

```typescript
export type SectionType =
  | 'hero'
  | 'selling_points'
  | 'features'
  | 'stats'
  | 'spec_table'
  | 'usage_steps'
  | 'warning'
  | 'cta'
  | 'brand_header'
  | 'point'
  | 'image_grid'
  | 'point_section'
  | 'stat_callout'
  | 'bar_chart'
  | 'why_icons'
  | 'certifications'
  | 'infographic_steps'
  | 'claude_layout';
```

- [ ] **Step 2: `AttachedImage`에 `source`, `generationHint` 추가**

```typescript
export interface AttachedImage {
  url: string;
  order: number;
  processingMode: ImageProcessingMode;
  source?: 'upload' | 'gemini';     // 이미지 출처
  generationHint?: string;           // Gemini 생성 시 설명 (예: "제품 알약 정면 흰 배경")
}
```

- [ ] **Step 3: `LayoutBlock` 타입 추가** (SectionContent union 위에 삽입)

```typescript
export type LayoutBlock =
  | { type: 'badge'; text: string; color?: 'primary' | 'accent' | 'neutral' }
  | { type: 'heading'; text: string; size: 'xl' | 'lg' | 'md'; bold?: boolean; color?: 'primary' | 'text' | 'accent' }
  | { type: 'subtext'; text: string; align?: 'left' | 'center' }
  | { type: 'image'; attachedIndex: number; width?: string; align?: 'center' | 'left' | 'right'; rounded?: boolean }
  | { type: 'stat_row'; items: Array<{ label: string; value: string; unit?: string }> }
  | { type: 'bullet_list'; items: string[]; icon?: 'dot' | 'check' | 'arrow' }
  | { type: 'columns'; cols: LayoutBlock[][]; gap?: number }
  | { type: 'divider' }
  | { type: 'spacer'; height: number }

export interface ClaudeLayoutContent {
  type: 'claude_layout';
  title: string;
  points?: string[];    // 핵심 포인트 (Claude 입력용)
  blocks: LayoutBlock[];
  bgStyle?: 'white' | 'light' | 'dark' | 'primary';
  padding?: 'normal' | 'compact' | 'wide';
}
```

- [ ] **Step 4: `SectionContent` union에 `ClaudeLayoutContent` 추가**

```typescript
export type SectionContent =
  | HeroContent
  | SellingPointsContent
  | FeaturesContent
  | StatsContent
  | SpecTableContent
  | UsageStepsContent
  | WarningContent
  | CtaContent
  | BrandHeaderContent
  | PointContent
  | ImageGridContent
  | PointSectionContent
  | StatCalloutContent
  | BarChartContent
  | WhyIconsContent
  | CertificationsContent
  | InfographicStepsContent
  | ClaudeLayoutContent;
```

- [ ] **Step 5: 타입가드 추가** (기존 `isInfographicStepsContent` 아래)

```typescript
export function isClaudeLayoutContent(c: SectionContent): c is ClaudeLayoutContent {
  return c.type === 'claude_layout';
}
```

- [ ] **Step 6: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | grep -v "node_modules\|\.next" | head -20
```

Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): add claude_layout section type with LayoutBlock DSL"
```

---

### Task 2: API Route — Claude JSON DSL + 이미지 처리

**Files:**
- Create: `src/app/api/ai/generate-claude-layout-section/route.ts`
- Test: `src/__tests__/api/generate-claude-layout-section.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/api/generate-claude-layout-section.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 순서: import 전에 vi.mock 선언
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          blocks: [
            { type: 'badge', text: 'Point 1' },
            { type: 'heading', text: '국내 최초 NMN', size: 'xl' },
          ],
          bgStyle: 'white',
          padding: 'normal',
        }) }],
      }),
    },
  }),
}));

vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: vi.fn().mockResolvedValue({
    imageBase64: 'base64data',
    mimeType: 'image/jpeg',
  }),
}));

vi.mock('@/lib/ai/remove-background', () => ({
  removeImageBackgrounds: vi.fn().mockImplementation(async (refs) => ({
    refs,
    anyRemoved: false,
  })),
}));

vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: vi.fn().mockResolvedValue([
    { base64: 'b64', mimeType: 'image/jpeg' },
  ]),
}));

// Supabase Storage 업로드 mock
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test.jpg' }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.jpg' } }),
      }),
    },
  }),
}));

import { POST } from '@/app/api/ai/generate-claude-layout-section/route';
import { NextRequest } from 'next/server';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/generate-claude-layout-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-claude-layout-section', () => {
  it('유효한 요청 — 200, blocks 반환', async () => {
    const req = makeRequest({
      title: '국내 최초 건조효모 유래 NMN',
      points: ['250mg 함유', '건조효모 유래'],
      imageSlots: [],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data.blocks)).toBe(true);
    expect(data.data.imageUrls).toEqual([]);
  });

  it('title 누락 — 400', async () => {
    const req = makeRequest({ points: [], imageSlots: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('imageSlots upload — 이미지 URL 반환', async () => {
    const req = makeRequest({
      title: '테스트',
      points: [],
      imageSlots: [{ source: 'upload', url: 'https://example.com/product.jpg' }],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.imageUrls).toHaveLength(1);
  });

  it('imageSlots gemini — Gemini 생성 후 URL 반환', async () => {
    const req = makeRequest({
      title: '테스트',
      points: [],
      imageSlots: [{ source: 'gemini', generationHint: '알약 흰 배경' }],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.imageUrls).toHaveLength(1);
  });

  it('Claude JSON 파싱 실패 — blocks: [] fallback', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'not json at all' }],
        }),
      },
    } as ReturnType<typeof getAnthropicClient>);

    const req = makeRequest({ title: '테스트', points: [], imageSlots: [] });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.blocks).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/generate-claude-layout-section.test.ts 2>&1 | tail -15
```

Expected: FAIL — "Cannot find module '@/app/api/ai/generate-claude-layout-section/route'"

- [ ] **Step 3: API Route 구현**

```typescript
// src/app/api/ai/generate-claude-layout-section/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';
import { removeImageBackgrounds } from '@/lib/ai/remove-background';
import { loadReferenceImages } from '@/lib/ai/reference-images';
import { createClient } from '@supabase/supabase-js';
import type { LayoutBlock } from '@/types/detail-page';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

const ImageSlotSchema = z.union([
  z.object({ source: z.literal('upload'), url: z.string().url() }),
  z.object({ source: z.literal('gemini'), generationHint: z.string().max(200) }),
]);

const RequestSchema = z.object({
  title: z.string().min(1).max(200),
  points: z.array(z.string().max(100)).max(8).default([]),
  sectionHint: z.string().max(400).optional(),
  imageSlots: z.array(ImageSlotSchema).max(4).default([]),
  bgStyle: z.enum(['white', 'light', 'dark', 'primary']).optional(),
});

const CLAUDE_SYSTEM = `You are a Korean e-commerce product detail page layout designer.
Generate a single section layout as JSON.

Available block types:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?: boolean, color?: 'primary'|'text'|'accent' }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N, width?: string, align?: 'center'|'left'|'right', rounded?: boolean }
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap?: number }
- divider: { type }
- spacer: { type, height: number }

Rules:
- image blocks use attachedIndex 0..N (N = imageCount-1)
- All text values must be plain strings, NO HTML tags
- Large headlines (size 'xl') for main points
- Use columns for side-by-side layouts
- Korean mobile detail page style (390px width)
- badge block for eyebrow labels like 'Point 1', 'HACCP 인증'

Return ONLY valid JSON:
{
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide"
}`;

async function uploadBase64Image(base64: string, mimeType: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const supabase = createClient(supabaseUrl, supabaseKey);
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const path = `ai-detail/${Date.now()}-claude-layout.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) return null;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-claude-layout'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { title, points, sectionHint, imageSlots } = parsed.data;

  try {
    // Claude JSON + 이미지 처리 병렬 실행
    const userPrompt = [
      `Section title: "${title}"`,
      points.length > 0 ? `Key points: ${points.map(p => `"${p}"`).join(', ')}` : '',
      sectionHint ? `Context: ${sectionHint}` : '',
      `Image slots available: ${imageSlots.length} (use attachedIndex 0..${imageSlots.length - 1})`,
    ].filter(Boolean).join('\n');

    const [claudeResult, ...imageResults] = await Promise.allSettled([
      // ① Claude JSON DSL 생성
      (async () => {
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: CLAUDE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const text = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { blocks: [] as LayoutBlock[], bgStyle: 'white' as const, padding: 'normal' as const };
        const data = JSON.parse(match[0]) as { blocks?: LayoutBlock[]; bgStyle?: string; padding?: string };
        return {
          blocks: Array.isArray(data.blocks) ? data.blocks : [] as LayoutBlock[],
          bgStyle: (['white', 'light', 'dark', 'primary'].includes(data.bgStyle ?? '') ? data.bgStyle : 'white') as 'white' | 'light' | 'dark' | 'primary',
          padding: (['normal', 'compact', 'wide'].includes(data.padding ?? '') ? data.padding : 'normal') as 'normal' | 'compact' | 'wide',
        };
      })(),

      // ② 이미지 슬롯 처리 (슬롯별 병렬)
      ...imageSlots.map(async (slot) => {
        if (slot.source === 'upload') {
          const refs = await loadReferenceImages({ productImageUrls: [slot.url] });
          if (refs.length === 0) return null;
          const { refs: cleaned } = await removeImageBackgrounds(refs);
          const ref = cleaned[0];
          if (!ref) return null;
          return uploadBase64Image(ref.base64, ref.mimeType);
        } else {
          // Gemini 생성
          const bgPrompt = `Clean product photography: ${slot.generationHint}. White background, studio lighting, no shadows, no text.`;
          const imageResult = await generateFrameImage({ imagePrompt: bgPrompt });
          const { refs: cleaned } = await removeImageBackgrounds([{
            base64: imageResult.imageBase64,
            mimeType: imageResult.mimeType,
          }]);
          const ref = cleaned[0];
          if (!ref) return null;
          return uploadBase64Image(ref.base64, ref.mimeType);
        }
      }),
    ]);

    const layout = claudeResult.status === 'fulfilled'
      ? claudeResult.value
      : { blocks: [] as LayoutBlock[], bgStyle: 'white' as const, padding: 'normal' as const };

    const imageUrls = imageResults.map(r =>
      r.status === 'fulfilled' && typeof r.value === 'string' ? r.value : null
    );

    return NextResponse.json({
      success: true,
      data: { ...layout, imageUrls },
    });
  } catch (error) {
    console.error('[generate-claude-layout-section] 오류:', error);
    if (error instanceof Error && (error.message.includes('overloaded') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      return NextResponse.json({ success: false, error: 'AI 서비스 일시 과부하' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: '레이아웃 생성 실패' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/generate-claude-layout-section.test.ts 2>&1 | tail -15
```

Expected: 5 tests passed

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules\|\.next" | head -20
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-claude-layout-section/ src/__tests__/api/generate-claude-layout-section.test.ts
git commit -m "feat(api): add generate-claude-layout-section route (Claude DSL + bg remove)"
```

---

### Task 3: section-renderer.ts — 블록 렌더러

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts`
- Test: `src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme, ClaudeLayoutContent } from '@/types/detail-page';

const DEFAULT_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#e07b54',
  accentColor: '#c45e3a',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function makeSection(content: ClaudeLayoutContent, imageUrls: string[] = []): DetailSection {
  return {
    id: 'test-1',
    type: 'claude_layout',
    content,
    attachedImages: imageUrls.map((url, i) => ({ url, order: i, processingMode: 'original' })),
  };
}

describe('renderSection — claude_layout', () => {
  it('badge + heading 블록 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '테스트 섹션',
      blocks: [
        { type: 'badge', text: 'Point 1' },
        { type: 'heading', text: '국내 최초 NMN', size: 'xl', bold: true },
      ],
      bgStyle: 'white',
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('Point 1');
    expect(html).toContain('국내 최초 NMN');
    expect(html).toContain('data-section-type="claude_layout"');
  });

  it('image 블록 — attachedImages URL 삽입', () => {
    const section = makeSection(
      {
        type: 'claude_layout',
        title: '이미지 섹션',
        blocks: [{ type: 'image', attachedIndex: 0, width: '80%', align: 'center' }],
      },
      ['https://example.com/product.jpg'],
    );
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('https://example.com/product.jpg');
  });

  it('stat_row 블록 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '통계',
      blocks: [
        { type: 'stat_row', items: [{ label: 'NMN 함유량', value: '250', unit: 'mg' }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('250');
    expect(html).toContain('mg');
    expect(html).toContain('NMN 함유량');
  });

  it('XSS 방어 — 텍스트 값 escapeHtml 적용', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '안전 테스트',
      blocks: [{ type: 'heading', text: '<script>alert(1)</script>', size: 'xl' }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('image 블록 — attachedIndex 범위 초과 시 빈 렌더링', () => {
    const section = makeSection(
      {
        type: 'claude_layout',
        title: '이미지 없음',
        blocks: [{ type: 'image', attachedIndex: 5 }],
      },
      [],  // attachedImages 비어 있음
    );
    const html = renderSection(section, DEFAULT_THEME);
    // img 태그 없어야 함
    expect(html).not.toContain('<img');
  });

  it('columns 블록 — 2열 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '2열 레이아웃',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'heading', text: '왼쪽', size: 'md' }],
            [{ type: 'heading', text: '오른쪽', size: 'md' }],
          ],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('왼쪽');
    expect(html).toContain('오른쪽');
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts 2>&1 | tail -10
```

Expected: FAIL (renderSection이 claude_layout을 처리 못함)

- [ ] **Step 3: section-renderer.ts — import 추가** (line 26 `InfographicStepsContent` 뒤)

```typescript
import type {
  // ... 기존 imports ...
  InfographicStepsContent,
  ClaudeLayoutContent,
  LayoutBlock,
  AttachedImage,
} from '@/types/detail-page';
```

- [ ] **Step 4: SECTION_LABELS에 `claude_layout` 추가** (line 53-71 객체)

```typescript
const SECTION_LABELS: Record<DetailSection['type'], string> = {
  // ... 기존 항목 ...
  infographic_steps: '사용법 인포그래픽',
  claude_layout: 'AI 레이아웃',
};
```

- [ ] **Step 5: 블록 렌더러 함수 추가** (`renderInfographicSteps` 함수 뒤, `renderSection` 함수 전)

```typescript
// ─────────────────────────────────────────
// claude_layout 블록 렌더러
// ─────────────────────────────────────────

function resolveBgColor(bgStyle: ClaudeLayoutContent['bgStyle'], colors: PaletteColors): string {
  switch (bgStyle) {
    case 'light':   return colors.cardBg;
    case 'dark':    return '#1e293b';
    case 'primary': return colors.primary;
    default:        return colors.bg;  // 'white' or undefined
  }
}

function resolvePad(padding: ClaudeLayoutContent['padding']): string {
  switch (padding) {
    case 'compact': return '24px 16px';
    case 'wide':    return '56px 28px';
    default:        return '40px 24px';  // 'normal'
  }
}

function renderLayoutBlock(
  block: LayoutBlock,
  images: AttachedImage[],
  colors: PaletteColors,
): string {
  switch (block.type) {
    case 'badge': {
      const bg = block.color === 'accent' ? colors.accent : block.color === 'neutral' ? '#e2e8f0' : colors.primary;
      const fg = block.color === 'neutral' ? '#334155' : '#fff';
      return `<div style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:10px;">${escapeHtml(block.text)}</div>`;
    }
    case 'heading': {
      const sz = block.size === 'xl' ? '28px' : block.size === 'lg' ? '22px' : '18px';
      const fw = block.bold !== false ? '800' : '600';
      const color = block.color === 'primary' ? colors.primary : block.color === 'accent' ? colors.accent : colors.text;
      return `<div style="font-size:${sz};font-weight:${fw};color:${color};line-height:1.25;margin-bottom:8px;">${editableText(`blocks.heading.${escapeHtml(block.text.slice(0, 20))}`, block.text)}</div>`;
    }
    case 'subtext': {
      const align = block.align === 'center' ? 'center' : 'left';
      return `<div style="font-size:14px;color:${colors.textSub};line-height:1.6;text-align:${align};margin-bottom:8px;">${editableText(`blocks.subtext.${escapeHtml(block.text.slice(0, 20))}`, block.text)}</div>`;
    }
    case 'image': {
      const img = images[block.attachedIndex];
      if (!img?.url) return '';
      const safeUrl = sanitizeUrl(img.url);
      if (!safeUrl) return '';
      const width = block.width ?? '100%';
      const align = block.align === 'left' ? 'flex-start' : block.align === 'right' ? 'flex-end' : 'center';
      const radius = block.rounded ? 'border-radius:12px;' : '';
      return `<div style="display:flex;justify-content:${align};margin-bottom:12px;"><img src="${escapeHtml(safeUrl)}" alt="" style="width:${escapeHtml(width)};max-width:100%;object-fit:contain;${radius}" /></div>`;
    }
    case 'stat_row': {
      const items = block.items.map(item =>
        `<div style="text-align:center;flex:1;">
          <div style="font-size:22px;font-weight:900;color:${colors.primary};line-height:1.1;">${escapeHtml(item.value)}${item.unit ? `<span style="font-size:13px;font-weight:600;">${escapeHtml(item.unit)}</span>` : ''}</div>
          <div style="font-size:11px;color:${colors.textSub};margin-top:2px;">${escapeHtml(item.label)}</div>
        </div>`
      ).join('');
      return `<div style="display:flex;gap:8px;padding:16px 0;margin-bottom:8px;">${items}</div>`;
    }
    case 'bullet_list': {
      const icon = block.icon === 'check' ? '✓' : block.icon === 'arrow' ? '→' : '•';
      const items = block.items.map(item =>
        `<li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:14px;color:${colors.text};line-height:1.5;">
          <span style="color:${colors.primary};flex-shrink:0;font-weight:700;">${icon}</span>
          <span>${escapeHtml(item)}</span>
        </li>`
      ).join('');
      return `<ul style="list-style:none;margin:0 0 12px;padding:0;">${items}</ul>`;
    }
    case 'columns': {
      const gap = block.gap ?? 12;
      const cols = block.cols.map(col => {
        const inner = col.map(b => renderLayoutBlock(b, images, colors)).join('');
        return `<div style="flex:1;min-width:0;">${inner}</div>`;
      }).join('');
      return `<div style="display:flex;gap:${gap}px;align-items:flex-start;margin-bottom:8px;">${cols}</div>`;
    }
    case 'divider':
      return `<hr style="border:none;border-top:1px solid ${colors.border};margin:12px 0;" />`;
    case 'spacer':
      return `<div style="height:${Math.min(block.height, 120)}px;"></div>`;
    default:
      return '';
  }
}

function renderClaudeLayout(
  content: ClaudeLayoutContent,
  section: DetailSection,
  colors: PaletteColors,
): string {
  const bg = resolveBgColor(content.bgStyle, colors);
  const pad = resolvePad(content.padding);
  const blocksHtml = content.blocks
    .map(b => renderLayoutBlock(b, section.attachedImages, colors))
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:${bg};padding:${pad};width:100%;box-sizing:border-box;">${blocksHtml}</div>`;
}
```

- [ ] **Step 6: `renderSection` switch에 `claude_layout` 추가** (line 559 `infographic_steps` case 뒤)

```typescript
case 'claude_layout':
  return renderClaudeLayout(section.content as ClaudeLayoutContent, section, colors);
```

- [ ] **Step 7: 테스트 실행 — PASS 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts 2>&1 | tail -10
```

Expected: 6 tests passed

- [ ] **Step 8: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules\|\.next" | head -20
```

- [ ] **Step 9: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts
git commit -m "feat(renderer): add renderClaudeLayout block renderer"
```

---

### Task 4: DetailMakerClient.tsx — generateSceneImages() 분기

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: import에 `isClaudeLayoutContent`, `ClaudeLayoutContent` 추가** (line 14)

기존:
```typescript
import { isPointContent, isImageGridContent, type ImageGridContent, type DetailSection, type DetailPageTheme, type CreativeBrief, type SceneStoryboardItem } from '@/types/detail-page';
```

변경:
```typescript
import { isPointContent, isImageGridContent, isClaudeLayoutContent, type ImageGridContent, type ClaudeLayoutContent, type LayoutBlock, type DetailSection, type DetailPageTheme, type CreativeBrief, type SceneStoryboardItem } from '@/types/detail-page';
```

- [ ] **Step 2: `targets` 필터에 `claude_layout` 추가** (line 278-280)

```typescript
const targets = sectionsSnapshot.filter(
  s => s.type === 'hero' || s.type === 'point' || s.type === 'image_grid' || s.type === 'claude_layout'
);
```

- [ ] **Step 3: `claude_layout` 분기 추가** (`image_grid` 분기 (`if (section.type === 'image_grid')`) 바로 위에 삽입)

```typescript
if (section.type === 'claude_layout') {
  const content = section.content as ClaudeLayoutContent;
  const imageSlots = section.attachedImages.map(img => (
    img.source === 'gemini'
      ? { source: 'gemini' as const, generationHint: img.generationHint ?? content.title }
      : { source: 'upload' as const, url: img.url }
  ));

  const layoutRes = await fetch('/api/ai/generate-claude-layout-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: content.title,
      points: content.points ?? [],
      imageSlots,
    }),
  });
  if (!layoutRes.ok) return null;

  const layoutData = await layoutRes.json() as {
    success: boolean;
    data?: { blocks: LayoutBlock[]; bgStyle: ClaudeLayoutContent['bgStyle']; padding: ClaudeLayoutContent['padding']; imageUrls: (string | null)[] };
  };
  if (!layoutData.success || !layoutData.data) return null;

  return {
    sectionId: section.id,
    url: layoutData.data.imageUrls[0] ?? '',  // upload 라우트 재사용 불필요 — 이미 URL
    sceneId: undefined,
    claudeBlocks: layoutData.data.blocks,
    claudeBgStyle: layoutData.data.bgStyle,
    claudePadding: layoutData.data.padding,
    claudeImageUrls: layoutData.data.imageUrls,
  };
}
```

- [ ] **Step 4: `UrlUpdate` 타입에 Claude 필드 추가** (line 443-448 `type UrlUpdate` 블록)

```typescript
type UrlUpdate = {
  sectionId: string;
  url: string;
  sceneId: string | undefined;
  points?: string[];
  claudeBlocks?: LayoutBlock[];
  claudeBgStyle?: ClaudeLayoutContent['bgStyle'];
  claudePadding?: ClaudeLayoutContent['padding'];
  claudeImageUrls?: (string | null)[];
};
```

- [ ] **Step 5: `setSections` 내 content 업데이트에 claude_layout 분기 추가** (line 463-468 `newContent` 블록)

```typescript
const newContent =
  isClaudeLayoutContent(s.content) && hit.claudeBlocks
    ? {
        ...s.content,
        blocks: hit.claudeBlocks,
        bgStyle: hit.claudeBgStyle ?? s.content.bgStyle,
        padding: hit.claudePadding ?? s.content.padding,
      }
    : isImageGridContent(s.content) && hit.points
      ? { ...s.content, points: hit.points }
      : isPointContent(s.content) && matchedScene?.textPosition
        ? { ...s.content, textPosition: matchedScene.textPosition }
        : s.content;
```

- [ ] **Step 6: `attachedImages` 업데이트 시 claude_layout 이미지 URL 반영** (line 469-473 `return { ...s, ... }` 블록)

```typescript
return {
  ...s,
  content: newContent,
  attachedImages: isClaudeLayoutContent(s.content) && hit.claudeImageUrls
    ? hit.claudeImageUrls
        .map((url, i) => url
          ? { ...s.attachedImages[i], url, order: i, processingMode: 'bg_removed' as const }
          : s.attachedImages[i]
        )
        .filter(Boolean)
    : [{ url: hit.url, order: 0, processingMode: 'original' as const }],
};
```

- [ ] **Step 7: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules\|\.next" | head -20
```

Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): add claude_layout branch to generateSceneImages"
```

---

### Task 5: ClaudeLayoutEditor 컴포넌트 — 이미지 슬롯·포인트 편집 UI

**Files:**
- Create: `src/components/listing/detail-maker/ClaudeLayoutEditor.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/listing/detail-maker/ClaudeLayoutEditor.tsx
'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';
import type { DetailSection, ClaudeLayoutContent, AttachedImage } from '@/types/detail-page';

interface Props {
  section: DetailSection;
  onUpdate: (updates: Partial<ClaudeLayoutContent> & { attachedImages?: AttachedImage[] }) => void;
  onUploadFile: (file: File) => Promise<string>;  // 파일 업로드 → URL 반환
}

export default function ClaudeLayoutEditor({ section, onUpdate, onUploadFile }: Props) {
  const content = section.content as ClaudeLayoutContent;

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onUpdate({ title: e.target.value });
  }

  function handlePointChange(idx: number, value: string) {
    const points = [...(content.points ?? [])];
    points[idx] = value;
    onUpdate({ points });
  }

  function addPoint() {
    onUpdate({ points: [...(content.points ?? []), ''] });
  }

  function removePoint(idx: number) {
    const points = (content.points ?? []).filter((_, i) => i !== idx);
    onUpdate({ points });
  }

  function handleSlotSourceChange(idx: number, source: 'upload' | 'gemini') {
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, source, url: source === 'gemini' ? '' : img.url } : img
    );
    onUpdate({ attachedImages: images });
  }

  function handleSlotHintChange(idx: number, hint: string) {
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, generationHint: hint } : img
    );
    onUpdate({ attachedImages: images });
  }

  async function handleSlotUpload(idx: number, file: File) {
    const url = await onUploadFile(file);
    const images = section.attachedImages.map((img, i) =>
      i === idx ? { ...img, url, source: 'upload' as const } : img
    );
    onUpdate({ attachedImages: images });
  }

  function addImageSlot() {
    const newSlot: AttachedImage = { url: '', order: section.attachedImages.length, processingMode: 'original', source: 'gemini', generationHint: '' };
    onUpdate({ attachedImages: [...section.attachedImages, newSlot] });
  }

  function removeImageSlot(idx: number) {
    const images = section.attachedImages.filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, order: i }));
    onUpdate({ attachedImages: images });
  }

  const BRAND_PURPLE = '#7c3aed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 섹션 제목 */}
      <div>
        <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 4 }}>섹션 제목</label>
        <input
          value={content.title}
          onChange={handleTitleChange}
          placeholder="예: 국내 최초 건조효모 유래 NMN"
          style={{ width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: '#111', background: '#fff', boxSizing: 'border-box' }}
        />
      </div>

      {/* 핵심 포인트 */}
      <div>
        <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 6 }}>핵심 포인트</label>
        {(content.points ?? []).map((pt, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              value={pt}
              onChange={e => handlePointChange(idx, e.target.value)}
              placeholder={`포인트 ${idx + 1}`}
              style={{ flex: 1, padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: '#111', background: '#fff' }}
            />
            <button onClick={() => removePoint(idx)} style={{ padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', color: C.textMuted, fontSize: 12 }}>✕</button>
          </div>
        ))}
        <button
          onClick={addPoint}
          style={{ fontSize: 12, color: BRAND_PURPLE, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
        >
          + 포인트 추가
        </button>
      </div>

      {/* 이미지 슬롯 */}
      <div>
        <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 6 }}>이미지 슬롯 (최대 4개)</label>
        {section.attachedImages.map((img, idx) => (
          <div key={idx} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8, background: C.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>슬롯 {idx + 1}</span>
              <button onClick={() => removeImageSlot(idx)} style={{ fontSize: 11, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>제거</button>
            </div>
            {/* source 토글 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['upload', 'gemini'] as const).map(src => (
                <button
                  key={src}
                  onClick={() => handleSlotSourceChange(idx, src)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: img.source === src ? BRAND_PURPLE : '#fff',
                    color: img.source === src ? '#fff' : C.textMuted,
                    border: `1px solid ${img.source === src ? BRAND_PURPLE : C.border}`,
                  }}
                >
                  {src === 'upload' ? '직접 업로드' : 'Gemini 생성'}
                </button>
              ))}
            </div>

            {img.source === 'gemini' ? (
              <input
                value={img.generationHint ?? ''}
                onChange={e => handleSlotHintChange(idx, e.target.value)}
                placeholder="예: 알약 흰 배경 정면 사진"
                style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, color: '#111', background: '#fff', boxSizing: 'border-box' }}
              />
            ) : (
              <div>
                {img.url && (
                  <img src={img.url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }} />
                )}
                <label style={{ display: 'inline-block', padding: '6px 12px', background: '#f1f5f9', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', color: C.text }}>
                  파일 선택
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.[0]) handleSlotUpload(idx, e.target.files[0]); }}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
        {section.attachedImages.length < 4 && (
          <button
            onClick={addImageSlot}
            style={{ fontSize: 12, color: BRAND_PURPLE, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
          >
            + 이미지 슬롯 추가
          </button>
        )}
      </div>

      {/* bgStyle 선택 */}
      <div>
        <label style={{ fontSize: 11, color: C.textMuted, display: 'block', marginBottom: 6 }}>배경 스타일</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['white', 'light', 'dark', 'primary'] as const).map(style => (
            <button
              key={style}
              onClick={() => onUpdate({ bgStyle: style })}
              style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                background: content.bgStyle === style ? BRAND_PURPLE : '#fff',
                color: content.bgStyle === style ? '#fff' : C.textMuted,
                border: `1px solid ${content.bgStyle === style ? BRAND_PURPLE : C.border}`,
              }}
            >
              {{ white: '흰색', light: '연한', dark: '어두운', primary: '브랜드' }[style]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules\|\.next" | head -20
```

Expected: 오류 없음

- [ ] **Step 3: 전체 테스트 실행**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/generate-claude-layout-section.test.ts src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts 2>&1 | tail -10
```

Expected: 11 tests passed (5 + 6)

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/detail-maker/ClaudeLayoutEditor.tsx
git commit -m "feat(ui): add ClaudeLayoutEditor component for image slot and point editing"
```

---

## 전체 검증

- [ ] `npx vitest run src/__tests__/api/generate-claude-layout-section.test.ts src/__tests__/lib/detail-page/section-renderer-claude-layout.test.ts` → 11 tests passed
- [ ] `npx tsc --noEmit` → 오류 없음
- [ ] detail-maker에서 `claude_layout` 섹션의 "이미지 생성" 버튼 클릭 → Claude JSON 생성 + 이미지 처리 동작 확인
- [ ] 렌더링 결과에 누끼 이미지 + 블록 텍스트가 올바르게 표시되는지 확인
