# 이미지 영역 선택 한자 제거 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 상품 이미지에서 드래그로 한자 영역을 선택하면, 해당 부분만 Gemini가 정리하고 결과를 미리보기 후 교체 또는 추가할 수 있는 `ImageCleanupModal` + API를 구현한다.

**Architecture:** `POST /api/ai/cleanup-image-region` 가 SSRF 검증 → EXIF 회전 → 패딩 크롭 → Gemini → 톤매칭 → 알파 페더링 합성 파이프라인을 실행하고 base64를 반환한다. `ImageCleanupModal` 은 드래그 선택 → 처리 중 → 미리보기 3단계 phase를 관리하며, [교체]/[새로 추가] 확정 시에만 `/api/image/upload-ai`를 호출한다. 다시 실행 시 고아 파일이 생기지 않는다.

**Tech Stack:** Next.js App Router, Sharp (image pipeline), `@google/genai` Gemini 2.5 Flash, Supabase Storage (`/api/image/upload-ai` 경유), Vitest + `vi.mock`

---

## 파일 목록

| 상태 | 경로 | 역할 |
|---|---|---|
| 신규 | `src/app/api/ai/cleanup-image-region/route.ts` | 영역 한자 제거 API |
| 신규 | `src/components/common/ImageCleanupModal.tsx` | 드래그 선택 + 미리보기 모달 |
| 수정 | `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 이미지 그리드에 "한자 제거" 버튼 |
| 수정 | `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` | 썸네일 참조 이미지에 동일 버튼 |
| 수정 | `src/app/listing/detail-maker/DetailMakerClient.tsx` | handleReplaceImage / handleAddImage 콜백 |
| 신규 | `src/__tests__/api/cleanup-image-region.test.ts` | API 단위 테스트 |
| 신규 | `src/__tests__/components/ImageCleanupModal.test.tsx` | 모달 단위 테스트 |

---

## Task 1: API 라우트 + 테스트

**Files:**
- Create: `src/app/api/ai/cleanup-image-region/route.ts`
- Create: `src/__tests__/api/cleanup-image-region.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/cleanup-image-region.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: { generateContent: (...args: unknown[]) => mockGenerateContent(...args) },
  }),
}));

// Sharp mock — fluent builder 패턴 전체 스텁
const FAKE_BUF = Buffer.from('fake');
const mockSharpInstance = {
  rotate: vi.fn(),
  metadata: vi.fn().mockResolvedValue({ width: 500, height: 500 }),
  clone: vi.fn(),
  resize: vi.fn(),
  extract: vi.fn(),
  png: vi.fn(),
  jpeg: vi.fn(),
  stats: vi.fn().mockResolvedValue({
    channels: [{ mean: 120 }, { mean: 120 }, { mean: 120 }],
  }),
  linear: vi.fn(),
  ensureAlpha: vi.fn(),
  composite: vi.fn(),
  blur: vi.fn(),
  toBuffer: vi.fn().mockResolvedValue(FAKE_BUF),
};
// 모든 메서드가 자신을 반환하도록 설정 (fluent chain 지원)
Object.keys(mockSharpInstance).forEach(k => {
  const fn = mockSharpInstance[k as keyof typeof mockSharpInstance];
  if (typeof fn === 'function' && k !== 'metadata' && k !== 'stats' && k !== 'toBuffer') {
    (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance);
  }
});

vi.mock('sharp', () => ({ default: vi.fn().mockReturnValue(mockSharpInstance) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '@/app/api/ai/cleanup-image-region/route';

const SUPABASE_URL =
  'https://abcdef.supabase.co/storage/v1/object/public/images/test.jpg';
const VALID_REGION = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
const MOCK_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const MOCK_GEMINI_RESPONSE = {
  candidates: [{
    content: {
      parts: [{ inlineData: { data: MOCK_IMAGE_BASE64, mimeType: 'image/png' } }],
    },
  }],
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/cleanup-image-region', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sharp 체인 재설정
  Object.keys(mockSharpInstance).forEach(k => {
    const fn = mockSharpInstance[k as keyof typeof mockSharpInstance];
    if (typeof fn === 'function' && k !== 'metadata' && k !== 'stats' && k !== 'toBuffer') {
      (fn as ReturnType<typeof vi.fn>).mockReturnValue(mockSharpInstance);
    }
  });
  mockSharpInstance.metadata.mockResolvedValue({ width: 500, height: 500 });
  mockSharpInstance.stats.mockResolvedValue({
    channels: [{ mean: 120 }, { mean: 120 }, { mean: 120 }],
  });
  mockSharpInstance.toBuffer.mockResolvedValue(FAKE_BUF);
  mockFetch.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from(MOCK_IMAGE_BASE64, 'base64').buffer,
  });
  mockGenerateContent.mockResolvedValue(MOCK_GEMINI_RESPONSE);
});

describe('POST /api/ai/cleanup-image-region', () => {
  it('정상 요청 시 imageBase64와 mimeType 반환', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(typeof json.imageBase64).toBe('string');
    expect(json.mimeType).toBe('image/jpeg');
  });

  it('Supabase URL 아닌 외부 URL → 403', async () => {
    const res = await POST(makeRequest({ imageUrl: 'https://evil.com/img.jpg', region: VALID_REGION }));
    expect(res.status).toBe(403);
  });

  it('region.width < 0.01 → 400', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: { ...VALID_REGION, width: 0.005 } }));
    expect(res.status).toBe(400);
  });

  it('region 없으면 400', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    expect(res.status).toBe(400);
  });

  it('이미지 fetch 실패 → 422', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    expect(res.status).toBe(422);
  });

  it('Gemini 응답에 imageData 없으면 500', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'no image here' }] } }],
    });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    expect(res.status).toBe(500);
  });

  it('Gemini AbortError → 500 + 타임아웃 메시지', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockGenerateContent.mockRejectedValue(abortErr);
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toMatch(/시간/);
  });

  it('region 경계 clamp 케이스 (x=0, y=0) — 정상 처리', async () => {
    const res = await POST(makeRequest({
      imageUrl: SUPABASE_URL,
      region: { x: 0, y: 0, width: 0.2, height: 0.2 },
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/cleanup-image-region.test.ts
```

예상 결과: `Cannot find module '@/app/api/ai/cleanup-image-region/route'` 오류로 실패.

- [ ] **Step 3: API 라우트 구현**

```typescript
// src/app/api/ai/cleanup-image-region/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import type { Part } from '@google/genai';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export const maxDuration = 90;

const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const MAX_DIM = 2000;
const CLEANUP_PROMPT =
  'Remove all Chinese text, watermarks, and price tags in the CENTRAL area of this image crop. ' +
  'DO NOT modify the outer border region — keep its colors and textures identical to the input. ' +
  'Fill removed areas by blending with the surrounding background.';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'cleanup-image-region'), {
    windowMs: 60_000,
    maxRequests: 4,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { imageUrl, region } = (body ?? {}) as Record<string, unknown>;

  if (typeof imageUrl !== 'string' || !SUPABASE_PATTERN.test(imageUrl)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }

  if (!region || typeof region !== 'object') {
    return NextResponse.json({ error: 'region이 필요합니다.' }, { status: 400 });
  }

  const { x, y, width, height } = region as Record<string, unknown>;
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number' ||
    x < 0 || y < 0 || x > 1 || y > 1 ||
    width < 0.01 || height < 0.01 ||
    x + width > 1 || y + height > 1
  ) {
    return NextResponse.json({ error: 'region 값이 유효하지 않습니다.' }, { status: 400 });
  }

  try {
    // 1. 이미지 fetch
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();

    // 2. EXIF 회전 + 선택적 다운스케일
    let img = sharp(Buffer.from(arrayBuffer)).rotate();
    const meta = await img.metadata();
    let W = meta.width ?? 0;
    let H = meta.height ?? 0;

    if (Math.max(W, H) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(W, H);
      W = Math.round(W * scale);
      H = Math.round(H * scale);
      img = img.resize(W, H);
    }

    const origBuffer = await img.clone().png().toBuffer();

    // 3. 정규화 좌표 → 픽셀 + 패딩 계산
    const px = { x: x * W, y: y * H, w: width * W, h: height * H };
    const pad = Math.max(40, Math.round(Math.min(px.w, px.h) * 0.35));
    const cx = Math.max(0, Math.floor(px.x - pad));
    const cy = Math.max(0, Math.floor(px.y - pad));
    const cw = Math.min(W - cx, Math.ceil(px.w + pad * 2));
    const ch = Math.min(H - cy, Math.ceil(px.h + pad * 2));

    // 4. 크롭 + Gemini 호출
    const cropBuffer = await sharp(origBuffer)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .png()
      .toBuffer();
    const cropBase64 = cropBuffer.toString('base64');

    const ai = getGeminiGenAI();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 70_000);

    let geminiBuffer: Buffer;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        config: { responseModalities: ['Image', 'Text'] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: cropBase64, mimeType: 'image/png' } } as Part,
            { text: CLEANUP_PROMPT } as Part,
          ],
        }],
      });
      const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(p => p.inlineData != null);
      if (!imagePart?.inlineData?.data) {
        return NextResponse.json(
          { error: '결과가 없습니다. 다시 실행해주세요.' },
          { status: 500 },
        );
      }
      geminiBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return NextResponse.json(
          { error: '시간이 초과됐습니다. 다시 실행해주세요.' },
          { status: 500 },
        );
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    // 5. Gemini 출력을 크롭 크기로 resize
    const resizedGemini = await sharp(geminiBuffer).resize(cw, ch).png().toBuffer();

    // 6. 톤매칭 (채널별 평균 차이 보정)
    const origStats = await sharp(origBuffer)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .stats();
    const geminiStats = await sharp(resizedGemini).stats();
    const offsets = origStats.channels.map(
      (c, i) => c.mean - (geminiStats.channels[i]?.mean ?? c.mean),
    );
    const tonedGemini = await sharp(resizedGemini)
      .linear([1, 1, 1], offsets.slice(0, 3))
      .png()
      .toBuffer();

    // 7. 알파 페더링 합성
    const innerX = Math.round(pad / 2);
    const innerY = Math.round(pad / 2);
    const innerW = Math.max(1, cw - pad);
    const innerH = Math.max(1, ch - pad);

    const maskSvg = Buffer.from(
      `<svg width="${cw}" height="${ch}">` +
      `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="white"/>` +
      `</svg>`,
    );
    const mask = await sharp({
      create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: maskSvg, blend: 'over' }])
      .blur(12)
      .toBuffer();

    const maskedPatch = await sharp(tonedGemini)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const result = await sharp(origBuffer)
      .composite([{ input: maskedPatch, left: cx, top: cy }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return NextResponse.json({
      imageBase64: result.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.error('[cleanup-image-region]', err);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/cleanup-image-region.test.ts
```

예상 결과: 8개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/cleanup-image-region/route.ts \
        src/__tests__/api/cleanup-image-region.test.ts
git commit -m "feat(api): add cleanup-image-region endpoint with Sharp feathering pipeline"
```

---

## Task 2: `ImageCleanupModal` 컴포넌트 + 테스트

**Files:**
- Create: `src/components/common/ImageCleanupModal.tsx`
- Create: `src/__tests__/components/ImageCleanupModal.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/components/ImageCleanupModal.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageCleanupModal from '@/components/common/ImageCleanupModal';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SUPABASE_URL = 'https://abcdef.supabase.co/storage/v1/test.jpg';
const FAKE_BASE64 = 'abc123==';

function makeGeminiOk() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ imageBase64: FAKE_BASE64, mimeType: 'image/jpeg' }),
  });
}
function makeUploadOk(url = 'https://abcdef.supabase.co/storage/v1/result.jpg') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, url }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageCleanupModal', () => {
  it('select 단계: 이미지와 "제거 실행" 버튼 렌더링', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제거 실행' })).toBeDisabled();
  });

  it('충분한 드래그 후 "제거 실행" 버튼 활성화', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    // getBoundingClientRect을 200x200 박스로 스텁
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });

    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);

    expect(screen.getByRole('button', { name: '제거 실행' })).toBeEnabled();
  });

  it('너무 작은 드래그(< 2%) — 버튼 비활성', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });

    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 22, clientY: 22 }); // 1% 이동
    fireEvent.mouseUp(img);

    expect(screen.getByRole('button', { name: '제거 실행' })).toBeDisabled();
  });

  it('[제거 실행] → processing → preview 단계 전환', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);

    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => expect(screen.getByText('정리됨')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '교체' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로 추가' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeInTheDocument();
  });

  it('[교체] → upload-ai 호출 후 onReplace(url) 호출', async () => {
    makeGeminiOk();
    const onReplace = vi.fn();
    const RESULT_URL = 'https://abcdef.supabase.co/storage/v1/result.jpg';
    makeUploadOk(RESULT_URL);

    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={onReplace}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );

    // 드래그 선택 → 실행 → preview 진입
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '교체' }));

    fireEvent.click(screen.getByRole('button', { name: '교체' }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(RESULT_URL));
  });

  it('[새로 추가] — canAdd=false이면 비활성화', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={false}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '새로 추가' }));

    expect(screen.getByRole('button', { name: '새로 추가' })).toBeDisabled();
  });

  it('[다시 실행] → select 단계로 리셋', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '다시 실행' }));

    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
    expect(screen.queryByText('정리됨')).not.toBeInTheDocument();
  });

  it('API 오류 → 에러 메시지 표시 + select 단계 유지', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: '처리 중 오류가 발생했습니다.' }),
    });
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));

    await waitFor(() =>
      expect(screen.getByText('처리 중 오류가 발생했습니다.')).toBeInTheDocument(),
    );
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/components/ImageCleanupModal.test.tsx
```

예상 결과: `Cannot find module '@/components/common/ImageCleanupModal'` 오류로 실패.

- [ ] **Step 3: 컴포넌트 구현**

```typescript
// src/components/common/ImageCleanupModal.tsx
'use client';

import React, { useRef, useState } from 'react';

interface ImageCleanupModalProps {
  imageUrl: string;
  onReplace: (newUrl: string) => void;
  onAdd: (newUrl: string) => void;
  onClose: () => void;
  canAdd: boolean;
}

type Phase = 'select' | 'processing' | 'preview';

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function ImageCleanupModal({
  imageUrl,
  onReplace,
  onAdd,
  onClose,
  canAdd,
}: ImageCleanupModalProps) {
  const [phase, setPhase] = useState<Phase>('select');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [resultBase64, setResultBase64] = useState<string | null>(null);
  const [resultMime, setResultMime] = useState('image/jpeg');
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  function getNorm(e: React.MouseEvent) {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const { x, y } = getNorm(e);
    setDragStart({ x, y });
    setSelection(null);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragStart) return;
    const { x, y } = getNorm(e);
    setSelection({
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      width: Math.abs(x - dragStart.x),
      height: Math.abs(y - dragStart.y),
    });
  }

  function handleMouseUp() {
    setDragStart(null);
  }

  const isSelectionValid =
    selection !== null && selection.width >= 0.02 && selection.height >= 0.02;

  async function handleExecute() {
    if (!selection) return;
    setPhase('processing');
    setError(null);
    try {
      const res = await fetch('/api/ai/cleanup-image-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, region: selection }),
      });
      const data = await res.json() as { imageBase64?: string; mimeType?: string; error?: string };
      if (!res.ok || data.error || !data.imageBase64) {
        setError(data.error ?? '처리 중 오류가 발생했습니다.');
        setPhase('select');
        return;
      }
      setResultBase64(data.imageBase64);
      setResultMime(data.mimeType ?? 'image/jpeg');
      setPhase('preview');
    } catch {
      setError('처리 중 오류가 발생했습니다.');
      setPhase('select');
    }
  }

  async function uploadResult(): Promise<string> {
    const res = await fetch('/api/image/upload-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: resultBase64, mimeType: resultMime, role: 'cleanup' }),
    });
    const data = await res.json() as { success: boolean; url?: string };
    if (!data.success || !data.url) throw new Error('업로드 실패');
    return data.url;
  }

  async function handleReplace() {
    setIsUploading(true);
    try {
      const url = await uploadResult();
      onReplace(url);
    } catch {
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setIsUploading(false);
    }
  }

  async function handleAdd() {
    if (!canAdd) return;
    setIsUploading(true);
    try {
      const url = await uploadResult();
      onAdd(url);
    } catch {
      setError('업로드에 실패했습니다. 다시 시도해주세요.');
      setIsUploading(false);
    }
  }

  function handleRetry() {
    setPhase('select');
    setResultBase64(null);
    setError(null);
  }

  const selRect = selection
    ? {
        x: `${selection.x * 100}%`,
        y: `${selection.y * 100}%`,
        width: `${selection.width * 100}%`,
        height: `${selection.height * 100}%`,
      }
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: '12px',
          padding: '20px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>한자 제거</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>

        {phase === 'select' && (
          <>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px' }}>
              한자 영역을 드래그해서 선택하세요. 주변 한자까지 자동으로 커버됩니다.
            </div>
            <div style={{ position: 'relative', userSelect: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl}
                alt="원본 이미지"
                draggable={false}
                style={{ width: '100%', display: 'block', borderRadius: '6px', cursor: 'crosshair' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              />
              {selRect && (
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                >
                  <rect
                    x={selRect.x}
                    y={selRect.y}
                    width={selRect.width}
                    height={selRect.height}
                    fill="rgba(99,102,241,0.15)"
                    stroke="#6366f1"
                    strokeWidth="1.5"
                    strokeDasharray="5,3"
                  />
                </svg>
              )}
            </div>
            {selection && !isSelectionValid && (
              <div style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>
                한자 영역을 더 크게 선택해주세요.
              </div>
            )}
            {error && (
              <div style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>{error}</div>
            )}
            <button
              onClick={handleExecute}
              disabled={!isSelectionValid}
              style={{
                marginTop: '12px',
                width: '100%',
                padding: '10px',
                background: isSelectionValid ? '#6366f1' : '#374151',
                color: isSelectionValid ? '#fff' : '#6b7280',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: isSelectionValid ? 'pointer' : 'not-allowed',
              }}
            >
              제거 실행
            </button>
          </>
        )}

        {phase === 'processing' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
            한자 제거 중…
          </div>
        )}

        {phase === 'preview' && resultBase64 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>원본</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="원본" style={{ width: '100%', borderRadius: '6px' }} />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>정리됨</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${resultMime};base64,${resultBase64}`}
                  alt="정리됨"
                  style={{ width: '100%', borderRadius: '6px' }}
                />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '10px' }}>
              결과가 어색하면 박스를 한자에 더 밀착시켜 다시 실행해보세요.
            </div>
            {error && (
              <div style={{ color: '#f87171', fontSize: '11px', marginBottom: '8px' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleReplace}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  opacity: isUploading ? 0.7 : 1,
                }}
              >
                교체
              </button>
              <button
                onClick={handleAdd}
                disabled={isUploading || !canAdd}
                title={!canAdd ? '이미지는 최대 10장입니다' : undefined}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: canAdd ? '#059669' : '#374151',
                  color: canAdd ? '#fff' : '#6b7280',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isUploading || !canAdd ? 'not-allowed' : 'pointer',
                }}
              >
                새로 추가
              </button>
              <button
                onClick={handleRetry}
                disabled={isUploading}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#1e293b',
                  color: '#9ca3af',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '13px',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                }}
              >
                다시 실행
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/ImageCleanupModal.test.tsx
```

예상 결과: 8개 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/common/ImageCleanupModal.tsx \
        src/__tests__/components/ImageCleanupModal.test.tsx
git commit -m "feat(ui): add ImageCleanupModal with drag-select and preview flow"
```

---

## Task 3: `DetailMakerClient.tsx` 콜백 추가

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: handleReplaceImage / handleAddImage 함수 추가**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 에서 `handleUploadFiles` 함수 직후 (약 95번째 줄)에 두 함수를 추가한다:

```typescript
  function handleReplaceImage(idx: number, newUrl: string) {
    setUploadedUrls(prev => prev.map((u, i) => (i === idx ? newUrl : u)));
  }

  function handleAddImage(newUrl: string) {
    setUploadedUrls(prev => (prev.length < 10 ? [...prev, newUrl] : prev));
  }
```

- [ ] **Step 2: `DetailMakerInputPanel`에 새 props 전달**

같은 파일에서 `<DetailMakerInputPanel ...>` 렌더링 부분을 찾아 두 prop을 추가한다:

```typescript
onReplaceImage={handleReplaceImage}
onAddImage={handleAddImage}
```

- [ ] **Step 3: `selectedMoodId` 확인 후 빌드 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep -E "cleanup|replace|add" || echo "관련 오류 없음"
```

`DetailMakerInputPanel.tsx` 에 아직 새 prop이 없으므로 타입 오류가 날 수 있다. Task 4 완료 후 재검증한다. 지금은 오류를 메모하고 넘어간다.

- [ ] **Step 4: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-maker): add handleReplaceImage and handleAddImage callbacks"
```

---

## Task 4: `DetailMakerInputPanel.tsx` 통합

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`

- [ ] **Step 1: Props 인터페이스에 새 prop 추가**

`src/components/listing/detail-maker/DetailMakerInputPanel.tsx` 의 `interface Props` 블록에 두 필드를 추가한다. 현재 `onRemoveImage: (idx: number) => void;` 바로 다음에 삽입:

```typescript
  onReplaceImage: (idx: number, newUrl: string) => void;
  onAddImage: (newUrl: string) => void;
```

- [ ] **Step 2: 구조 분해에 추가**

`export default function DetailMakerInputPanel({` 의 구조 분해 목록에 추가 (현재 `onRemoveImage,` 바로 다음):

```typescript
  onReplaceImage,
  onAddImage,
```

- [ ] **Step 3: import 추가 및 로컬 state 선언**

파일 상단 import 영역에 `ImageCleanupModal` import 추가:

```typescript
import ImageCleanupModal from '@/components/common/ImageCleanupModal';
```

`export default function DetailMakerInputPanel(...)` 내부 기존 state 선언 바로 다음에:

```typescript
  const [cleanupTargetIdx, setCleanupTargetIdx] = useState<number | null>(null);
```

- [ ] **Step 4: 이미지 그리드에 "한자 제거" 버튼 + 모달 마운트**

`uploadedUrls.map((url, idx) => ...)` 내부, 현재 삭제 버튼(`×`) 바로 다음에 한자 제거 버튼을 삽입한다:

```tsx
                      <button
                        onClick={() => setCleanupTargetIdx(idx)}
                        aria-label="한자 제거"
                        style={{
                          position: 'absolute',
                          bottom: '2px',
                          left: '2px',
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '10px',
                          padding: '2px 4px',
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                      >
                        한자
                      </button>
                      {cleanupTargetIdx === idx && (
                        <ImageCleanupModal
                          imageUrl={url}
                          onReplace={newUrl => {
                            onReplaceImage(idx, newUrl);
                            setCleanupTargetIdx(null);
                          }}
                          onAdd={newUrl => {
                            onAddImage(newUrl);
                            setCleanupTargetIdx(null);
                          }}
                          onClose={() => setCleanupTargetIdx(null)}
                          canAdd={uploadedUrls.length < 10}
                        />
                      )}
```

- [ ] **Step 5: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | head -20
```

예상 결과: 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx
git commit -m "feat(detail-maker): add cleanup button to product image grid"
```

---

## Task 5: `DetailMakerThumbnailPanel.tsx` 통합

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx`

- [ ] **Step 1: 현재 `extraRefUrls` 렌더 위치 파악**

`src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` 에서 `extraRefUrls` 이미지 그리드를 찾는다. `onRemoveExtraRef` 콜백이 있는 삭제 버튼 패턴을 찾는다.

- [ ] **Step 2: Props 인터페이스에 새 prop 추가**

기존 `interface Props` 의 `onRemoveExtraRef?: (idx: number) => void;` 바로 다음에:

```typescript
  onReplaceExtraRef?: (idx: number, newUrl: string) => void;
  onAddExtraRef?: (newUrl: string) => void;
```

- [ ] **Step 3: 구조 분해에 추가**

```typescript
  onReplaceExtraRef,
  onAddExtraRef,
```

- [ ] **Step 4: import + state 선언**

파일 상단에:

```typescript
import ImageCleanupModal from '@/components/common/ImageCleanupModal';
```

컴포넌트 내부 기존 state 다음에:

```typescript
  const [cleanupExtraIdx, setCleanupExtraIdx] = useState<number | null>(null);
```

- [ ] **Step 5: extraRefUrls 그리드에 한자 제거 버튼 + 모달**

`extraRefUrls.map((url, idx) => ...)` 내부, 삭제 버튼 다음에:

```tsx
                    <button
                      onClick={() => setCleanupExtraIdx(idx)}
                      aria-label="한자 제거"
                      style={{
                        position: 'absolute',
                        bottom: '2px',
                        left: '2px',
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '10px',
                        padding: '2px 4px',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                    >
                      한자
                    </button>
                    {cleanupExtraIdx === idx && (
                      <ImageCleanupModal
                        imageUrl={url}
                        onReplace={newUrl => {
                          onReplaceExtraRef?.(idx, newUrl);
                          setCleanupExtraIdx(null);
                        }}
                        onAdd={newUrl => {
                          onAddExtraRef?.(newUrl);
                          setCleanupExtraIdx(null);
                        }}
                        onClose={() => setCleanupExtraIdx(null)}
                        canAdd={true}
                      />
                    )}
```

- [ ] **Step 6: `DetailMakerInputPanel.tsx`에서 `DetailMakerThumbnailPanel` props 전달 확인**

`DetailMakerInputPanel.tsx` 내부의 `<DetailMakerThumbnailPanel ...>` 렌더링을 찾아 새 콜백 prop이 필요한지 확인한다.

`DetailMakerThumbnailPanel`은 `DetailMakerInputPanel` 안에 렌더된다. `DetailMakerInputPanel`의 `Props`에도 `onReplaceExtraRef`, `onAddExtraRef`를 추가하고 pass-through해야 한다:

`DetailMakerInputPanel.tsx` 의 `interface Props`에:
```typescript
  onReplaceExtraRef?: (idx: number, newUrl: string) => void;
  onAddExtraRef?: (newUrl: string) => void;
```

구조 분해에 추가하고 `<DetailMakerThumbnailPanel>`에 전달:
```tsx
onReplaceExtraRef={onReplaceExtraRef}
onAddExtraRef={onAddExtraRef}
```

`DetailMakerClient.tsx`에도 해당 콜백 정의 후 전달 (thumbnailExtraUrls는 별도 상태):
```typescript
  function handleReplaceThumbnailRef(idx: number, newUrl: string) {
    setThumbnailExtraUrls(prev => prev.map((u, i) => (i === idx ? newUrl : u)));
  }
  function handleAddThumbnailRef(newUrl: string) {
    setThumbnailExtraUrls(prev => [...prev, newUrl]);
  }
```

- [ ] **Step 7: 타입 검사**

```bash
npx tsc --noEmit 2>&1 | head -20
```

예상 결과: 오류 없음.

- [ ] **Step 8: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx \
        src/components/listing/detail-maker/DetailMakerInputPanel.tsx \
        src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-maker): add cleanup button to thumbnail ref image grid"
```

---

## 셀프 리뷰

**스펙 커버리지 체크:**

| 스펙 요구사항 | 구현 태스크 |
|---|---|
| SSRF 검증 (Supabase URL만) | Task 1 Step 3 (SUPABASE_PATTERN regex) |
| region 0~1 범위 검증 + width/height > 0.01 | Task 1 Step 3 (유효성 검사) + Test |
| EXIF 자동 회전 | Task 1 Step 3 (`.rotate()`) |
| 최장 변 > 2000px 다운스케일 | Task 1 Step 3 (MAX_DIM = 2000) |
| 패딩 = max(40, 35% × 단변) + clamp | Task 1 Step 3 |
| Gemini 70초 AbortSignal | Task 1 Step 3 (controller, 70_000ms) + Test |
| Gemini 빈 결과 → 500 | Task 1 Test |
| 톤매칭 linear 보정 | Task 1 Step 3 |
| 알파 페더링 (SVG mask + blur 12 + dest-in) | Task 1 Step 3 |
| base64 반환 (URL 아님) | Task 1 Step 3 + Test |
| rate limit 분당 4회 | Task 1 Step 3 |
| maxDuration: 90 | Task 1 Step 3 |
| 드래그 → 정규화 좌표 | Task 2 Step 3 (getNorm) + Test |
| 최소 선택 2% 미달 → 버튼 비활성 | Task 2 Step 3 + Test |
| select → processing → preview 단계 | Task 2 Step 3 + Test |
| [교체] → upload-ai → onReplace | Task 2 Step 3 + Test |
| [새로 추가] canAdd=false 비활성 | Task 2 Step 3 + Test |
| [다시 실행] → select 리셋 | Task 2 Step 3 + Test |
| handleReplaceImage (uploadedUrls 교체) | Task 3 |
| handleAddImage (10장 상한) | Task 3 |
| DetailMakerInputPanel 이미지 그리드 버튼 | Task 4 |
| DetailMakerThumbnailPanel 참조 이미지 버튼 | Task 5 |

**플레이스홀더 스캔:** 없음 — 모든 스텝에 실제 코드 포함.

**타입 일관성:** `Selection` 인터페이스 (x,y,width,height) → API request body의 `region` → 서버 destructure 순서 일치. `onReplaceImage(idx, newUrl)` 시그니처가 Task 3, 4, 5에서 동일.
