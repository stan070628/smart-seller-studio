# Image Grid 씬 변환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `image_grid` 섹션의 원본 이미지를 Claude OCR + Gemini 배경 이미지 + 텍스트 오버레이 HTML로 교체해 지재권 문제를 해소한다.

**Architecture:** 신규 API route(`/api/ai/generate-image-grid-scene`)가 Claude로 이미지에서 핵심 포인트를 추출하고 Gemini로 배경 이미지를 생성한다. `generateSceneImages()`가 `image_grid` 섹션도 대상으로 포함해 배경 이미지 URL과 추출된 포인트를 섹션에 저장하고, `renderImageGrid()`가 배경 이미지 위에 Point 스타일 텍스트 오버레이 HTML을 렌더링한다.

**Tech Stack:** Next.js App Router API Routes, Anthropic Claude SDK(`claude-sonnet-4-6` Vision), Gemini(`generateFrameImage` 재사용), Zod, Vitest

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/types/detail-page.ts` | `ImageGridContent`에 `points?: string[]` 추가 |
| `src/app/api/ai/generate-image-grid-scene/route.ts` | 신규 — Claude OCR + Gemini 배경 생성 API |
| `src/__tests__/api/generate-image-grid-scene.test.ts` | 신규 API 단위 테스트 |
| `src/lib/detail-page/section-renderer.ts` | `renderImageGrid()` — points 있으면 오버레이 HTML |
| `src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts` | 오버레이 렌더링 단위 테스트 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `generateSceneImages()` — image_grid 분기 추가 |

---

### Task 1: `ImageGridContent` 타입 확장

**Files:**
- Modify: `src/types/detail-page.ts:98-102`

- [ ] **Step 1: `points?` 필드 추가**

`src/types/detail-page.ts:98-102`의 `ImageGridContent`를:

```typescript
export interface ImageGridContent {
  type: 'image_grid';
  title: string;
  items: Array<{ label: string; swatchColor?: string }>;
  points?: string[];  // Claude OCR 추출 포인트 (있으면 오버레이 렌더링)
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): add points field to ImageGridContent"
```

---

### Task 2: 신규 API route — Claude OCR + Gemini 배경

**Files:**
- Create: `src/app/api/ai/generate-image-grid-scene/route.ts`
- Create: `src/__tests__/api/generate-image-grid-scene.test.ts`

#### 배경 지식

- 인증: `requireAuth(req)` — `src/lib/supabase/auth.ts`
- Rate limit: `checkRateLimit`, `getRateLimitKey` — `src/lib/rate-limit.ts`
- Claude 클라이언트: `getAnthropicClient()` — `src/lib/ai/claude.ts`
- Gemini 이미지 생성: `generateFrameImage({ imagePrompt })` — `src/lib/ai/imagen.ts`
- Claude Vision URL 방식: `{ type: 'image', source: { type: 'url', url } }` — `Anthropic.ImageBlockParam` 타입

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/generate-image-grid-scene.test.ts` 파일 생성:

```typescript
/**
 * generate-image-grid-scene route 단위 테스트
 * Claude/Gemini는 vi.mock으로 대체한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// requireAuth는 항상 통과 처리
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}));

// rate limit은 항상 허용
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('test-key'),
}));

// Claude 클라이언트 mock
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"points":["포인트1","포인트2","포인트3"]}' }],
      }),
    },
  }),
}));

// Gemini 이미지 생성 mock
vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: vi.fn().mockResolvedValue({
    imageBase64: 'base64-bg-image',
    mimeType: 'image/jpeg',
  }),
}));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/generate-image-grid-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-image-grid-scene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('유효한 요청 시 points와 배경 이미지 base64 반환', async () => {
    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.points).toEqual(['포인트1', '포인트2', '포인트3']);
    expect(data.data.imageBase64).toBe('base64-bg-image');
    expect(data.data.mimeType).toBe('image/jpeg');
  });

  it('imageUrls가 빈 배열이면 400 반환', async () => {
    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({ imageUrls: [], title: '제품 특징' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('Claude OCR 실패 시 points=[]로 fallback하고 Gemini는 계속 실행', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: { create: vi.fn().mockRejectedValue(new Error('Claude overloaded')) },
    } as never);

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.points).toEqual([]);
    expect(data.data.imageBase64).toBe('base64-bg-image');
  });

  it('Gemini 실패 시 500 반환', async () => {
    const { generateFrameImage } = await import('@/lib/ai/imagen');
    vi.mocked(generateFrameImage).mockRejectedValueOnce(new Error('Gemini error'));

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('Claude가 JSON이 아닌 텍스트 반환 시 points=[] fallback', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sorry, I cannot help' }] }) },
    } as never);

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(data.data.points).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/generate-image-grid-scene.test.ts
```

Expected: FAIL — "Cannot find module '@/app/api/ai/generate-image-grid-scene/route'"

- [ ] **Step 3: API route 구현**

`src/app/api/ai/generate-image-grid-scene/route.ts` 생성:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateFrameImage } from '@/lib/ai/imagen';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 4 };

const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(6),
  title: z.string(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-image-grid-scene'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
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

  const { imageUrls, title } = parsed.data;

  try {
    // Step 1: Claude OCR — 이미지에서 핵심 포인트 추출 (실패해도 계속)
    let points: string[] = [];
    try {
      const anthropic = getAnthropicClient();
      const imageBlocks: Anthropic.ImageBlockParam[] = imageUrls.slice(0, 4).map(url => ({
        type: 'image' as const,
        source: { type: 'url' as const, url },
      }));

      const ocrRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: `You are a product detail page analyst.
Extract the key selling points or product information visible in the image(s).
Return JSON: { "points": ["point1", "point2", ...] }
- Extract 3-6 concise Korean or English bullet points
- Focus on product features, specifications, or benefits visible in the image
- If no readable text: infer key features from the visual content
- Each point: max 25 characters`,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: `Section title: "${title}". Extract key points.` },
          ],
        }],
      });

      const rawText = ocrRes.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed2 = JSON.parse(jsonMatch[0]) as { points?: string[] };
        points = Array.isArray(parsed2.points) ? parsed2.points : [];
      }
    } catch (e) {
      console.warn('[generate-image-grid-scene] OCR 실패, points=[]:', e);
    }

    // Step 2: Gemini 배경 이미지 생성
    const bgPrompt = `Clean, professional e-commerce product detail background for "${title}". Subtle, elegant lifestyle setting — soft gradient, minimal props, neutral tones. No text, no products, no people. High-end commercial photography backdrop. SINGLE FRAME ONLY.`;

    const imageResult = await generateFrameImage({ imagePrompt: bgPrompt });

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: imageResult.imageBase64,
        mimeType: imageResult.mimeType,
        points,
      },
    });
  } catch (error) {
    console.error('[/api/ai/generate-image-grid-scene] 오류:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '이미지 생성에 실패했습니다.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/generate-image-grid-scene.test.ts
```

Expected: PASS (5/5)

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-image-grid-scene/route.ts src/__tests__/api/generate-image-grid-scene.test.ts
git commit -m "feat(api): add generate-image-grid-scene route (Claude OCR + Gemini background)"
```

---

### Task 3: `renderImageGrid()` 오버레이 HTML

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts:397-419`
- Create: `src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts`

#### 배경 지식

- `escapeHtml(str)`: `src/lib/detail-page/section-renderer.ts:35` — 파일 내부 함수 (export 없음, 테스트에서는 직접 확인)
- `sanitizeUrl(url)`: `src/lib/detail-page/section-renderer.ts:44` — 파일 내부 함수
- 기존 `renderImageGrid`는 `attachedImages[i]`를 그리드로 나열 — `points` 없으면 이 로직 그대로 유지
- `sectionAttrs(section)` — 섹션 data 속성 생성 헬퍼 (기존 렌더링 경로에서 유지)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts` 생성:

```typescript
/**
 * renderImageGrid 오버레이 HTML 단위 테스트
 * section-renderer.ts의 renderSection(section, theme)을 통해 간접 테스트한다.
 */
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, ImageGridContent } from '@/types/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';

function makeSection(content: ImageGridContent, attachedImages: { url: string; order: number; processingMode: 'original' }[] = []): DetailSection {
  return {
    id: 'test-section-1',
    type: 'image_grid',
    content,
    attachedImages,
  } as DetailSection;
}

describe('renderImageGrid — points 오버레이', () => {
  it('points가 있으면 배경 이미지 + 그라디언트 오버레이 HTML 생성', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '제품 특징',
      items: [],
      points: ['포인트 1', '포인트 2'],
    };
    const section = makeSection(content, [{ url: 'https://cdn.example.com/bg.jpg', order: 0, processingMode: 'original' }]);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('position:absolute');
    expect(html).toContain('linear-gradient');
    expect(html).toContain('포인트 1');
    expect(html).toContain('포인트 2');
    expect(html).toContain('제품 특징');
    expect(html).toContain('cdn.example.com/bg.jpg');
    // 기존 그리드 구조(display:flex;flex-wrap:wrap)는 없어야 함
    expect(html).not.toContain('flex-wrap:wrap');
  });

  it('points가 없으면 기존 그리드 HTML 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '색상 선택',
      items: [{ label: '빨강', swatchColor: '#ff0000' }],
    };
    const section = makeSection(content, [{ url: 'https://cdn.example.com/red.jpg', order: 0, processingMode: 'original' }]);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('빨강');
  });

  it('points가 빈 배열이면 기존 그리드 HTML 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '색상 선택',
      items: [{ label: '빨강' }],
      points: [],
    };
    const section = makeSection(content);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('flex-wrap:wrap');
  });

  it('XSS 방어: points 텍스트의 < > & 가 이스케이프됨', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '<script>alert(1)</script>',
      items: [],
      points: ['<b>포인트</b>', 'A & B'],
    };
    const section = makeSection(content);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>포인트</b>');
    expect(html).toContain('&lt;b&gt;포인트&lt;/b&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('배경 이미지 URL 없으면 img 태그 없이 오버레이만 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '제품 특징',
      items: [],
      points: ['포인트 1'],
    };
    const section = makeSection(content, []); // attachedImages 없음

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('포인트 1');
    expect(html).not.toContain('<img');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts
```

Expected: FAIL — points 오버레이 HTML이 아직 구현되지 않음

- [ ] **Step 3: `renderImageGrid()` 수정**

`src/lib/detail-page/section-renderer.ts:397-419`의 `renderImageGrid` 함수를 아래로 교체:

```typescript
function renderImageGrid(content: ImageGridContent, section: DetailSection, colors: PaletteColors): string {
  // points가 있으면 배경 이미지 + Point 스타일 오버레이 렌더링
  if (content.points && content.points.length > 0) {
    const bgUrl = section.attachedImages[0]?.url ?? '';
    const safeUrl = bgUrl ? sanitizeUrl(bgUrl) : '';
    const escapedTitle = escapeHtml(content.title);
    const bulletItems = content.points
      .map(p => `<li style="margin-bottom:6px;font-size:14px;line-height:1.4;">${escapeHtml(p)}</li>`)
      .join('');

    return `<div ${sectionAttrs(section)} style="position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;">
  ${safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />` : ''}
  <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);padding:24px 20px 20px;color:#fff;">
    ${escapedTitle ? `<p style="margin:0 0 10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${escapedTitle}</p>` : ''}
    <ul style="margin:0;padding-left:16px;">${bulletItems}</ul>
  </div>
</div>`;
  }

  // fallback: 기존 그리드 렌더링 (points 없는 경우)
  const titleHtml = content.title
    ? `<h2 style="margin:0 0 24px;font-family:Georgia,serif;font-size:26px;font-weight:400;color:${colors.textSub};text-align:center;">${editableText('content.title', content.title)}</h2>`
    : '';
  const cells = content.items
    .map((item, i) => {
      const img = section.attachedImages[i];
      const safe = img ? sanitizeUrl(img.url) : '';
      const imgHtml = safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;border-radius:8px;" />` : '';
      const swatchHtml = item.swatchColor !== undefined
        ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background-color:${sanitizeSwatchColor(item.swatchColor)};margin-right:6px;vertical-align:-2px;"></span>`
        : '';
      const labelHtml = item.label
        ? `<div style="margin-top:8px;font-size:15px;color:${colors.text};">${swatchHtml}${editableText(`content.items.${i}.label`, item.label)}</div>`
        : '';
      return `<div style="width:50%;padding:8px;box-sizing:border-box;text-align:center;">${imgHtml}${labelHtml}</div>`;
    })
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 12px;box-sizing:border-box;">
  ${titleHtml}
  <div style="display:flex;flex-wrap:wrap;">${cells}</div>
</div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts
```

Expected: PASS (5/5)

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts
git commit -m "feat(renderer): renderImageGrid overlay HTML when points present"
```

---

### Task 4: `DetailMakerClient.tsx` — `generateSceneImages()` 확장

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

**주의:** 이 파일은 React 클라이언트 컴포넌트라 단위 테스트 대신 TypeScript 컴파일 + 수동 동작 확인으로 검증한다.

- [ ] **Step 1: import에 `isImageGridContent`, `ImageGridContent` 추가**

`src/app/listing/detail-maker/DetailMakerClient.tsx:14`를:

```typescript
// 변경 전
import { isPointContent, type DetailSection, type DetailPageTheme, type CreativeBrief, type SceneStoryboardItem } from '@/types/detail-page';

// 변경 후
import { isPointContent, isImageGridContent, type ImageGridContent, type DetailSection, type DetailPageTheme, type CreativeBrief, type SceneStoryboardItem } from '@/types/detail-page';
```

- [ ] **Step 2: targets에 `image_grid` 추가**

`DetailMakerClient.tsx:278`를:

```typescript
// 변경 전
const targets = sectionsSnapshot.filter(s => s.type === 'hero' || s.type === 'point');

// 변경 후
const targets = sectionsSnapshot.filter(
  s => s.type === 'hero' || s.type === 'point' || s.type === 'image_grid'
);
```

- [ ] **Step 3: `extractedPoints` 변수 선언 추가**

`let imageBase64: string;` 선언과 함께 있는 줄(line 311 근처)에 추가:

```typescript
let imageBase64: string;
let mimeType: string;
let extractedPoints: string[] | undefined;  // ← 이 줄 추가
```

- [ ] **Step 4: image_grid 분기 추가**

`if (section.type === 'hero' && storyboardScene?.mode !== 'cleanup') {` 줄 **바로 위**에 아래 블록 삽입:

```typescript
if (section.type === 'image_grid') {
  const gridImageUrls = section.attachedImages.map(img => img.url).filter(Boolean);
  if (gridImageUrls.length === 0) return null;

  const gridTitle = (section.content as ImageGridContent).title;
  const gridRes = await fetch('/api/ai/generate-image-grid-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls: gridImageUrls, title: gridTitle }),
  });
  if (!gridRes.ok) return null;

  const gridData = await gridRes.json() as {
    success: boolean;
    data?: { imageBase64: string; mimeType: string; points: string[] };
  };
  if (!gridData.success || !gridData.data) return null;

  imageBase64 = gridData.data.imageBase64;
  mimeType = gridData.data.mimeType;
  extractedPoints = gridData.data.points;
} else if (section.type === 'hero' && storyboardScene?.mode !== 'cleanup') {
```

**주의:** 기존 `if (section.type === 'hero' && storyboardScene?.mode !== 'cleanup') {` 를 `} else if (...)` 로 변경해야 한다.

- [ ] **Step 5: return 문에 `points` 추가**

`return { sectionId: section.id, url: uploadData.url, sceneId: storyboardScene?.id };` 를:

```typescript
return { sectionId: section.id, url: uploadData.url, sceneId: storyboardScene?.id, points: extractedPoints };
```

- [ ] **Step 6: `urlUpdates` 타입 가드 수정**

`const urlUpdates = results` 블록(line 419-423)을:

```typescript
type UrlUpdate = {
  sectionId: string;
  url: string;
  sceneId: string | undefined;
  points?: string[];
};

const urlUpdates = results
  .filter((r): r is PromiseFulfilledResult<UrlUpdate | null> => r.status === 'fulfilled')
  .map(r => r.value)
  .filter((v): v is UrlUpdate => v !== null);
```

- [ ] **Step 7: `setSections` 내 content 업데이트에 points 반영**

`const newContent =` 블록(line 432 근처)을:

```typescript
const newContent =
  isImageGridContent(s.content) && hit.points
    ? { ...s.content, points: hit.points }
    : isPointContent(s.content) && matchedScene?.textPosition
      ? { ...s.content, textPosition: matchedScene.textPosition }
      : s.content;
```

- [ ] **Step 8: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): add image_grid branch to generateSceneImages"
```

---

### Task 5: 전체 테스트 + 수동 검증

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/api/generate-image-grid-scene.test.ts src/__tests__/lib/detail-page/section-renderer-image-grid.test.ts src/__tests__/lib/ai/remove-background.test.ts
```

Expected: 전체 PASS

- [ ] **Step 2: 수동 동작 확인 (개발 서버)**

```bash
npm run dev
```

1. 상품 이미지 업로드 후 상세페이지 생성
2. `image_grid` 섹션이 포함된 상세페이지에서 "씬 이미지 생성" 실행
3. `image_grid` 섹션에 배경 이미지 + 텍스트 오버레이가 표시되는지 확인
4. 브라우저 콘솔에 오류 없는지 확인

- [ ] **Step 3: fallback 동작 확인**

`image_grid` 섹션에 `attachedImages`가 없는 경우 기존 그리드 렌더링이 유지되는지 확인 (씬 생성 버튼 클릭 없이 HTML 미리보기)
