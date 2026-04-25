# Detail Page AI Editing UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지 섹션을 `detailHtml` 유무로 자동 분기해 케이스 1(HTML 편집)과 케이스 2(사진 → HTML 생성) UI를 각각 제공한다.

**Architecture:** `suggest-thumbnail-prompts` API에 `context: 'detail-html'` 추가, `generate-detail-html` API에 `imageUrls` 파라미터 추가, `page.tsx` Section 4를 조건부 분기 UI로 교체.

**Tech Stack:** Next.js App Router, Vitest + React Testing Library, Zod, Claude Haiku (프롬프트 제안), Claude Sonnet (HTML 편집/생성)

---

## File Map

| 파일 | 변경 유형 | 역할 |
|------|----------|------|
| `src/app/api/ai/suggest-thumbnail-prompts/route.ts` | Modify | context enum에 'detail-html' 추가, buildDetailHtmlSystemPrompt 추가 |
| `src/app/api/ai/generate-detail-html/route.ts` | Modify | imageUrls 파라미터 추가, URL fetch → base64 변환 헬퍼 추가 |
| `src/app/listing/auto-register/page.tsx` | Modify | 신규 상태/핸들러 추가, Section 4 UI 조건부 분기 |
| `src/__tests__/api/suggest-thumbnail-prompts.test.ts` | Create | context:'detail-html' 스키마/프롬프트 빌더 단위 테스트 |
| `src/__tests__/api/generate-detail-html-image-urls.test.ts` | Create | imageUrls 파라미터 스키마 검증 단위 테스트 |

---

## Task 1: suggest-thumbnail-prompts — context:'detail-html' 추가

**Files:**
- Modify: `src/app/api/ai/suggest-thumbnail-prompts/route.ts`
- Create: `src/__tests__/api/suggest-thumbnail-prompts.test.ts`

- [ ] **Step 1: 테스트 작성 (실패 확인)**

`src/__tests__/api/suggest-thumbnail-prompts.test.ts` 를 생성한다:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// 테스트용 스키마 복사 (route.ts가 export하지 않으므로 여기서 재정의)
const RequestSchema = z.object({
  title: z.string().min(1).max(300),
  categoryHint: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  options: z.array(z.object({
    typeName: z.string(),
    values: z.array(z.object({ label: z.string() })),
  })).optional(),
  context: z.enum(['thumbnail', 'detail', 'detail-html']).default('thumbnail'),
});

describe('suggest-thumbnail-prompts schema', () => {
  it("context:'detail-html'를 허용한다", () => {
    const result = RequestSchema.safeParse({ title: '상품명', context: 'detail-html' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.context).toBe('detail-html');
  });

  it("알 수 없는 context는 거부한다", () => {
    const result = RequestSchema.safeParse({ title: '상품명', context: 'unknown' });
    expect(result.success).toBe(false);
  });

  it("context 미입력 시 'thumbnail'이 기본값", () => {
    const result = RequestSchema.safeParse({ title: '상품명' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.context).toBe('thumbnail');
  });
});

describe('buildDetailHtmlSystemPrompt (exported)', () => {
  it('HTML 편집 지시문 관련 키워드를 포함한다', async () => {
    const { buildDetailHtmlSystemPrompt } = await import(
      '@/app/api/ai/suggest-thumbnail-prompts/route'
    );
    const prompt = buildDetailHtmlSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('HTML');
    expect(prompt.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/suggest-thumbnail-prompts.test.ts
```

Expected: FAIL — `buildDetailHtmlSystemPrompt` not exported, `detail-html` not in enum.

- [ ] **Step 3: route.ts 수정**

`src/app/api/ai/suggest-thumbnail-prompts/route.ts` 전체를 다음으로 교체한다:

```typescript
/**
 * POST /api/ai/suggest-thumbnail-prompts
 *
 * context='thumbnail' → 썸네일 이미지 편집 프롬프트 3개
 * context='detail'    → 상세페이지 이미지 편집 프롬프트 3개
 * context='detail-html' → 상세페이지 HTML 편집 지시문 3개
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';

const OptionValueSchema = z.object({ label: z.string() });
const OptionSchema = z.object({
  typeName: z.string(),
  values: z.array(OptionValueSchema),
});

const RequestSchema = z.object({
  title: z.string().min(1).max(300),
  categoryHint: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  options: z.array(OptionSchema).optional(),
  context: z.enum(['thumbnail', 'detail', 'detail-html']).default('thumbnail'),
});

export function buildThumbnailSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 썸네일 기획자입니다.
상품 정보를 분석해서 쿠팡 썸네일 AI 편집에 사용할 프롬프트 3가지를 제안하세요.

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 사용 (예: "흰 배경으로 교체" O, "예쁘게" X)
- 쿠팡 썸네일 가이드라인: 흰 배경 또는 단색 배경, 상품이 화면 70% 이상 차지, 텍스트 없음

## 3가지 프롬프트 방향
1. **기본형** - 흰 배경, 상품 중앙 크게 배치 (반드시 포함)
2. **스타일형** - 카테고리/상품 특성에 맞는 분위기 배경 또는 구도
3. **멀티샷형** - 컬러 옵션이 2가지 이상이면 "색상별로 N개의 상품을 나란히 배치" 구성;
   단일 색상이면 상품의 주요 기능/특징을 강조하는 구도

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["프롬프트1","프롬프트2","프롬프트3"]}`;
}

export function buildDetailSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 상세페이지 기획자입니다.
상품 정보를 분석해서 쿠팡 상세페이지 이미지 AI 편집에 사용할 프롬프트 3가지를 제안하세요.

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 (예: "배경을 밝은 회색으로 교체하고 그림자 추가" O, "예쁘게" X)
- 상세페이지는 썸네일과 달리 상품 특징·기능·사용감을 전달하는 것이 목적

## 3가지 프롬프트 방향
1. **배경정리형** - 배경을 깔끔하게 정리해 상품 본연의 디자인이 잘 보이도록 (흰 배경 또는 옅은 단색)
2. **특징강조형** - 이 상품 카테고리에서 구매 결정에 영향을 주는 핵심 부위·기능을 클로즈업하거나 화살표/텍스트 없이 구도로 강조
3. **라이프스타일형** - 실제 사용 환경(거실, 주방, 야외 등 카테고리에 맞는 배경)에 자연스럽게 배치해 사용감 전달

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["프롬프트1","프롬프트2","프롬프트3"]}`;
}

export function buildDetailHtmlSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 상세페이지 HTML 편집 기획자입니다.
상품 정보를 분석해서 기존 HTML을 개선하는 데 사용할 편집 지시문 3가지를 제안하세요.

## 지시문 작성 규칙
- 각 지시문은 HTML 편집 AI에게 바로 전달할 수 있는 구체적인 한국어 지시문
- 결과가 명확한 표현 사용 (예: "상품의 핵심 기능 3가지를 불릿 리스트로 강조해줘" O, "잘 만들어줘" X)
- HTML 구조와 이미지 태그를 유지하는 수준의 변경을 지시할 것

## 3가지 지시문 방향
1. **설명강화형** - 상품 설명 텍스트를 더 구체적이고 설득력 있게 다시 작성
2. **레이아웃정리형** - 이미지와 텍스트 배치를 모바일 친화적으로 재구성, 여백 및 폰트 정리
3. **특징부각형** - 이 상품 카테고리에서 구매 결정에 영향을 주는 핵심 특징/사양을 강조

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["지시문1","지시문2","지시문3"]}`;
}

function buildUserPrompt(
  title: string,
  categoryHint: string | undefined,
  description: string | undefined,
  options: z.infer<typeof OptionSchema>[] | undefined,
  context: 'thumbnail' | 'detail' | 'detail-html',
): string {
  const colorOption = options?.find((o) =>
    /컬러|색상|색|color/i.test(o.typeName),
  );
  const colorCount = colorOption?.values.length ?? 0;
  const colorLabels = colorOption?.values.map((v) => v.label).join(', ') ?? '';

  const optionSummary =
    options && options.length > 0
      ? options
          .map((o) => `  - ${o.typeName}: ${o.values.map((v) => v.label).join(', ')}`)
          .join('\n')
      : '  없음';

  const thumbnailNote =
    context === 'thumbnail' && colorCount >= 2
      ? `\n⚠️ 컬러 옵션이 ${colorCount}가지(${colorLabels})입니다. 멀티샷형에서는 ${colorCount}개의 상품을 색상별로 나란히 배치하는 구도를 제안하세요.`
      : '';

  return `상품명: ${title}
카테고리: ${categoryHint ?? '미분류'}
${description ? `상품 설명: ${description.slice(0, 800)}` : ''}
옵션:
${optionSummary}${thumbnailNote}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '유효하지 않은 입력' },
      { status: 400 },
    );
  }

  const { title, categoryHint, description, options, context } = parsed.data;

  const anthropic = getAnthropicClient();
  let systemPrompt: string;
  if (context === 'detail-html') {
    systemPrompt = buildDetailHtmlSystemPrompt();
  } else if (context === 'detail') {
    systemPrompt = buildDetailSystemPrompt();
  } else {
    systemPrompt = buildThumbnailSystemPrompt();
  }
  const userPrompt = buildUserPrompt(title, categoryHint, description, options, context);

  try {
    const response = await withRetry(() =>
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    );

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const parsed2 = JSON.parse(jsonMatch[0]) as { prompts?: unknown };
    if (!Array.isArray(parsed2.prompts) || parsed2.prompts.length === 0) {
      throw new Error('prompts 배열 없음');
    }

    const prompts = (parsed2.prompts as unknown[])
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .slice(0, 3);

    return NextResponse.json({ success: true, data: { prompts } });
  } catch (err) {
    console.error('[suggest-thumbnail-prompts]', err);
    return NextResponse.json(
      { success: false, error: '프롬프트 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/suggest-thumbnail-prompts.test.ts
```

Expected: PASS (3 schema tests pass; buildDetailHtmlSystemPrompt export test also passes)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/suggest-thumbnail-prompts/route.ts src/__tests__/api/suggest-thumbnail-prompts.test.ts
git commit -m "feat: add context:'detail-html' to suggest-thumbnail-prompts API"
```

---

## Task 2: generate-detail-html — imageUrls 파라미터 추가

**Files:**
- Modify: `src/app/api/ai/generate-detail-html/route.ts`
- Create: `src/__tests__/api/generate-detail-html-image-urls.test.ts`

- [ ] **Step 1: 테스트 작성 (실패 확인)**

`src/__tests__/api/generate-detail-html-image-urls.test.ts` 를 생성한다:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// route.ts의 RequestSchema와 동일한 스키마 (imageUrls 추가 버전)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ImageItemSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
});
const RequestSchema = z.object({
  images: z.array(ImageItemSchema).min(1).max(5).optional(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  productName: z.string().max(100).optional(),
  price: z.number().int().positive().optional(),
}).refine(
  (d) => (d.images && d.images.length > 0) || (d.imageUrls && d.imageUrls.length > 0),
  { message: 'images 또는 imageUrls 중 하나는 필수입니다.' },
);

describe('generate-detail-html RequestSchema (imageUrls 추가)', () => {
  it('imageUrls만 있어도 통과한다', () => {
    const result = RequestSchema.safeParse({
      imageUrls: ['https://example.com/img.jpg'],
    });
    expect(result.success).toBe(true);
  });

  it('images만 있어도 통과한다', () => {
    const result = RequestSchema.safeParse({
      images: [{ imageBase64: 'abc123', mimeType: 'image/jpeg' }],
    });
    expect(result.success).toBe(true);
  });

  it('images, imageUrls 둘 다 없으면 실패한다', () => {
    const result = RequestSchema.safeParse({ productName: '상품명' });
    expect(result.success).toBe(false);
  });

  it('imageUrls는 최대 5개', () => {
    const urls = Array(6).fill('https://example.com/img.jpg');
    const result = RequestSchema.safeParse({ imageUrls: urls });
    expect(result.success).toBe(false);
  });

  it('imageUrls 항목은 유효한 URL이어야 한다', () => {
    const result = RequestSchema.safeParse({ imageUrls: ['not-a-url'] });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/generate-detail-html-image-urls.test.ts
```

Expected: FAIL — schema는 현재 imageUrls를 지원하지 않음.

- [ ] **Step 3: generate-detail-html route.ts 수정**

`src/app/api/ai/generate-detail-html/route.ts`에서 다음 부분을 수정한다.

**스키마 교체** (기존 `const RequestSchema` 블록 전체 교체):

```typescript
const RequestSchema = z.object({
  images: z
    .array(ImageItemSchema)
    .min(1, '이미지는 최소 1장 이상이어야 합니다.')
    .max(5, '이미지는 최대 5장까지 허용됩니다.')
    .optional(),
  imageUrls: z
    .array(z.string().url('유효한 이미지 URL이 아닙니다.'))
    .max(5, '이미지 URL은 최대 5개까지 허용됩니다.')
    .optional(),
  productName: z.string().max(100).optional(),
  price: z.number().int().positive().optional(),
}).refine(
  (d) => (d.images && d.images.length > 0) || (d.imageUrls && d.imageUrls.length > 0),
  { message: 'images 또는 imageUrls 중 하나는 필수입니다.' },
);

type ValidatedRequest = z.infer<typeof RequestSchema>;
```

**URL → base64 변환 헬퍼 추가** (`analyzeImages` 함수 위에 추가):

```typescript
async function fetchImagesFromUrls(
  urls: string[],
): Promise<Array<{ imageBase64: string; mimeType: AllowedMimeType }>> {
  return Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`이미지 다운로드 실패: ${url} (${res.status})`);
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const mimeType: AllowedMimeType =
        (ALLOWED_MIME_TYPES.find((m) => contentType.includes(m)) as AllowedMimeType | undefined) ??
        'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { imageBase64: buffer.toString('base64'), mimeType };
    }),
  );
}
```

**핸들러에서 imageUrls 처리** — `const { images, productName } = parseResult.data;` 이후 블록을 교체:

```typescript
  const { images: rawImages, imageUrls, productName } = parseResult.data;

  // imageUrls가 있으면 서버에서 fetch → base64 변환
  let images: ValidatedRequest['images'];
  if (imageUrls && imageUrls.length > 0) {
    try {
      const fetched = await fetchImagesFromUrls(imageUrls);
      // rawImages가 있으면 합산, 없으면 fetched만 사용
      images = [...(rawImages ?? []), ...fetched].slice(0, 5) as ValidatedRequest['images'];
    } catch (error) {
      console.error('[/api/ai/generate-detail-html] URL 이미지 다운로드 실패:', error);
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? `이미지 다운로드 실패: ${error.message}`
              : '이미지 URL에서 이미지를 가져오는 중 오류가 발생했습니다.',
        },
        { status: 502 },
      );
    }
  } else {
    images = rawImages!;
  }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/generate-detail-html-image-urls.test.ts
```

Expected: PASS (5 schema tests pass)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-detail-html/route.ts src/__tests__/api/generate-detail-html-image-urls.test.ts
git commit -m "feat: add imageUrls param to generate-detail-html API"
```

---

## Task 3: page.tsx — 신규 상태 + 핸들러 추가

**Files:**
- Modify: `src/app/listing/auto-register/page.tsx`

- [ ] **Step 1: 신규 상태 3개 추가**

`page.tsx` 에서 `detailImgEditError` 선언 바로 다음(line ~115 근처)에 아래 3줄을 추가한다:

```typescript
  const [isEditingDetailHtml, setIsEditingDetailHtml] = useState(false);
  const [detailHtmlEditError, setDetailHtmlEditError] = useState('');
  const [isGeneratingHtmlFromImages, setIsGeneratingHtmlFromImages] = useState(false);
```

- [ ] **Step 2: handleGenerateDetailPrompts — context 자동 선택으로 수정**

`page.tsx` 의 기존 `handleGenerateDetailPrompts` 함수(line ~651)를 다음으로 교체한다:

```typescript
  async function handleGenerateDetailPrompts() {
    if (!product) return;
    setIsGeneratingDetailPrompts(true);
    setDetailSuggestedPrompts([]);
    // HTML이 있으면 HTML 편집 지시문, 없으면 이미지 편집 프롬프트
    const context = detailHtml ? 'detail-html' : 'detail';
    try {
      const res = await fetch('/api/ai/suggest-thumbnail-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title,
          categoryHint: product.categoryHint,
          description: product.description?.slice(0, 800),
          options: product.options,
          context,
        }),
      });
      const data = (await res.json()) as { success: boolean; data?: { prompts: string[] } };
      if (data.success && data.data?.prompts?.length) {
        setDetailSuggestedPrompts(data.data.prompts);
        setDetailEditInstruction(data.data.prompts[0]);
      }
    } catch {
      // 실패 시 무시
    } finally {
      setIsGeneratingDetailPrompts(false);
    }
  }
```

- [ ] **Step 3: handleDetailHtmlEdit + handleDetailHtmlRegenerate 추가**

`handleGenerateDetailPrompts` 함수 바로 다음에 아래 2개 함수를 추가한다:

```typescript
  async function handleDetailHtmlEdit(instruction: string) {
    if (!detailHtml || !instruction.trim()) return;
    setIsEditingDetailHtml(true);
    setDetailHtmlEditError('');
    try {
      const res = await fetch('/api/ai/edit-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentHtml: detailHtml,
          instruction: instruction.trim(),
          productName: name,
        }),
      });
      const data = (await res.json()) as { success: boolean; html?: string; error?: string };
      if (data.success && data.html) {
        setDetailHtml(data.html);
      } else {
        setDetailHtmlEditError(data.error ?? 'HTML 편집 중 오류가 발생했습니다.');
      }
    } catch {
      setDetailHtmlEditError('HTML 편집 중 오류가 발생했습니다.');
    } finally {
      setIsEditingDetailHtml(false);
    }
  }

  async function handleDetailHtmlRegenerate() {
    await handleDetailHtmlEdit(
      '상품 정보를 바탕으로 상세페이지 HTML을 처음부터 완전히 재작성해줘. 상품의 핵심 특징을 강조하고, 구매를 유도하는 설득력 있는 문구를 포함해줘.',
    );
  }
```

- [ ] **Step 4: handleGenerateHtmlFromImages 추가**

`handleDetailHtmlRegenerate` 바로 다음에 추가한다:

```typescript
  async function handleGenerateHtmlFromImages() {
    if (detailImages.length === 0) return;
    setIsGeneratingHtmlFromImages(true);
    setDetailHtmlEditError('');

    // data URL → images 배열, https URL → imageUrls 배열로 분리
    const images: { imageBase64: string; mimeType: string }[] = [];
    const imageUrls: string[] = [];

    for (const img of detailImages) {
      if (img.startsWith('data:')) {
        const commaIdx = img.indexOf(',');
        const meta = img.slice(5, commaIdx); // "image/jpeg;base64"
        const mimeType = meta.split(';')[0] ?? 'image/jpeg';
        const imageBase64 = img.slice(commaIdx + 1);
        images.push({ imageBase64, mimeType });
      } else {
        imageUrls.push(img);
      }
    }

    try {
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(images.length > 0 ? { images } : {}),
          ...(imageUrls.length > 0 ? { imageUrls } : {}),
          productName: name,
        }),
      });
      const data = (await res.json()) as { success: boolean; html?: string; error?: string };
      if (data.success && data.html) {
        setDetailHtml(data.html);
        // HTML이 생성되면 자동으로 케이스 1(HTML 편집 모드)로 전환됨
        setDetailSuggestedPrompts([]); // 프롬프트 초기화 (케이스 전환)
      } else {
        setDetailHtmlEditError(data.error ?? 'HTML 생성 중 오류가 발생했습니다.');
      }
    } catch {
      setDetailHtmlEditError('HTML 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGeneratingHtmlFromImages(false);
    }
  }
```

- [ ] **Step 5: 타입스크립트 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음 (또는 기존 에러만)

- [ ] **Step 6: 커밋**

```bash
git add src/app/listing/auto-register/page.tsx
git commit -m "feat: add detail HTML edit/generate handlers to auto-register page"
```

---

## Task 4: page.tsx — Section 4 UI 조건부 분기

**Files:**
- Modify: `src/app/listing/auto-register/page.tsx`

- [ ] **Step 1: Section 4 전체 교체**

`page.tsx` 에서 `{/* 섹션 4: 상세페이지 */}` 부터 `{/* 섹션 5: 배송 · 반품 */}` 직전까지 (line ~1582 ~ ~1750) 를 다음으로 교체한다:

```tsx
            {/* 섹션 4: 상세페이지 */}
            <div className={SECTION}>
              {detailHtml ? (
                /* ── 케이스 1: HTML 있음 → HTML 편집 모드 ── */
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">상세페이지</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                        <button
                          onClick={() => setIsPreview(true)}
                          className={`px-3 py-1.5 ${isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          미리보기
                        </button>
                        <button
                          onClick={() => setIsPreview(false)}
                          className={`px-3 py-1.5 ${!isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          HTML 편집
                        </button>
                      </div>
                    </div>
                  </div>

                  {isPreview ? (
                    <div
                      className="border border-gray-200 rounded-lg p-4 max-h-72 overflow-y-auto text-sm"
                      dangerouslySetInnerHTML={{ __html: safeHtml }}
                    />
                  ) : (
                    <textarea
                      value={detailHtml}
                      onChange={(e) => setDetailHtml(e.target.value)}
                      rows={12}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                      spellCheck={false}
                    />
                  )}

                  {/* AI 지시문 편집 영역 */}
                  <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">AI 편집 지시문</span>
                      {product && (
                        <button
                          onClick={handleGenerateDetailPrompts}
                          disabled={isGeneratingDetailPrompts}
                          className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingDetailPrompts ? '분석 중...' : 'AI 제안 3개'}
                        </button>
                      )}
                    </div>

                    {/* 지시문 카드 */}
                    {(isGeneratingDetailPrompts || detailSuggestedPrompts.length > 0) && (
                      <div className="flex flex-col gap-1.5">
                        {isGeneratingDetailPrompts && detailSuggestedPrompts.length === 0
                          ? [1, 2, 3].map((n) => (
                              <div key={n} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                            ))
                          : detailSuggestedPrompts.map((prompt, idx) => (
                              <button
                                key={idx}
                                onClick={() => setDetailEditInstruction(prompt)}
                                className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                                  detailEditInstruction === prompt
                                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50/50'
                                }`}
                              >
                                <span className="font-semibold text-purple-600 mr-1.5">
                                  {['설명강화형', '레이아웃정리형', '특징부각형'][idx] ?? `옵션 ${idx + 1}`}
                                </span>
                                {prompt}
                              </button>
                            ))}
                      </div>
                    )}

                    <input
                      value={detailEditInstruction}
                      onChange={(e) => setDetailEditInstruction(e.target.value)}
                      placeholder="상품 설명을 더 설득력 있게 작성해줘, 모바일 레이아웃으로 재구성해줘..."
                      disabled={isEditingDetailHtml}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 w-full"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDetailHtmlEdit(detailEditInstruction)}
                        disabled={isEditingDetailHtml || !detailEditInstruction.trim()}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isEditingDetailHtml ? 'AI 편집 중...' : 'AI 편집'}
                      </button>
                      <button
                        onClick={handleDetailHtmlRegenerate}
                        disabled={isEditingDetailHtml}
                        className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg text-sm whitespace-nowrap hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        처음부터 재생성
                      </button>
                    </div>

                    {detailHtmlEditError && (
                      <p className="text-xs text-red-500">{detailHtmlEditError}</p>
                    )}

                    <button
                      onClick={() => { setDetailHtml(''); setDetailImages([]); setDetailSuggestedPrompts([]); setDetailEditInstruction(''); }}
                      className="text-xs text-gray-400 hover:text-gray-600 self-start"
                    >
                      사진으로 다시 시작 →
                    </button>
                  </div>
                </>
              ) : (
                /* ── 케이스 2: HTML 없음 → 사진 첨부 & HTML 생성 모드 ── */
                <>
                  <h3 className="font-semibold text-gray-900">상세페이지 이미지로 생성</h3>

                  {/* AI 추천 이미지 편집 프롬프트 */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">AI 편집 프롬프트</span>
                      {product && (
                        <button
                          onClick={handleGenerateDetailPrompts}
                          disabled={isGeneratingDetailPrompts}
                          className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingDetailPrompts ? '분석 중...' : 'AI 제안 3개'}
                        </button>
                      )}
                    </div>

                    {(isGeneratingDetailPrompts || detailSuggestedPrompts.length > 0) && (
                      <div className="flex flex-col gap-1.5">
                        {isGeneratingDetailPrompts && detailSuggestedPrompts.length === 0
                          ? [1, 2, 3].map((n) => (
                              <div key={n} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                            ))
                          : detailSuggestedPrompts.map((prompt, idx) => (
                              <button
                                key={idx}
                                onClick={() => setDetailEditInstruction(prompt)}
                                className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                                  detailEditInstruction === prompt
                                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50/50'
                                }`}
                              >
                                <span className="font-semibold text-purple-600 mr-1.5">
                                  {['배경정리형', '특징강조형', '라이프스타일형'][idx] ?? `옵션 ${idx + 1}`}
                                </span>
                                {prompt}
                              </button>
                            ))}
                      </div>
                    )}

                    <input
                      value={detailEditInstruction}
                      onChange={(e) => setDetailEditInstruction(e.target.value)}
                      placeholder="배경 제거, 밝기 조정, 라이프스타일 배경 추가..."
                      disabled={isEditingDetailImg}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 w-full"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={handleDetailImgAiEditAll}
                        disabled={isEditingDetailImg || !detailEditInstruction.trim() || detailImages.length === 0}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isEditingDetailImg
                          ? `편집 중 (${(detailEditingSlot ?? 0) + 1}/${detailImages.length})...`
                          : '사진 AI 편집'}
                      </button>
                      {detailImages.length === 0 && (
                        <span className="text-xs text-gray-400 self-center">이미지를 먼저 추가하세요</span>
                      )}
                    </div>
                    {detailImgEditError && <p className="text-xs text-red-500">{detailImgEditError}</p>}
                  </div>

                  {/* 이미지 목록 + 추가 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">상세 이미지</span>
                    <button
                      onClick={() => triggerDetailFileUpload(detailImages.length)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200"
                    >
                      + 이미지 추가
                    </button>
                  </div>

                  {detailImages.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {detailImages.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`상세 이미지 ${idx + 1}`}
                            className="w-16 h-16 object-cover rounded border border-gray-200 flex-shrink-0 cursor-pointer"
                            onClick={() => triggerDetailFileUpload(idx)}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-gray-500">이미지 {idx + 1}</span>
                          </div>
                          <button
                            onClick={() => handleDetailImgAiEdit(idx)}
                            disabled={isEditingDetailImg || !detailEditInstruction.trim()}
                            className="px-2.5 py-1.5 bg-purple-600 text-white rounded text-xs whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            {isEditingDetailImg && detailEditingSlot === idx ? '편집 중...' : 'AI 편집'}
                          </button>
                          <button
                            onClick={() => removeDetailImage(idx)}
                            className="px-2 py-1.5 text-gray-400 hover:text-red-500 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      onClick={() => triggerDetailFileUpload(0)}
                      className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                    >
                      <p className="text-sm text-gray-400">클릭해서 상세 이미지를 추가하세요</p>
                    </div>
                  )}

                  {/* HTML 생성 버튼 */}
                  <div className="border-t border-gray-100 pt-3">
                    {detailHtmlEditError && (
                      <p className="text-xs text-red-500 mb-2">{detailHtmlEditError}</p>
                    )}
                    <button
                      onClick={handleGenerateHtmlFromImages}
                      disabled={detailImages.length === 0 || isGeneratingHtmlFromImages}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isGeneratingHtmlFromImages
                        ? 'HTML 생성 중... (30초~1분 소요)'
                        : detailImages.length === 0
                        ? '이미지를 추가하면 HTML 생성 가능'
                        : `HTML 생성 (이미지 ${detailImages.length}장)`}
                    </button>
                  </div>

                  {/* hidden file input */}
                  <input
                    ref={detailFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDetailFileChange}
                  />
                </>
              )}
            </div>
```

- [ ] **Step 2: 타입스크립트 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음 (또는 기존 에러만)

- [ ] **Step 3: 개발 서버 실행 후 UI 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/listing/auto-register` 확인:
- URL 입력 → 상품 로드 → 섹션 4가 "상세페이지" 헤더 + 미리보기 + AI 지시문 입력 + [AI 편집][처음부터 재생성] 버튼으로 표시되는지 확인 (케이스 1)
- "사진으로 다시 시작 →" 클릭 시 → 섹션 4가 "상세페이지 이미지로 생성" + 이미지 업로드 영역 + [HTML 생성] 버튼으로 전환되는지 확인 (케이스 2)
- 케이스 2에서 이미지 추가 후 [HTML 생성] → 완료 후 케이스 1으로 자동 전환되는지 확인

- [ ] **Step 4: 커밋**

```bash
git add src/app/listing/auto-register/page.tsx
git commit -m "feat: split detail page section into case-1 HTML edit / case-2 photo-to-HTML flow"
```

---

## 완료 기준 체크리스트

- [ ] `suggest-thumbnail-prompts` API가 `context: 'detail-html'` 요청에 HTML 편집 지시문 3개를 반환한다
- [ ] `generate-detail-html` API가 `imageUrls` 배열을 받아 URL에서 이미지를 내려받고 HTML을 생성한다
- [ ] 케이스 1 (detailHtml 있음): 미리보기 + AI 지시문 편집 + [AI 편집] + [처음부터 재생성] 표시
- [ ] 케이스 2 (detailHtml 없음): 사진 업로드 + 개별 AI 편집 + [HTML 생성] 표시
- [ ] [HTML 생성] 성공 시 detailHtml이 설정되어 자동으로 케이스 1 UI로 전환된다
- [ ] "사진으로 다시 시작 →" 클릭 시 케이스 2로 되돌아간다
- [ ] 모든 vitest 테스트 통과
