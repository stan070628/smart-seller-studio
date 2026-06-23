# Gemini 씬 합성 파이프라인 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품상세 이미지를 분석·크롭하고 배경 제거 → Gemini 배경 씬 생성 → Sharp 합성 파이프라인으로 "제품 원본 픽셀 + AI 배경" 합성 이미지를 만들어 상세페이지 HTML에 CSS 텍스트 오버레이와 함께 표시한다.

**Architecture:** 클라이언트가 5단계(분석 → 사용자 검토 → 배경제거 → 씬생성 → 합성)를 오케스트레이션한다. 3개의 신규 API(`remove-background`, `analyze-detail-images`, `composite`)와 1개의 기존 API 수정(`generate-frame-image` maxDuration), 스토어 상태 추가, UI 컴포넌트 변경으로 구성된다.

**Tech Stack:** Next.js App Router, Zod, Sharp, Stability AI (remove-background 신규), Anthropic Claude Vision (Sonnet/Haiku), Gemini Imagen, Supabase Storage, Zustand, Vitest

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/store/useListingStore.ts` | AssetsDraft에 CropItem 타입 + pendingCrops/confirmedCrops/isAnalyzing 추가 |
| `src/app/api/ai/generate-frame-image/route.ts` | `export const maxDuration = 60` 추가 |
| `src/app/api/image/remove-background/route.ts` | 신규 — Stability AI remove-background API |
| `src/app/api/image/analyze-detail-images/route.ts` | 신규 — Claude Vision + Sharp 크롭 |
| `src/app/api/image/composite/route.ts` | 신규 — Sharp 합성 |
| `src/lib/detail-page/ai-html-builder.ts` | 각 섹션에 CSS 텍스트 오버레이 추가 |
| `src/components/listing/assets/SceneReviewPanel.tsx` | 신규 — 크롭 검토 UI |
| `src/components/listing/assets/AssetsInputPanel.tsx` | "이미지 분석" 버튼 추가 |
| `src/components/listing/assets/AssetsTab.tsx` | handleAnalyze + handleConfirmCrops 추가, 오케스트레이션 교체 |
| `src/__tests__/api/image/remove-background.test.ts` | 신규 |
| `src/__tests__/api/image/analyze-detail-images.test.ts` | 신규 |
| `src/__tests__/api/image/composite.test.ts` | 신규 |
| `src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts` | 신규 |

---

## Task 1: CropItem 타입 + AssetsDraft 상태 추가 + generate-frame-image maxDuration

**Files:**
- Modify: `src/store/useListingStore.ts`
- Modify: `src/app/api/ai/generate-frame-image/route.ts`
- Create: `src/__tests__/store/assets-draft-crop-state.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/store/assets-draft-crop-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListingStore } from '@/store/useListingStore';

describe('AssetsDraft 크롭 상태', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useListingStore());
    act(() => result.current.resetAssetsDraft());
  });

  it('초기 상태에 pendingCrops, confirmedCrops, isAnalyzing이 있다', () => {
    const { result } = renderHook(() => useListingStore());
    const { assetsDraft } = result.current;
    expect(assetsDraft.pendingCrops).toBeNull();
    expect(assetsDraft.confirmedCrops).toBeNull();
    expect(assetsDraft.isAnalyzing).toBe(false);
  });

  it('updateAssetsDraft로 pendingCrops를 설정할 수 있다', () => {
    const { result } = renderHook(() => useListingStore());
    const crop = {
      id: 'crop-hero-1',
      originalImageUrl: 'https://example.com/original.jpg',
      croppedImageUrl: 'https://example.com/cropped.jpg',
      sectionType: 'hero' as const,
    };
    act(() => result.current.updateAssetsDraft({ pendingCrops: [crop] }));
    expect(result.current.assetsDraft.pendingCrops).toEqual([crop]);
  });

  it('resetAssetsDraft 후 pendingCrops가 null로 초기화된다', () => {
    const { result } = renderHook(() => useListingStore());
    const crop = {
      id: 'crop-1',
      originalImageUrl: 'https://example.com/img.jpg',
      croppedImageUrl: 'https://example.com/img.jpg',
      sectionType: 'hero' as const,
    };
    act(() => result.current.updateAssetsDraft({ pendingCrops: [crop], isAnalyzing: true }));
    act(() => result.current.resetAssetsDraft());
    expect(result.current.assetsDraft.pendingCrops).toBeNull();
    expect(result.current.assetsDraft.isAnalyzing).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/__tests__/store/assets-draft-crop-state.test.ts
```

Expected: FAIL — `pendingCrops` is not a property of `AssetsDraft`

- [ ] **Step 3: useListingStore.ts에 CropItem 타입과 신규 상태 추가**

`src/store/useListingStore.ts`에서 `AssetsDraft` 인터페이스를 찾아 다음 3개 필드를 추가하고, `ASSETS_DRAFT_INITIAL` 객체에도 초기값을 추가한다.

```typescript
// AssetsDraft 인터페이스 내부에 추가
export interface CropItem {
  id: string;
  originalImageUrl: string;
  cropBox?: { x: number; y: number; width: number; height: number }; // 정규화 0~1
  sectionType: 'hero' | 'lifestyle' | 'detail' | 'feature';
  croppedImageUrl: string;
}

// AssetsDraft 인터페이스 필드 추가
pendingCrops: CropItem[] | null;
confirmedCrops: CropItem[] | null;
isAnalyzing: boolean;

// ASSETS_DRAFT_INITIAL 객체 내 추가
pendingCrops: null,
confirmedCrops: null,
isAnalyzing: false,
```

- [ ] **Step 4: generate-frame-image에 maxDuration 추가**

`src/app/api/ai/generate-frame-image/route.ts` 파일 상단(imports 아래)에 추가:

```typescript
export const maxDuration = 60;
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/store/assets-draft-crop-state.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/store/useListingStore.ts src/app/api/ai/generate-frame-image/route.ts src/__tests__/store/assets-draft-crop-state.test.ts
git commit -m "feat: CropItem 타입 + AssetsDraft 크롭 상태 추가, generate-frame-image maxDuration"
```

---

## Task 2: remove-background API route

**Files:**
- Create: `src/app/api/image/remove-background/route.ts`
- Create: `src/__tests__/api/image/remove-background.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/api/image/remove-background.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/bg-removed.png' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:remove-background'),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/remove-background', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/remove-background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STABILITY_API_KEY = 'test-stability-key';
  });

  it('유효한 imageUrl → 200 OK와 transparentImageUrl 반환', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)) });

    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.transparentImageUrl).toBe('https://storage.example.com/bg-removed.png');
  });

  it('imageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('STABILITY_API_KEY 없음 → 500', async () => {
    delete process.env.STABILITY_API_KEY;
    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    expect(res.status).toBe(500);
  });

  it('Stability AI 실패 → 502', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error') });

    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/__tests__/api/image/remove-background.test.ts
```

Expected: FAIL — module `@/app/api/image/remove-background/route` not found

- [ ] **Step 3: route 구현**

```typescript
// src/app/api/image/remove-background/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestSchema = z.object({
  imageUrl: z.string().url('유효한 이미지 URL이 아닙니다.'),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'remove-background'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'STABILITY_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { imageUrl } = parsed.data;

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    return NextResponse.json({ success: false, error: '이미지를 가져오지 못했습니다.' }, { status: 400 });
  }
  const imgBuffer = await imgRes.arrayBuffer();

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(imgBuffer)], { type: 'image/png' }), 'image.png');
  form.append('output_format', 'png');

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(30_000)
      : undefined;

  const stabilityRes = await fetch(
    'https://api.stability.ai/v2beta/stable-image/edit/remove-background',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'image/*' },
      body: form,
      ...(signal ? { signal } : {}),
    },
  );

  if (!stabilityRes.ok) {
    const text = await stabilityRes.text().catch(() => '');
    return NextResponse.json(
      { success: false, error: `배경 제거 실패 (${stabilityRes.status}): ${text.slice(0, 120)}` },
      { status: 502 },
    );
  }

  const pngBuffer = await stabilityRes.arrayBuffer();
  const path = `ai-detail/${Date.now()}-bg-removed.png`;
  const result = await uploadToStorage(path, pngBuffer, 'image/png', pngBuffer.byteLength);

  return NextResponse.json({ success: true, data: { transparentImageUrl: result.url } });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/image/remove-background.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/image/remove-background/route.ts src/__tests__/api/image/remove-background.test.ts
git commit -m "feat: remove-background API — Stability AI 신규 연동"
```

---

## Task 3: analyze-detail-images API route

**Files:**
- Create: `src/app/api/image/analyze-detail-images/route.ts`
- Create: `src/__tests__/api/image/analyze-detail-images.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/api/image/analyze-detail-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn(),
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/cropped.jpg' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:analyze-detail-images'),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg' }),
    extract: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-cropped-image')),
  })),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/analyze-detail-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/analyze-detail-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(500)),
    });
  });

  it('개별 이미지 1장 → 4개 섹션 crops 반환 (섹션 재사용)', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: 'text', text: 'hero' }],
    });

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/product.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.crops).toHaveLength(4);
    expect(data.crops.map((c: { sectionType: string }) => c.sectionType)).toEqual(['hero', 'lifestyle', 'detail', 'feature']);
  });

  it('긴 이미지 (height > 2.5× width) → Claude Vision cropBox 제안 사용', async () => {
    const sharpMock = await import('sharp');
    (sharpMock.default as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      metadata: vi.fn().mockResolvedValue({ width: 400, height: 2000, format: 'jpeg' }),
      extract: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake')),
    }));

    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          crops: [
            { sectionType: 'hero', cropBox: { x: 0, y: 0, width: 1, height: 0.25 } },
            { sectionType: 'lifestyle', cropBox: { x: 0, y: 0.25, width: 1, height: 0.25 } },
          ],
        }),
      }],
    });

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/long.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.crops.some((c: { cropBox?: unknown }) => c.cropBox !== undefined)).toBe(true);
  });

  it('imageUrls 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('Claude Vision 실패 → 폴백으로 이미지 순서대로 섹션 매핑', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Claude 오류'));

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.crops).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/__tests__/api/image/analyze-detail-images.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: route 구현**

```typescript
// src/app/api/image/analyze-detail-images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { getAnthropicClient } from '@/lib/ai/claude';
import { uploadToStorage } from '@/lib/supabase/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

type SectionType = 'hero' | 'lifestyle' | 'detail' | 'feature';
const SECTIONS: SectionType[] = ['hero', 'lifestyle', 'detail', 'feature'];

const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(8),
});

interface ProcessedImage {
  originalImageUrl: string;
  croppedImageUrl: string;
  suggestedSectionType: SectionType;
  cropBox?: { x: number; y: number; width: number; height: number };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'analyze-detail-images'), RATE_LIMIT);
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

  const { imageUrls } = parsed.data;
  const client = getAnthropicClient();
  const processedImages: ProcessedImage[] = [];

  for (const imageUrl of imageUrls) {
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) continue;
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      const metadata = await sharp(imgBuffer).metadata();
      const { width = 0, height = 0, format } = metadata;
      const isLongImage = height > 2.5 * width;
      const mediaType = format === 'png' ? 'image/png' : 'image/jpeg';
      const imageBase64 = imgBuffer.toString('base64');

      if (isLongImage) {
        try {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png', data: imageBase64 },
                },
                {
                  type: 'text',
                  text: `이 상품상세 이미지에서 히어로(대표 제품), 라이프스타일(생활 연출), 디테일(소재/클로즈업), 특징(기능 강조) 섹션에 쓸 수 있는 영역을 JSON으로 반환하세요. 좌표는 이미지 전체 크기 대비 0~1 비율입니다. {"crops":[{"sectionType":"hero"|"lifestyle"|"detail"|"feature","cropBox":{"x":0~1,"y":0~1,"width":0~1,"height":0~1}}]}. JSON만 반환하세요.`,
                },
              ],
            }],
          });

          const text = response.content[0].type === 'text' ? response.content[0].text : '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as {
              crops?: Array<{ sectionType: SectionType; cropBox: { x: number; y: number; width: number; height: number } }>;
            };

            for (const crop of (parsed.crops ?? []).slice(0, 4)) {
              const cb = crop.cropBox;
              const x = Math.max(0, Math.min(0.99, cb.x));
              const y = Math.max(0, Math.min(0.99, cb.y));
              const w = Math.max(0.05, Math.min(1 - x, cb.width));
              const h = Math.max(0.05, Math.min(1 - y, cb.height));

              if (w < 0.1 || h < 0.1) {
                processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: crop.sectionType });
                continue;
              }

              const left = Math.round(x * width);
              const top = Math.round(y * height);
              const cropWidth = Math.round(w * width);
              const cropHeight = Math.round(h * height);

              const croppedBuffer = await sharp(imgBuffer)
                .extract({ left, top, width: cropWidth, height: cropHeight })
                .toBuffer();

              const croppedArrayBuffer = croppedBuffer.buffer.slice(
                croppedBuffer.byteOffset,
                croppedBuffer.byteOffset + croppedBuffer.byteLength,
              );
              const croppedPath = `ai-detail/${Date.now()}-crop-${crop.sectionType}.jpg`;
              const uploadResult = await uploadToStorage(croppedPath, croppedArrayBuffer, 'image/jpeg', croppedBuffer.byteLength);

              processedImages.push({
                originalImageUrl: imageUrl,
                croppedImageUrl: uploadResult.url,
                suggestedSectionType: crop.sectionType,
                cropBox: { x, y, width: w, height: h },
              });
            }
          } else {
            processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: 'hero' });
          }
        } catch {
          processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: 'hero' });
        }
      } else {
        let sectionType: SectionType = 'hero';
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png', data: imageBase64 } },
                { type: 'text', text: '이 이미지의 역할을 하나만 반환하세요: hero, lifestyle, detail, feature' },
              ],
            }],
          });
          const text = response.content[0].type === 'text' ? response.content[0].text.trim().toLowerCase() : 'hero';
          if (SECTIONS.includes(text as SectionType)) sectionType = text as SectionType;
        } catch {
          // keep default 'hero'
        }
        processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: sectionType });
      }
    } catch {
      // skip failed images
    }
  }

  if (processedImages.length === 0) {
    const fallbackUrl = imageUrls[0] ?? '';
    SECTIONS.forEach((s) => processedImages.push({ originalImageUrl: fallbackUrl, croppedImageUrl: fallbackUrl, suggestedSectionType: s }));
  }

  // 4개 섹션 모두 채우기: 부족한 섹션은 circular reuse
  const crops = SECTIONS.map((sectionType, idx) => {
    const existing = processedImages.find(p => p.suggestedSectionType === sectionType);
    const fallback = processedImages[idx % processedImages.length];
    const source = existing ?? fallback;
    return {
      id: `crop-${sectionType}-${Date.now()}-${idx}`,
      originalImageUrl: source.originalImageUrl,
      croppedImageUrl: source.croppedImageUrl,
      sectionType,
      ...(source.cropBox ? { cropBox: source.cropBox } : {}),
    };
  });

  return NextResponse.json({ success: true, crops });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/image/analyze-detail-images.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/image/analyze-detail-images/route.ts src/__tests__/api/image/analyze-detail-images.test.ts
git commit -m "feat: analyze-detail-images API — Claude Vision 크롭 분석"
```

---

## Task 4: composite API route

**Files:**
- Create: `src/app/api/image/composite/route.ts`
- Create: `src/__tests__/api/image/composite.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/api/image/composite.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/composite.jpg' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:composite'),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
  })),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/composite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/composite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)),
    });
  });

  it('유효한 URL 2개 → 200 OK와 합성 이미지 URL 반환', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({
      productImageUrl: 'https://example.com/product-transparent.png',
      backgroundImageUrl: 'https://example.com/gemini-background.jpg',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.url).toBe('https://storage.example.com/composite.jpg');
  });

  it('productImageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({ backgroundImageUrl: 'https://example.com/bg.jpg' }));
    expect(res.status).toBe(400);
  });

  it('backgroundImageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({ productImageUrl: 'https://example.com/product.png' }));
    expect(res.status).toBe(400);
  });

  it('이미지 fetch 실패 → 400', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({
      productImageUrl: 'https://example.com/product.png',
      backgroundImageUrl: 'https://example.com/bg.jpg',
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/__tests__/api/image/composite.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: route 구현**

```typescript
// src/app/api/image/composite/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const RequestSchema = z.object({
  productImageUrl: z.string().url('유효한 제품 이미지 URL이 아닙니다.'),
  backgroundImageUrl: z.string().url('유효한 배경 이미지 URL이 아닙니다.'),
  placement: z.enum(['center', 'bottom-center']).optional().default('bottom-center'),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'composite'), RATE_LIMIT);
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

  const { productImageUrl, backgroundImageUrl, placement } = parsed.data;

  const [bgRes, productRes] = await Promise.all([
    fetch(backgroundImageUrl),
    fetch(productImageUrl),
  ]);

  if (!bgRes.ok || !productRes.ok) {
    return NextResponse.json({ success: false, error: '이미지를 가져오지 못했습니다.' }, { status: 400 });
  }

  const [bgBuffer, productBuffer] = await Promise.all([
    bgRes.arrayBuffer().then(ab => Buffer.from(ab)),
    productRes.arrayBuffer().then(ab => Buffer.from(ab)),
  ]);

  const productResized = await sharp(productBuffer)
    .resize({
      height: Math.round(1024 * 0.68),
      width: Math.round(1024 * 0.68),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  const resultBuffer = await sharp(bgBuffer)
    .resize(1024, 1024, { fit: 'cover' })
    .composite([{
      input: productResized,
      gravity: placement === 'bottom-center' ? 'south' : 'centre',
    }])
    .jpeg({ quality: 90 })
    .toBuffer();

  const resultArrayBuffer = resultBuffer.buffer.slice(
    resultBuffer.byteOffset,
    resultBuffer.byteOffset + resultBuffer.byteLength,
  );
  const path = `ai-detail/${Date.now()}-composite.jpg`;
  const result = await uploadToStorage(path, resultArrayBuffer, 'image/jpeg', resultBuffer.byteLength);

  return NextResponse.json({ success: true, data: { url: result.url } });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/image/composite.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/image/composite/route.ts src/__tests__/api/image/composite.test.ts
git commit -m "feat: composite API — Sharp URL 기반 합성"
```

---

## Task 5: ai-html-builder CSS 텍스트 오버레이

**Files:**
- Modify: `src/lib/detail-page/ai-html-builder.ts`
- Create: `src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts
import { describe, it, expect } from 'vitest';
import { buildAiDetailPageHtml } from '@/lib/detail-page/ai-html-builder';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

const mockContent: DetailPageContent = {
  headline: '프리미엄 텀블러',
  subheadline: '보온 24시간 보장',
  sellingPoints: ['스테인리스 소재로 위생적', '슬림한 디자인으로 휴대 편리'],
  features: ['이중 진공 구조', '300ml 용량', 'BPA 프리'],
  specs: [{ label: '용량', value: '300ml' }],
  usageSteps: ['뚜껑을 열고 음료를 붓는다', '뚜껑을 닫는다'],
  warnings: ['전자레인지 사용 금지'],
};

const heroSlot: AiImageSlot = {
  role: 'hero',
  url: 'https://storage.example.com/hero.jpg',
  prompt: 'dramatic studio background',
  isReplaced: false,
};

const featureSlot: AiImageSlot = {
  role: 'feature',
  url: 'https://storage.example.com/feature.jpg',
  prompt: 'abstract background',
  isReplaced: false,
};

describe('buildAiDetailPageHtml — CSS 텍스트 오버레이', () => {
  it('hero 섹션에 이미지가 있을 때 headline이 오버레이로 포함된다', () => {
    const html = buildAiDetailPageHtml(mockContent, [heroSlot]);
    expect(html).toContain('프리미엄 텀블러');
    expect(html).toContain(heroSlot.url);
    expect(html).toContain('position:absolute');
  });

  it('feature 섹션에 이미지가 있을 때 features 목록이 오버레이로 포함된다', () => {
    const html = buildAiDetailPageHtml(mockContent, [featureSlot]);
    expect(html).toContain('이중 진공 구조');
    expect(html).toContain(featureSlot.url);
    expect(html).toContain('position:absolute');
  });

  it('슬롯 없이도 텍스트 콘텐츠는 fallback으로 표시된다', () => {
    const html = buildAiDetailPageHtml(mockContent, []);
    expect(html).toContain('프리미엄 텀블러');
    expect(html).toContain('스테인리스 소재로 위생적');
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts
```

Expected: FAIL — `position:absolute`이 HTML에 없음 (현재 오버레이 없음)

- [ ] **Step 3: ai-html-builder.ts 섹션 빌더에 오버레이 추가**

`src/lib/detail-page/ai-html-builder.ts`에서 각 섹션 빌더 함수를 다음과 같이 수정한다. 기존 escapeHtml 함수는 그대로 유지.

**buildHeroSection 수정** — 이미지 하단 그라데이션 오버레이 추가:

```typescript
function buildHeroSection(content: DetailPageContent, slot?: AiImageSlot): string {
  if (!slot) {
    return `<div style="padding:32px 28px;background:#f8f9fa;">
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#111;line-height:1.3;">${escapeHtml(content.headline)}</h1>
      <p style="margin:0;font-size:16px;color:#555;line-height:1.6;">${escapeHtml(content.subheadline ?? '')}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:500px;object-fit:cover;" alt="" />
    <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.72));padding:28px 28px 24px;">
      <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#fff;line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,0.4);">${escapeHtml(content.headline)}</h1>
      <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.88);line-height:1.5;">${escapeHtml(content.subheadline ?? '')}</p>
    </div>
  </div>`;
}
```

**buildLifestyleSection 수정** — 이미지 좌측 반투명 패널 오버레이:

```typescript
function buildLifestyleSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const text = content.sellingPoints?.[0] ?? '';
  if (!slot) {
    return `<div style="padding:28px;background:#fff;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:15px;color:#444;line-height:1.7;">${escapeHtml(text)}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;top:0;left:0;bottom:0;width:42%;background:rgba(255,255,255,0.88);padding:24px 20px;display:flex;align-items:center;box-sizing:border-box;">
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">${escapeHtml(text)}</p>
    </div>
  </div>`;
}
```

**buildDetailSection 수정** — 이미지 우측 반투명 패널 오버레이:

```typescript
function buildDetailSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const text = content.sellingPoints?.[1] ?? '';
  if (!slot) {
    return `<div style="padding:28px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:15px;color:#444;line-height:1.7;">${escapeHtml(text)}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;top:0;right:0;bottom:0;width:42%;background:rgba(255,255,255,0.88);padding:24px 20px;display:flex;align-items:center;box-sizing:border-box;">
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">${escapeHtml(text)}</p>
    </div>
  </div>`;
}
```

**buildFeatureSection 수정** — 이미지 하단 feature 태그 오버레이:

```typescript
function buildFeatureSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const tags = (content.features ?? [])
    .map(f => `<span style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:500;">${escapeHtml(f)}</span>`)
    .join(' ');

  if (!slot) {
    return `<div style="padding:28px;background:#fff;border-top:1px solid #f0f0f0;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${(content.features ?? []).map(f => `<span style="display:inline-block;background:#f0f4ff;border:1px solid #c7d7ff;color:#2952a3;padding:5px 14px;border-radius:20px;font-size:13px;">${escapeHtml(f)}</span>`).join('')}</div>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.62);padding:16px 20px;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${tags}</div>
    </div>
  </div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/ai-html-builder.ts src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts
git commit -m "feat: ai-html-builder 섹션별 CSS 텍스트 오버레이 추가"
```

---

## Task 6: SceneReviewPanel 컴포넌트 + AssetsInputPanel 분석 버튼

**Files:**
- Create: `src/components/listing/assets/SceneReviewPanel.tsx`
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`

- [ ] **Step 1: SceneReviewPanel 컴포넌트 작성**

```typescript
// src/components/listing/assets/SceneReviewPanel.tsx
'use client';

import React, { useState } from 'react';
import type { CropItem } from '@/store/useListingStore';

type SectionType = 'hero' | 'lifestyle' | 'detail' | 'feature';
const SECTION_LABELS: Record<SectionType, string> = {
  hero: '히어로',
  lifestyle: '라이프스타일',
  detail: '디테일',
  feature: '특징',
};

interface Props {
  crops: CropItem[];
  onConfirm: (crops: CropItem[]) => void;
  onCancel: () => void;
}

export default function SceneReviewPanel({ crops, onConfirm, onCancel }: Props) {
  const [editedCrops, setEditedCrops] = useState<CropItem[]>(crops);

  const updateCrop = (id: string, patch: Partial<CropItem>) =>
    setEditedCrops(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const removeCrop = (id: string) =>
    setEditedCrops(prev => prev.filter(c => c.id !== id));

  const handleFileChange = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = ev => updateCrop(id, { croppedImageUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, backgroundColor: '#fafafa', marginTop: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#111' }}>씬 이미지 검토 — 사용할 영역을 확인해 주세요</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        {editedCrops.map(crop => (
          <div key={crop.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', backgroundColor: '#fff' }}>
            <label htmlFor={`crop-file-${crop.id}`} style={{ cursor: 'pointer', display: 'block', lineHeight: 0, position: 'relative' }}>
              <img
                src={crop.croppedImageUrl}
                alt={crop.sectionType}
                style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }}
              />
              <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
                클릭해 교체
              </div>
              <input
                id={`crop-file-${crop.id}`}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(crop.id, f); }}
              />
            </label>
            <div style={{ padding: '8px 8px 10px' }}>
              <select
                value={crop.sectionType}
                onChange={e => updateCrop(crop.id, { sectionType: e.target.value as SectionType })}
                style={{ width: '100%', fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 6, color: '#374151' }}
              >
                {(Object.entries(SECTION_LABELS) as [SectionType, string][]).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <button
                onClick={() => removeCrop(crop.id)}
                style={{ width: '100%', fontSize: 11, padding: '3px 0', border: '1px solid #fca5a5', borderRadius: 4, backgroundColor: '#fff', color: '#dc2626', cursor: 'pointer' }}
              >
                제외
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}
        >
          취소
        </button>
        <button
          onClick={() => onConfirm(editedCrops)}
          disabled={editedCrops.length === 0}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 6, fontSize: 13, cursor: editedCrops.length === 0 ? 'not-allowed' : 'pointer', backgroundColor: editedCrops.length === 0 ? '#93c5fd' : '#2563eb', color: '#fff', fontWeight: 600 }}
        >
          확인 — AI 씬 생성 시작
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AssetsInputPanel에 분석 버튼 추가**

`src/components/listing/assets/AssetsInputPanel.tsx`를 열어 Props 인터페이스와 버튼 렌더링 부분을 수정한다.

**Props 인터페이스에 추가:**
```typescript
interface Props {
  onGenerate: () => void;
  onAnalyze: () => void;   // 신규 추가
}
```

**컴포넌트 선언부 수정:**
```typescript
export default function AssetsInputPanel({ onGenerate, onAnalyze }: Props) {
```

**기존 "⚡ 자동 생성" 버튼 아래에 조건부 분석 버튼 추가:**

`includeAiImages`가 true일 때 "자동 생성" 버튼 텍스트를 유지하되, "이미지 분석" 버튼을 추가로 보여준다. 분석 버튼은 upload 모드에서 파일이 있거나 url 모드에서 URL이 있을 때만 활성화된다.

```typescript
// 기존 자동 생성 버튼 아래에 추가
{includeAiImages && (
  <button
    onClick={onAnalyze}
    disabled={!canGenerate || isGenerating || isAnalyzing}
    style={{
      width: '100%',
      padding: '10px 0',
      backgroundColor: canGenerate && !isGenerating && !isAnalyzing ? '#7c3aed' : '#c4b5fd',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 600,
      cursor: canGenerate && !isGenerating && !isAnalyzing ? 'pointer' : 'not-allowed',
      marginTop: 6,
    }}
  >
    {isAnalyzing ? '이미지 분석 중...' : '🔍 씬 이미지 분석'}
  </button>
)}
```

`useListingStore`에서 `isAnalyzing`을 추가로 구조분해한다:
```typescript
const { assetsDraft, updateAssetsDraft, sharedDraft } = useListingStore();
const { ..., isAnalyzing } = assetsDraft;
```

- [ ] **Step 3: 빌드 오류 없는지 확인**

```bash
npx tsc --noEmit
```

Expected: 타입 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/assets/SceneReviewPanel.tsx src/components/listing/assets/AssetsInputPanel.tsx
git commit -m "feat: SceneReviewPanel 컴포넌트 + AssetsInputPanel 분석 버튼 추가"
```

---

## Task 7: AssetsTab 오케스트레이션 교체

**Files:**
- Modify: `src/components/listing/assets/AssetsTab.tsx`

- [ ] **Step 1: AssetsTab.tsx 전체 수정**

`src/components/listing/assets/AssetsTab.tsx`를 열어 다음 변경을 적용한다.

**import 추가:**
```typescript
import SceneReviewPanel from './SceneReviewPanel';
import type { CropItem } from '@/store/useListingStore';
```

**섹션별 Gemini 배경 프롬프트 상수 추가** (컴포넌트 밖):
```typescript
const SECTION_PROMPTS: Record<'hero' | 'lifestyle' | 'detail' | 'feature', string> = {
  hero: 'Clean studio background with dramatic gradient lighting. Empty product display space, minimal and elegant. Photographic quality. No objects, no text.',
  lifestyle: 'Natural living space with warm ambient lighting. Marble table or wooden shelf with morning window light. No people, no text.',
  detail: 'Minimal textured surface (linen or stone). Soft diffused macro photography light. Clean and focused composition. No distractions.',
  feature: 'Abstract geometric background suggesting the product function. Brand-appropriate color palette. No text, no objects.',
};
```

**handleAnalyze 함수 추가** (handleGenerate 위에):
```typescript
const handleAnalyze = async () => {
  const { mode, url, thumbnailFiles, detailFiles } = assetsDraft;
  const imageUrls = mode === 'url'
    ? [url.trim()]
    : (detailFiles.length > 0 ? detailFiles : thumbnailFiles);

  if (imageUrls.length === 0 || imageUrls[0] === '') return;

  updateAssetsDraft({ isAnalyzing: true, lastError: null });
  try {
    const res = await fetch('/api/image/analyze-detail-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrls: imageUrls.slice(0, 8) }),
    });
    const data = (await res.json()) as { success: boolean; crops?: CropItem[]; error?: string };
    if (!res.ok || !data.success || !data.crops) {
      throw new Error(data.error ?? '이미지 분석 실패');
    }
    updateAssetsDraft({ isAnalyzing: false, pendingCrops: data.crops });
  } catch (e) {
    updateAssetsDraft({
      isAnalyzing: false,
      lastError: e instanceof Error ? e.message : '이미지 분석 중 오류가 발생했습니다.',
    });
  }
};
```

**handleConfirmCrops 함수 추가** (handleAnalyze 아래):
```typescript
const handleConfirmCrops = async (confirmedCrops: CropItem[]) => {
  updateAssetsDraft({
    pendingCrops: null,
    confirmedCrops,
    isGenerating: true,
    generatingMessage: '상세페이지 분석 중...',
    lastError: null,
  });

  try {
    const imageUrls = [...new Set(confirmedCrops.map(c => c.originalImageUrl))];

    // 1. 상세페이지 HTML 콘텐츠 생성 (imagePrompts 불필요)
    updateAssetsDraft({ generatingMessage: '상세페이지 HTML 생성 중...' });
    const { html: baseHtml, content: detailContent } = await generateDetailHtml(imageUrls, false);

    // 2. 배경 제거 (동일 URL dedupe)
    updateAssetsDraft({ generatingMessage: '배경 제거 중...' });
    const uniqueCroppedUrls = [...new Set(confirmedCrops.map(c => c.croppedImageUrl))];
    const bgMap: Record<string, string> = {};

    await Promise.all(
      uniqueCroppedUrls.map(async (croppedUrl) => {
        const res = await fetch('/api/image/remove-background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: croppedUrl }),
        });
        const data = (await res.json()) as { success: boolean; data?: { transparentImageUrl: string } };
        bgMap[croppedUrl] = data.success && data.data ? data.data.transparentImageUrl : croppedUrl;
      }),
    );

    // 3. Gemini 씬 생성 + 합성 (병렬)
    let doneCount = 0;
    const results = await Promise.allSettled(
      confirmedCrops.map(async (crop) => {
        const productUrl = bgMap[crop.croppedImageUrl] ?? crop.croppedImageUrl;
        const prompt = SECTION_PROMPTS[crop.sectionType];

        // Gemini 배경 씬 생성 (productImageBase64 미전송)
        const genRes = await fetch('/api/ai/generate-frame-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frameType: crop.sectionType, imagePrompt: prompt }),
        });
        const genData = (await genRes.json()) as {
          success: boolean;
          data?: { imageBase64: string; mimeType: string };
          error?: string;
        };
        if (!genRes.ok || !genData.success || !genData.data) {
          throw new Error(genData.error ?? 'Gemini 씬 생성 실패');
        }

        // Gemini 배경 업로드
        const uploadRes = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: genData.data.imageBase64,
            mimeType: genData.data.mimeType,
            role: crop.sectionType,
          }),
        });
        const uploadData = (await uploadRes.json()) as { success: boolean; url?: string };
        if (!uploadData.success || !uploadData.url) throw new Error('배경 이미지 업로드 실패');

        // Sharp 합성
        const compositeRes = await fetch('/api/image/composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productImageUrl: productUrl,
            backgroundImageUrl: uploadData.url,
            placement: 'bottom-center',
          }),
        });
        const compositeData = (await compositeRes.json()) as {
          success: boolean;
          data?: { url: string };
          error?: string;
        };
        if (!compositeData.success || !compositeData.data) {
          throw new Error(compositeData.error ?? '합성 실패');
        }

        doneCount++;
        updateAssetsDraft({ generatingMessage: `이미지 합성 중 (${doneCount}/${confirmedCrops.length})...` });

        return {
          role: crop.sectionType,
          url: compositeData.data.url,
          prompt,
          isReplaced: false,
        } as AiImageSlot;
      }),
    );

    const aiSlots = results
      .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
      .map(r => r.value);

    let finalHtml = baseHtml;
    let finalContent = detailContent;

    if (aiSlots.length > 0 && detailContent) {
      updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
      finalHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
    }

    let detailPageSections = assetsDraft.detailPageSections;
    if (finalContent) {
      try { detailPageSections = contentToSections(finalContent); } catch { /* silent */ }
    }

    updateAssetsDraft({
      isGenerating: false,
      generatingMessage: null,
      generatedDetailHtml: finalHtml,
      detailPageSections,
      aiImageSlots: aiSlots,
      aiDetailContent: finalContent ?? null,
      confirmedCrops: null,
    });
  } catch (e) {
    updateAssetsDraft({
      isGenerating: false,
      generatingMessage: null,
      lastError: e instanceof Error ? e.message : '알 수 없는 오류',
    });
  }
};
```

**AssetsInputPanel에 onAnalyze prop 전달:**
```typescript
// JSX 내부 AssetsInputPanel 호출 변경
<AssetsInputPanel onGenerate={handleGenerate} onAnalyze={handleAnalyze} />
```

**SceneReviewPanel 조건부 렌더링 추가** — AssetsInputPanel/AssetsResultPanel 그리드 아래, 진행 메시지 위:
```typescript
{assetsDraft.pendingCrops && (
  <SceneReviewPanel
    crops={assetsDraft.pendingCrops}
    onConfirm={handleConfirmCrops}
    onCancel={() => updateAssetsDraft({ pendingCrops: null, isAnalyzing: false })}
  />
)}
```

- [ ] **Step 2: 타입 오류 확인**

```bash
npx tsc --noEmit
```

Expected: 타입 오류 없음

- [ ] **Step 3: 전체 테스트 통과 확인**

```bash
npx vitest run
```

Expected: 기존 테스트 포함 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/assets/AssetsTab.tsx
git commit -m "feat: AssetsTab 씬 합성 파이프라인 오케스트레이션 — handleAnalyze + handleConfirmCrops"
```

---

## Task 8: 통합 검증

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

- [ ] **Step 2: `http://localhost:3000/listing?tab=assets` 접속 후 시나리오 검증**

**시나리오 A — 개별 이미지 4장:**
1. Upload 모드에서 상세페이지 이미지 4장 업로드
2. "Gemini AI 이미지 포함 생성" 체크 ON 확인
3. "🔍 씬 이미지 분석" 버튼 클릭
4. SceneReviewPanel에 히어로/라이프스타일/디테일/특징 4개 크롭 표시 확인
5. 한 개 슬롯의 섹션 타입을 드롭다운으로 변경
6. "확인 — AI 씬 생성 시작" 클릭
7. "배경 제거 중..." → "이미지 합성 중 (1/4)..." 진행 메시지 확인
8. 최종 HTML에 각 섹션 이미지 + CSS 텍스트 오버레이 표시 확인

**시나리오 B — 이미지 1장:**
1. 이미지 1장만 업로드
2. 분석 → 4개 섹션 모두 동일 이미지 reuse 확인
3. 씬 생성 후 4개의 서로 다른 배경 확인

**시나리오 C — Gemini AI 이미지 포함 생성 OFF:**
1. "Gemini AI 이미지 포함 생성" 체크 OFF
2. "⚡ 자동 생성" 버튼만 보이고 "🔍 씬 이미지 분석" 없음 확인
3. 자동 생성 클릭 → 기존 HTML 생성 정상 동작 확인

- [ ] **Step 3: Network 탭 확인**

- `/api/image/analyze-detail-images` 요청 → `{ success: true, crops: [...] }` 응답
- `/api/image/remove-background` 요청 → `{ success: true, data: { transparentImageUrl } }` 응답
- `/api/ai/generate-frame-image` 요청 body에 `productImageBase64` 없음 확인
- `/api/image/composite` 요청 → `{ success: true, data: { url } }` 응답

- [ ] **Step 4: 최종 커밋**

```bash
git add .
git commit -m "feat: Gemini 씬 합성 파이프라인 완성 — 분석·검토·배경제거·합성 end-to-end"
```
