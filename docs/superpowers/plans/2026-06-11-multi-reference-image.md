# 멀티참조 이미지 입력 (제피터식 AI 재생성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 올린 상품 이미지 전체(최대 3장)를 참조로 Gemini가 섹션별 비주얼을 재생성하도록, 단일 참조 1장 구조를 멀티참조로 확장한다.

**Architecture:** 서버 측 공통 로더(`loadReferenceImages`)가 URL 배열을 fetch + Sharp 리사이즈 + base64 정규화해 최대 3장의 참조를 만든다. `imagen.ts`·`generate-scene-image`·`generate-frame-image`가 이 멀티참조를 Claude/Gemini에 동시 전달한다. 클라이언트(`AssetsTab`)는 중복된 base64 변환 로직을 버리고 URL 배열만 넘긴다. 단일 입력 하위호환은 유지한다.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Sharp, `@google/genai` (Gemini 2.5 Flash Image), Anthropic Claude (Sonnet), Vitest

**참고 설계 문서:** `docs/superpowers/specs/2026-06-11-multi-reference-image-design.md`

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/lib/ai/reference-images.ts` | **신규** — `loadReferenceImages()` 공통 로더 (URL fetch + Sharp 리사이즈 + base64, 최대 3장) |
| `src/lib/ai/imagen.ts` | 수정 — `GenerateFrameImageInput.referenceImages[]` 지원, parts에 다중 inlineData |
| `src/lib/ai/prompts/detail-image-prompts.ts` | 수정 — `referenceImageIndex` 제거, 멀티앵글 프롬프트 |
| `src/app/api/ai/generate-frame-image/route.ts` | 수정 — `referenceImages`/`productImageUrls` 수신 → 로더 → 전달 |
| `src/app/api/ai/generate-scene-image/route.ts` | 수정 — 멀티참조 수신 → Claude N개 + Gemini, 수량 왜곡 방지 규칙 |
| `src/components/listing/assets/AssetsTab.tsx` | 수정 — base64 변환 제거, URL 배열 전달 |
| `src/__tests__/lib/reference-images.test.ts` | 신규 |
| `src/__tests__/lib/imagen.test.ts` | 신규 |
| `src/__tests__/lib/detail-image-prompts.test.ts` | 수정 — `referenceImageIndex` 제거 검증 |
| `src/__tests__/api/generate-frame-image.test.ts` | 수정 — `referenceImages` 패스스루 검증 |
| `src/__tests__/api/generate-scene-image.test.ts` | 신규 |

---

## Task 1: 공통 참조 로더 `loadReferenceImages`

**Files:**
- Create: `src/lib/ai/reference-images.ts`
- Test: `src/__tests__/lib/reference-images.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/lib/reference-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('normalized-image')),
  })),
}));

import { loadReferenceImages } from '@/lib/ai/reference-images';

const NORMALIZED = Buffer.from('normalized-image').toString('base64');

describe('loadReferenceImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('referenceImages 3장을 정규화하여 3개 반환한다', async () => {
    const result = await loadReferenceImages({
      referenceImages: [
        { base64: Buffer.from('a').toString('base64') },
        { base64: Buffer.from('b').toString('base64') },
        { base64: Buffer.from('c').toString('base64') },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].base64).toBe(NORMALIZED);
  });

  it('4장 이상이면 첫 3장만 사용한다', async () => {
    const result = await loadReferenceImages({
      referenceImages: [1, 2, 3, 4].map((n) => ({ base64: Buffer.from(String(n)).toString('base64') })),
    });
    expect(result).toHaveLength(3);
  });

  it('productImageUrls를 fetch하여 정규화한다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    });
    const result = await loadReferenceImages({ productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'] });
    expect(result).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('fetch 실패한 URL은 건너뛴다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await loadReferenceImages({ productImageUrls: ['https://x/a.jpg'] });
    expect(result).toHaveLength(0);
  });

  it('하위호환: 단일 productImageBase64를 1장으로 처리한다', async () => {
    const result = await loadReferenceImages({ productImageBase64: Buffer.from('x').toString('base64') });
    expect(result).toHaveLength(1);
  });

  it('입력이 전혀 없으면 빈 배열을 반환한다', async () => {
    const result = await loadReferenceImages({});
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/reference-images.test.ts`
Expected: FAIL — module `@/lib/ai/reference-images` not found

- [ ] **Step 3: 로더 구현**

```typescript
// src/lib/ai/reference-images.ts
/**
 * 멀티참조 이미지 로더
 * 다양한 입력 소스(직접 base64, URL, 단일 하위호환 필드)를 받아
 * 최대 3장의 정규화된 참조 이미지(장변 1024px JPEG)로 변환한다.
 */
import sharp from 'sharp';

export interface ReferenceImage {
  /** data URL prefix 제외 base64 */
  base64: string;
  mimeType: 'image/jpeg';
}

export interface LoadReferenceImagesInput {
  /** 직접 전달된 base64 참조 (data URL prefix 제외) */
  referenceImages?: Array<{ base64: string; mimeType?: string }>;
  /** 서버가 fetch할 이미지 URL 목록 */
  productImageUrls?: string[];
  /** @deprecated 하위호환: 단일 base64 */
  productImageBase64?: string;
  productImageMimeType?: string;
  /** @deprecated 하위호환: 단일 URL */
  productImageUrl?: string;
}

const MAX_REFERENCES = 3;
const MAX_EDGE = 1024;

/** 단일 Buffer를 장변 1024px JPEG q80으로 정규화하여 base64 반환 */
async function normalizeBuffer(buf: Buffer): Promise<string> {
  const out = await sharp(buf)
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString('base64');
}

export async function loadReferenceImages(
  input: LoadReferenceImagesInput,
): Promise<ReferenceImage[]> {
  const buffers: Buffer[] = [];

  // 1. base64 직접 입력 (referenceImages → 단일 productImageBase64)
  const directBase64: string[] = [];
  if (input.referenceImages?.length) {
    for (const r of input.referenceImages) directBase64.push(r.base64);
  }
  if (input.productImageBase64) directBase64.push(input.productImageBase64);
  for (const b64 of directBase64) {
    try {
      buffers.push(Buffer.from(b64, 'base64'));
    } catch {
      // 잘못된 base64는 건너뛴다
    }
  }

  // 2. URL 입력 (병렬 fetch)
  const urls: string[] = [];
  if (input.productImageUrls?.length) urls.push(...input.productImageUrls);
  if (input.productImageUrl) urls.push(input.productImageUrl);
  if (urls.length) {
    const fetched = await Promise.all(
      urls.map(async (u) => {
        try {
          const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return null;
          return Buffer.from(await res.arrayBuffer());
        } catch {
          return null;
        }
      }),
    );
    for (const f of fetched) if (f) buffers.push(f);
  }

  // 3. 상한 적용 + 정규화
  const limited = buffers.slice(0, MAX_REFERENCES);
  const normalized = await Promise.all(
    limited.map(async (b) => {
      try {
        return { base64: await normalizeBuffer(b), mimeType: 'image/jpeg' as const };
      } catch {
        return null;
      }
    }),
  );
  return normalized.filter((x): x is ReferenceImage => x !== null);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/reference-images.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/reference-images.ts src/__tests__/lib/reference-images.test.ts
git commit -m "feat: loadReferenceImages 공통 멀티참조 로더 (URL fetch + Sharp 리사이즈)"
```

---

## Task 2: `imagen.ts` 멀티참조 입력 지원

**Files:**
- Modify: `src/lib/ai/imagen.ts`
- Test: `src/__tests__/lib/imagen.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/lib/imagen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: mockGenerateContent } }),
}));

import { generateFrameImage } from '@/lib/ai/imagen';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/png' } }] } }],
  });
});

function partsOfLastCall(): Part[] {
  return mockGenerateContent.mock.calls[0][0].contents[0].parts as Part[];
}

describe('generateFrameImage — 멀티 참조', () => {
  it('referenceImages 3장이 모두 inlineData parts로 전달된다', async () => {
    await generateFrameImage({
      imagePrompt: 'a beautiful scene prompt here',
      referenceImages: [
        { base64: 'AAA', mimeType: 'image/jpeg' },
        { base64: 'BBB', mimeType: 'image/jpeg' },
        { base64: 'CCC', mimeType: 'image/jpeg' },
      ],
    });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(3);
    expect(inline.map((p) => p.inlineData!.data)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('하위호환: 단일 productImageBase64는 1개 inlineData로 변환된다', async () => {
    await generateFrameImage({
      imagePrompt: 'a beautiful scene prompt here',
      productImageBase64: 'XYZ',
      productImageMimeType: 'image/png',
    });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(1);
    expect(inline[0].inlineData!.data).toBe('XYZ');
  });

  it('참조 없이도 텍스트 프롬프트만으로 생성한다', async () => {
    const result = await generateFrameImage({ imagePrompt: 'a beautiful scene prompt here' });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(0);
    expect(result.imageBase64).toBe('GEN');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/imagen.test.ts`
Expected: FAIL — `referenceImages`가 inlineData로 처리되지 않아 첫 테스트 실패 (inline.length === 0)

- [ ] **Step 3: `imagen.ts` 수정**

`GenerateFrameImageInput` 인터페이스(19-26번 줄)를 다음으로 교체:

```typescript
export interface GenerateFrameImageInput {
  /** Gemini Imagen에 직접 입력할 상세 영어 프롬프트 */
  imagePrompt: string;
  /** 여러 참조 이미지 (최대 3장, base64 + mimeType) */
  referenceImages?: Array<{ base64: string; mimeType: string }>;
  /** @deprecated 단일 참조 — 내부에서 referenceImages로 흡수 */
  productImageBase64?: string;
  /** @deprecated 상품 이미지 MIME 타입 */
  productImageMimeType?: string;
}
```

함수 본문에서 parts 구성 부분(51-61번 줄)을 다음으로 교체:

```typescript
  // 참조 이미지 정규화: referenceImages 우선, 없으면 단일 필드를 1장으로 흡수
  const refs =
    input.referenceImages && input.referenceImages.length > 0
      ? input.referenceImages
      : input.productImageBase64 && input.productImageMimeType
        ? [{ base64: input.productImageBase64, mimeType: input.productImageMimeType }]
        : [];

  // parts 배열 구성: 모든 참조 이미지를 inlineData로 추가
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

  for (const ref of refs) {
    parts.push({
      inlineData: { data: ref.base64, mimeType: ref.mimeType },
    });
  }
```

(이후 `singleFrameConstraint` 및 `parts.push({ text: ... })`, `generateContent` 호출부는 기존 그대로 유지)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/imagen.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/imagen.ts src/__tests__/lib/imagen.test.ts
git commit -m "feat: imagen.ts referenceImages[] 멀티참조 입력 지원 (단일 하위호환 유지)"
```

---

## Task 3: `detail-image-prompts.ts` — `referenceImageIndex` 제거

**Files:**
- Modify: `src/lib/ai/prompts/detail-image-prompts.ts`
- Test: `src/__tests__/lib/detail-image-prompts.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`src/__tests__/lib/detail-image-prompts.test.ts`의 `describe('parseImagePromptsResponse', ...)` 블록 안에 다음 테스트를 추가:

```typescript
  it('referenceImageIndex 없이도 정상 파싱한다 (멀티참조 전환)', () => {
    const raw = JSON.stringify({
      visualIdentity: { colorPalette: 'x', mood: 'y', lighting: 'z', background: 'w' },
      imagePrompts: [
        { role: 'hero', scene: 'front shot' },
        { role: 'lifestyle', scene: 'living room' },
      ],
    });
    const result = parseImagePromptsResponse(raw);
    expect(result.imagePrompts).toHaveLength(2);
    // referenceImageIndex 필드는 더 이상 존재하지 않는다
    expect('referenceImageIndex' in result.imagePrompts[0]).toBe(false);
  });
```

`buildImagePromptsUserPrompt` describe 블록에도 멀티앵글 명시 검증 추가:

```typescript
  it('멀티앵글 참조 안내를 포함한다', () => {
    const prompt = buildImagePromptsUserPrompt(mockAnalysis, mockContent);
    expect(prompt.toLowerCase()).toContain('reference');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-image-prompts.test.ts`
Expected: FAIL — `'referenceImageIndex' in result.imagePrompts[0]`가 아직 `true` (파서가 필드를 세팅 중)

- [ ] **Step 3: `detail-image-prompts.ts` 수정**

(a) `SectionImagePrompt` 인터페이스(14-19번 줄)에서 `referenceImageIndex` 줄 제거:

```typescript
export interface SectionImagePrompt {
  role: 'hero' | 'lifestyle' | 'detail' | 'feature';
  scene: string;           // Claude가 생성한 원본 장면 설명
  prompt?: string;         // 라우트에서 조립한 Gemini 최종 프롬프트 (파서에서 세팅하지 않음)
}
```

(b) `buildImagePromptsUserPrompt`의 JSON 예시(75-92번 줄 블록)에서 각 항목의 `, "referenceImageIndex": 0`을 제거하고, 안내 문구를 멀티앵글로 수정:

```typescript
  lines.push(`
Multiple reference photos of the SAME product (different angles) will be provided to the image generator.
Define a visual identity and 4 section image prompts for this product.
Output this exact JSON:
{
  "visualIdentity": {
    "colorPalette": "2-3 colors that complement the product, e.g. warm ivory, soft beige",
    "mood": "1-2 adjectives, e.g. premium minimal",
    "lighting": "lighting description, e.g. soft diffused natural light",
    "background": "background description, e.g. off-white linen texture"
  },
  "imagePrompts": [
    { "role": "hero", "scene": "clean front-facing studio product shot description" },
    { "role": "lifestyle", "scene": "realistic lifestyle usage scene description" },
    { "role": "detail", "scene": "macro close-up of material or craftsmanship description" },
    { "role": "feature", "scene": "key functional feature highlight description" }
  ]
}
Rules: scene descriptions must be in English, concise (1-2 sentences), specific to this product.`);
```

(c) `parseImagePromptsResponse`의 map 콜백(132-138번 줄)에서 `referenceImageIndex` 세팅 줄 제거:

```typescript
    imagePrompts: (data.imagePrompts as Array<Record<string, unknown>>).map((p) => ({
      role: typeof p.role === 'string' && VALID_ROLES.includes(p.role as SectionImagePrompt['role'])
        ? (p.role as SectionImagePrompt['role'])
        : 'feature',
      scene: String(p.scene ?? ''),
    })),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-image-prompts.test.ts`
Expected: PASS (기존 + 신규 테스트 모두)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/prompts/detail-image-prompts.ts src/__tests__/lib/detail-image-prompts.test.ts
git commit -m "refactor: detail-image-prompts referenceImageIndex 제거, 멀티앵글 프롬프트로 전환"
```

---

## Task 4: `generate-frame-image` route — 멀티참조 수신

**Files:**
- Modify: `src/app/api/ai/generate-frame-image/route.ts`
- Test: `src/__tests__/api/generate-frame-image.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`src/__tests__/api/generate-frame-image.test.ts` 상단 mock 블록에 로더 mock 추가 (기존 `vi.mock('@/lib/ai/imagen', ...)` 아래):

```typescript
const mockLoadReferenceImages = vi.fn();
vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: (...args: unknown[]) => mockLoadReferenceImages(...args),
}));
```

기존 `beforeEach`를 다음으로 교체 (로더 기본 반환값 추가):

```typescript
beforeEach(() => {
  mockGenerateFrameImage.mockResolvedValue(MOCK_SUCCESS);
  mockLoadReferenceImages.mockResolvedValue([]);
});
```

`describe` 블록 안에 멀티참조 테스트 추가:

```typescript
  it('productImageUrls를 받으면 로더 결과를 generateFrameImage에 referenceImages로 전달한다', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'R1', mimeType: 'image/jpeg' },
      { base64: 'R2', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        frameType: 'hero',
        imagePrompt: LONG_PROMPT,
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockGenerateFrameImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          { base64: 'R1', mimeType: 'image/jpeg' },
          { base64: 'R2', mimeType: 'image/jpeg' },
        ],
      }),
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/generate-frame-image.test.ts`
Expected: FAIL — `productImageUrls`가 스키마에 없어 무시되거나, `referenceImages`가 전달되지 않음

- [ ] **Step 3: route 수정**

(a) import 추가 (12번 줄 `generateFrameImage` import 아래):

```typescript
import { loadReferenceImages } from "@/lib/ai/reference-images";
```

(b) `RequestBodySchema`(50-57번 줄)를 다음으로 교체:

```typescript
const RequestBodySchema = z.object({
  frameType: z.enum(FRAME_TYPES),
  imagePrompt: z.string().min(10).max(2000),
  // 신규: 멀티참조 입력
  referenceImages: z
    .array(z.object({ base64: z.string(), mimeType: z.string().optional() }))
    .max(3)
    .optional(),
  productImageUrls: z.array(z.string().url()).max(3).optional(),
  // 하위호환: 단일 입력
  productImageBase64: z.string().optional(),
  productImageMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
});
```

(c) Gemini 호출부(150-155번 줄)를 다음으로 교체:

```typescript
    // 참조 이미지 로딩 (URL fetch + Sharp 리사이즈 + base64, 최대 3장)
    const referenceImages = await loadReferenceImages({
      referenceImages: body.referenceImages,
      productImageUrls: body.productImageUrls,
      productImageBase64: body.productImageBase64,
      productImageMimeType: body.productImageMimeType,
    });

    // Gemini Imagen 호출
    const result = await generateFrameImage({
      imagePrompt: body.imagePrompt,
      referenceImages,
    });
```

(d) 기존 `productImageBase64`만 있고 mimeType 없을 때 400을 반환하던 검증(138-148번 줄)은 **그대로 유지** (하위호환 입력 검증).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/generate-frame-image.test.ts`
Expected: PASS (기존 회귀 테스트 + 신규 멀티참조 테스트)

> 주의: 기존 `'productImageBase64와 mimeType이 함께 있으면 200'` 테스트는 로더가 `mockResolvedValue([])`를 반환해도 200을 유지하므로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-frame-image/route.ts src/__tests__/api/generate-frame-image.test.ts
git commit -m "feat: generate-frame-image 멀티참조(referenceImages/productImageUrls) 수신"
```

---

## Task 5: `generate-scene-image` route — 멀티참조 + 수량 왜곡 방지

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`
- Test: `src/__tests__/api/generate-scene-image.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/api/generate-scene-image.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockLoadReferenceImages = vi.fn();
vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: (...args: unknown[]) => mockLoadReferenceImages(...args),
}));

const mockGenerateFrameImage = vi.fn();
vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: (...args: unknown[]) => mockGenerateFrameImage(...args),
}));

const mockClaudeCreate = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: () => ({ messages: { create: mockClaudeCreate } }),
}));

import { POST } from '@/app/api/ai/generate-scene-image/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-scene-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaudeCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ prompt: 'a detailed scene prompt' }) }],
  });
  mockGenerateFrameImage.mockResolvedValue({ imageBase64: 'GEN', mimeType: 'image/png' });
});

describe('POST /api/ai/generate-scene-image — 멀티참조', () => {
  it('productImageUrls 3장이 Claude content와 generateFrameImage에 모두 전달된다', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        sectionType: 'hero',
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Claude userContent에 이미지 블록 3개 포함
    const claudeArgs = mockClaudeCreate.mock.calls[0][0];
    const userContent = claudeArgs.messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(3);

    // Gemini에 referenceImages 3장 전달
    expect(mockGenerateFrameImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          { base64: 'A', mimeType: 'image/jpeg' },
          { base64: 'B', mimeType: 'image/jpeg' },
          { base64: 'C', mimeType: 'image/jpeg' },
        ],
      }),
    );
  });

  it('참조 0장이면 이미지 블록 없이 텍스트만으로 생성한다', async () => {
    mockLoadReferenceImages.mockResolvedValue([]);

    const res = await POST(makeRequest({ sectionType: 'lifestyle' }));
    expect(res.status).toBe(200);

    const userContent = mockClaudeCreate.mock.calls[0][0].messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('잘못된 sectionType은 400을 반환한다', async () => {
    const res = await POST(makeRequest({ sectionType: 'banner' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/generate-scene-image.test.ts`
Expected: FAIL — 현재 route가 단일 `productImageBase64`만 처리하므로 이미지 블록 3개·referenceImages 전달 실패

- [ ] **Step 3: route 수정**

(a) import 추가 (6번 줄 `generateFrameImage` import 아래):

```typescript
import { loadReferenceImages } from '@/lib/ai/reference-images';
```

(b) `RequestBodySchema`(12-23번 줄)에 멀티참조 필드 추가:

```typescript
const RequestBodySchema = z.object({
  sectionType: z.enum(['hero', 'lifestyle', 'detail', 'feature']),
  // 신규: 멀티참조
  referenceImages: z
    .array(z.object({ base64: z.string(), mimeType: z.string().optional() }))
    .max(3)
    .optional(),
  productImageUrls: z.array(z.string().url()).max(3).optional(),
  // 하위호환: 단일
  productImageBase64: z.string().optional(),
  productImageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  productImageUrl: z.string().url().optional(),
  productInfo: z.object({
    headline: z.string().optional(),
    subheadline: z.string().optional(),
    sellingPoints: z.array(z.object({ title: z.string(), description: z.string() })).optional(),
    features: z.array(z.object({ title: z.string() })).optional(),
  }).optional(),
});
```

(c) `SCENE_PROMPT_SYSTEM` 상수의 첫 문장과 수량 규칙을 멀티앵글 대응으로 수정. 25-28번 줄의 도입부를 다음으로 교체:

```typescript
const SCENE_PROMPT_SYSTEM = `You are an expert e-commerce product photographer and AI image prompt engineer.

Given one or more reference images of the SAME product (often photographed from different angles) and product information, create a highly detailed English prompt
for Gemini image generation that will produce a professional commercial lifestyle scene.
```

그리고 36번 줄의 PRODUCT COUNT 규칙 항목에 멀티참조 경고를 덧붙인다 — 해당 줄을 다음으로 교체:

```typescript
- CRITICAL PRODUCT COUNT: The multiple reference images show the SAME single product from different angles — they do NOT represent multiple products. Carefully count the EXACT number of each item type that makes up ONE product unit (e.g., "1 spoon and 1 chopstick set" or "3 bottles sold together"). Your prompt MUST specify this EXACT count. NEVER duplicate or multiply items based on the number of reference images provided. State the count explicitly: "exactly 1 [item]" etc.
```

(d) URL→base64 단일 fetch 블록(98-122번 줄, `let { productImageBase64 ... }` 부터 `}` 까지)을 삭제하고, 로더 호출로 교체:

```typescript
  const { sectionType, productInfo } = parsed.data;

  // 참조 이미지 로딩 (멀티참조: URL fetch + Sharp 리사이즈 + base64, 최대 3장)
  const referenceImages = await loadReferenceImages({
    referenceImages: parsed.data.referenceImages,
    productImageUrls: parsed.data.productImageUrls,
    productImageBase64: parsed.data.productImageBase64,
    productImageMimeType: parsed.data.productImageMimeType,
    productImageUrl: parsed.data.productImageUrl,
  });
```

(e) Claude userContent 구성부(132-141번 줄)를 다음으로 교체 (단일 이미지 push → 모든 참조 push):

```typescript
    const userContent: ContentBlock[] = [];

    for (const ref of referenceImages) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
      });
    }

    userContent.push({ type: 'text', text: buildUserPrompt(sectionType, productInfo) });
```

(f) Gemini 호출부(162-167번 줄)를 다음으로 교체:

```typescript
    // Step 2: Gemini로 완성된 씬 이미지 생성
    const imageResult = await generateFrameImage({
      imagePrompt: scenePrompt,
      referenceImages,
    });
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/generate-scene-image.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/route.ts src/__tests__/api/generate-scene-image.test.ts
git commit -m "feat: generate-scene-image 멀티참조 + 수량 왜곡 방지 규칙"
```

---

## Task 6: `AssetsTab` 오케스트레이션 — URL 배열 전달

**Files:**
- Modify: `src/components/listing/assets/AssetsTab.tsx`

> 이 Task는 클라이언트 중복 base64 변환 로직을 제거하고 URL 배열을 서버로 넘긴다. UI 단위 테스트가 없으므로 `npx tsc --noEmit`으로 검증한다.

- [ ] **Step 1: `runGeminiImageGeneration` 수정 (56-125번 줄 전체 교체)**

```typescript
  /** Gemini 이미지 생성 → 업로드 → AiImageSlot 배열 반환 (멀티참조) */
  const runGeminiImageGeneration = async (
    imagePromptsResponse: ImagePromptsResponse,
    referenceImageUrls: string[],
    onProgress: (done: number, total: number) => void,
  ): Promise<AiImageSlot[]> => {
    const { imagePrompts } = imagePromptsResponse;
    if (imagePrompts.length === 0) return [];

    const productImageUrls = referenceImageUrls.filter(Boolean).slice(0, 3);

    let doneCount = 0;
    const total = imagePrompts.length;

    const results = await Promise.allSettled(
      imagePrompts.map(async (p: SectionImagePrompt) => {
        const genRes = await fetch('/api/ai/generate-frame-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frameType: 'hero',
            imagePrompt: p.prompt ?? p.scene,
            ...(productImageUrls.length ? { productImageUrls } : {}),
          }),
        });
        const genData = (await genRes.json()) as { success: boolean; data?: { imageBase64: string; mimeType: string }; error?: string };
        if (!genRes.ok || !genData.success || !genData.data) {
          throw new Error(genData.error ?? 'Gemini 이미지 생성 실패');
        }

        const uploadRes = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: genData.data.imageBase64,
            mimeType: genData.data.mimeType,
            role: p.role,
          }),
        });
        const uploadData = (await uploadRes.json()) as { success: boolean; url?: string; error?: string };
        if (!uploadRes.ok || !uploadData.success || !uploadData.url) {
          throw new Error(uploadData.error ?? '이미지 업로드 실패');
        }

        doneCount++;
        onProgress(doneCount, total);

        const slot: AiImageSlot = {
          role: p.role,
          url: uploadData.url,
          prompt: p.prompt ?? p.scene,
          isReplaced: false,
        };
        return slot;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
      .map(r => r.value);
  };
```

- [ ] **Step 2: `runSceneImageGenerationFromUrl` 수정 (127-187번 줄 전체 교체)**

```typescript
  /** 기존 aiDetailContent를 재사용해서 URL 이미지들을 레퍼런스로 4개 섹션 씬 이미지 생성 (멀티참조) */
  const runSceneImageGenerationFromUrl = async (
    content: DetailPageContent,
    referenceImageUrls: string[],
  ): Promise<AiImageSlot[]> => {
    const productImageUrls = referenceImageUrls.filter(Boolean).slice(0, 3);
    const sectionTypes: Array<'hero' | 'lifestyle' | 'detail' | 'feature'> = ['hero', 'lifestyle', 'detail', 'feature'];
    let doneCount = 0;
    const results = await Promise.allSettled(
      sectionTypes.map(async (sectionType) => {
        const sceneRes = await fetch('/api/ai/generate-scene-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sectionType,
            ...(productImageUrls.length ? { productImageUrls } : {}),
            productInfo: {
              headline: content.headline,
              subheadline: content.subheadline,
              sellingPoints: content.sellingPoints.map((sp) => ({ title: sp.title, description: sp.description })),
              features: content.features.map((f) => ({ title: f.title })),
            },
          }),
        });
        const sceneData = (await sceneRes.json()) as { success: boolean; data?: { imageBase64: string; mimeType: string; prompt: string }; error?: string };
        if (!sceneRes.ok || !sceneData.success || !sceneData.data) throw new Error(sceneData.error ?? '씬 이미지 생성 실패');

        const uploadRes = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: sceneData.data.imageBase64, mimeType: sceneData.data.mimeType, role: sectionType }),
        });
        const uploadData = (await uploadRes.json()) as { success: boolean; url?: string };
        if (!uploadData.success || !uploadData.url) throw new Error('이미지 업로드 실패');

        doneCount++;
        updateAssetsDraft({ generatingMessage: `씬 이미지 생성 중 (${doneCount}/${sectionTypes.length})...` });

        return { role: sectionType, url: uploadData.url, prompt: sceneData.data.prompt, isReplaced: false } as AiImageSlot;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
      .map((r) => r.value);
  };
```

- [ ] **Step 3: `handleConfirmCrops`의 씬 생성 루프 수정 (250-320번 줄)**

크롭별 base64 변환 블록(251-273번 줄)을 삭제하고, 모든 크롭이 공유할 원본 참조 URL 집합을 루프 밖에서 계산한다. 249번 줄 `const results = await Promise.allSettled(` 바로 위에 추가:

```typescript
      // 모든 섹션이 공유할 원본 참조 이미지(최대 3장)
      const productImageUrls = [...new Set(confirmedCrops.map((c) => c.originalImageUrl))]
        .filter(Boolean)
        .slice(0, 3);
```

그리고 `confirmedCrops.map(async (crop) => { ... })` 콜백 내부에서 base64 변환부(251-273번 줄)를 제거하고, `generate-scene-image` fetch body(278-287번 줄)를 다음으로 교체:

```typescript
          const sceneRes = await fetch('/api/ai/generate-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sectionType: crop.sectionType,
              ...(productImageUrls.length ? { productImageUrls } : {}),
              productInfo: detailContent ? {
                headline: detailContent.headline,
                subheadline: detailContent.subheadline,
                sellingPoints: detailContent.sellingPoints.map((sp) => ({ title: sp.title, description: sp.description })),
                features: detailContent.features.map((f) => ({ title: f.title })),
              } : undefined,
            }),
          });
```

- [ ] **Step 4: 호출부 4곳을 배열 인자로 수정**

- 397번 줄: `runSceneImageGenerationFromUrl(existingContentUrl, thumbnails[0])` → `runSceneImageGenerationFromUrl(existingContentUrl, thumbnails)`
- 409번 줄: `runGeminiImageGeneration(result.imagePrompts, thumbnails[0], (done, total) => {` → `runGeminiImageGeneration(result.imagePrompts, thumbnails, (done, total) => {`
- 451번 줄: `runSceneImageGenerationFromUrl(existingContentUpload, detailSources[0])` → `runSceneImageGenerationFromUrl(existingContentUpload, detailSources)`
- 464번 줄: `runGeminiImageGeneration(result.imagePrompts, detailSources[0], (done, total) => {` → `runGeminiImageGeneration(result.imagePrompts, detailSources, (done, total) => {`

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/assets/AssetsTab.tsx
git commit -m "feat: AssetsTab 멀티참조 전달 — 클라이언트 base64 변환 제거, URL 배열로 전환"
```

---

## Task 7: 통합 검증

- [ ] **Step 1: 전체 테스트 통과 확인**

Run: `npx vitest run`
Expected: 기존 + 신규 테스트 모두 PASS

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 개발 서버 수동 시나리오**

Run: `npm run dev` → `http://localhost:3000/listing?tab=assets`

**시나리오 A — 업로드 3장 + AI 이미지 포함:**
1. 업로드 모드에서 상품 사진 3장(정면/측면/디테일) 업로드
2. "Gemini AI 이미지 포함 생성" 체크 ON
3. "⚡ 자동 생성" 클릭
4. Network 탭에서 `/api/ai/generate-frame-image` 요청 body에 `productImageUrls`가 **배열(최대 3개)**로 들어가는지 확인
5. 생성된 hero/lifestyle/detail/feature 이미지에서 제품 형태·로고가 보존되는지 확인

**시나리오 B — 1장만 업로드 (회귀):**
1. 1장만 업로드 → 자동 생성
2. `productImageUrls`에 1개만 담겨 정상 생성되는지 확인 (회귀 없음)

**시나리오 C — 크롭 검토 흐름:**
1. 이미지 분석 → SceneReviewPanel에서 확인 → "AI 씬 생성 시작"
2. `/api/ai/generate-scene-image` 요청 body에 `productImageUrls` 배열 전달 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "test: 멀티참조 이미지 파이프라인 통합 검증"
```
