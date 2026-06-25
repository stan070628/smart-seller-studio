# Detail Maker 이미지 클린업 모드 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 카드별 "AI 생성 / 클린업" 모드 토글 구현 — 클린업 모드에서 Gemini가 소스 이미지의 한자/워터마크를 제거하고 원본 제품을 보존

**Architecture:** cleanup-product-image API (Gemini 2.5 Flash) → StoryboardEditor 뱃지 토글 → generateSceneImages 분기

**Tech Stack:** Next.js App Router, Gemini 2.5 Flash image, @google/genai, Vitest

**선행 조건:** Spec A (스토리라인 편집) 플랜 완료 후 진행 — `SceneStoryboardItem` 타입과 `StoryboardEditor.tsx`가 이미 존재해야 함

---

## 파일 구조

| 파일 | 종류 | 역할 |
|---|---|---|
| `src/app/api/ai/cleanup-product-image/route.ts` | 신규 | Gemini로 한자/워터마크 제거 API |
| `src/__tests__/api/cleanup-product-image.test.ts` | 신규 | API 단위 테스트 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 수정 | 뱃지 토글 추가 (SceneCard 헤더) |
| `src/__tests__/components/storyboard-editor.test.tsx` | 수정 | 뱃지 관련 테스트 추가 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 | generateSceneImages cleanup 분기 |

---

## Task 1: cleanup-product-image API 라우트

**Files:**
- Create: `src/app/api/ai/cleanup-product-image/route.ts`
- Create: `src/__tests__/api/cleanup-product-image.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/api/cleanup-product-image.test.ts
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
  getGeminiGenAI: () => ({ models: { generateContent: mockGenerateContent } }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '@/app/api/ai/cleanup-product-image/route';

const VALID_URL = 'https://abcdefgh.supabase.co/storage/v1/object/public/images/test.jpg';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/cleanup-product-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const MOCK_IMAGE_BUFFER = Buffer.from('fake-image-data');
const MOCK_GEMINI_RESULT = {
  candidates: [{
    content: {
      parts: [{ inlineData: { data: 'A'.repeat(200), mimeType: 'image/png' } }],
    },
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => MOCK_IMAGE_BUFFER.buffer,
  });
  mockGenerateContent.mockResolvedValue(MOCK_GEMINI_RESULT);
});

describe('POST /api/ai/cleanup-product-image', () => {
  it('정상 Supabase URL + Gemini 성공 → imageBase64 반환', async () => {
    const res = await POST(makeRequest({ imageUrl: VALID_URL }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imageBase64).toHaveLength(200);
    expect(json.mimeType).toBe('image/png');
  });

  it('외부 URL → 403 SSRF 방어', async () => {
    const res = await POST(makeRequest({ imageUrl: 'https://evil.com/hack.jpg' }));
    expect(res.status).toBe(403);
  });

  it('이미지 fetch 실패 → 422', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const res = await POST(makeRequest({ imageUrl: VALID_URL }));
    expect(res.status).toBe(422);
  });

  it('Gemini 빈 결과 → 500', async () => {
    mockGenerateContent.mockResolvedValue({ candidates: [{ content: { parts: [] } }] });
    const res = await POST(makeRequest({ imageUrl: VALID_URL }));
    expect(res.status).toBe(500);
  });

  it('imageUrl 없으면 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/cleanup-product-image.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/ai/cleanup-product-image/route'"

- [ ] **Step 3: API 라우트 구현**

```typescript
// src/app/api/ai/cleanup-product-image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export const maxDuration = 60;
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

// Supabase Storage URL만 허용 (SSRF 방어)
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\//;

const RequestBodySchema = z.object({
  imageUrl: z.string().url().max(2000),
});

const CLEANUP_PROMPT = `Remove all Chinese characters, Chinese text, watermarks, brand logos, price tags, promotional text, and any text overlays from this product image.

CRITICAL CONSTRAINTS:
- Do NOT alter the product itself in any way — preserve the exact shape, color, texture, material, and all visual details of the product
- Fill removed text/watermark areas by blending naturally with the surrounding background
- Output a single clean product photograph with all text and overlays removed`;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'cleanup-product-image'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  const { imageUrl } = parsed.data;

  if (!SUPABASE_URL_PATTERN.test(imageUrl)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }

  let imageBase64: string;
  let mimeType: string;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`이미지 fetch 실패: ${imgRes.status}`);
    const ct = imgRes.headers.get('content-type') ?? 'image/jpeg';
    mimeType = ct.split(';')[0].trim();
    const buffer = await imgRes.arrayBuffer();
    imageBase64 = Buffer.from(buffer).toString('base64');
  } catch (e) {
    return NextResponse.json(
      { error: `이미지를 불러오지 못했습니다: ${e instanceof Error ? e.message : ''}` },
      { status: 422 },
    );
  }

  try {
    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['IMAGE', 'TEXT'] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: imageBase64, mimeType } },
          { text: CLEANUP_PROMPT },
        ],
      }],
    });

    let resultBase64 = '';
    let resultMime = 'image/png';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      const p = part as { inlineData?: { data: string; mimeType: string } };
      if (p.inlineData?.data) {
        resultBase64 = p.inlineData.data;
        resultMime = p.inlineData.mimeType ?? 'image/png';
        break;
      }
    }

    if (!resultBase64 || resultBase64.length < 100) {
      return NextResponse.json(
        { error: '클린업 결과가 비어 있습니다. 다시 시도해주세요.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ imageBase64: resultBase64, mimeType: resultMime });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류';
    return NextResponse.json(
      { error: `한자 제거 중 오류가 발생했습니다: ${msg}` },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/cleanup-product-image.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/cleanup-product-image/route.ts \
        src/__tests__/api/cleanup-product-image.test.ts
git commit -m "feat(cleanup): add cleanup-product-image API route (Gemini 한자 제거)"
```

---

## Task 2: StoryboardEditor 뱃지 토글 추가

**Files:**
- Modify: `src/components/listing/detail-maker/StoryboardEditor.tsx`
- Modify: `src/__tests__/components/storyboard-editor.test.tsx`

> **참고:** `StoryboardEditor.tsx`는 Spec A 플랜(Task 3)에서 생성됨. 이 태스크에서는 `SceneCard` 컴포넌트의 헤더 영역에 뱃지 버튼을 추가하고, `cleanup` 모드일 때 prompt textarea를 숨긴다.

- [ ] **Step 1: 실패할 테스트 추가**

`src/__tests__/components/storyboard-editor.test.tsx` 파일의 기존 describe 블록 안에 다음 3개 테스트를 추가한다:

```typescript
it('뱃지 클릭 시 mode가 ai → cleanup으로 토글', () => {
  const onScenesChange = vi.fn();
  render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
  fireEvent.click(screen.getByRole('button', { name: /⚡ AI/ }));
  expect(onScenesChange).toHaveBeenCalledWith([
    expect.objectContaining({ mode: 'cleanup' }),
  ]);
});

it('uploadedUrls가 없으면 뱃지가 disabled', () => {
  render(<StoryboardEditor {...baseProps} uploadedUrls={[]} />);
  expect(screen.getByRole('button', { name: /⚡ AI/ })).toBeDisabled();
});

it('cleanup 모드에서는 prompt textarea가 없다', () => {
  const cleanupScene = { ...baseProps.scenes[0], mode: 'cleanup' as const };
  render(<StoryboardEditor {...baseProps} scenes={[cleanupScene]} />);
  // textarea (prompt)가 존재하지 않아야 함
  const textareas = document.querySelectorAll('textarea');
  expect(textareas).toHaveLength(0);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/storyboard-editor.test.tsx
```

Expected: 3 new tests FAIL (뱃지 버튼 없음)

- [ ] **Step 3: SceneCard 헤더에 뱃지 버튼 추가**

`src/components/listing/detail-maker/StoryboardEditor.tsx`의 `SceneCard` 컴포넌트 내 헤더 `<div>` 안에서 삭제 버튼(`🗑`) 바로 앞에 다음 코드를 삽입한다:

```tsx
{/* 모드 뱃지 */}
<button
  onClick={() => onUpdate({ ...scene, mode: scene.mode === 'ai' ? 'cleanup' : 'ai' })}
  disabled={uploadedUrls.length === 0}
  title={
    scene.mode === 'ai'
      ? 'AI 씬 생성 모드'
      : '이미지 클린업 모드 — 소스 이미지에서 한자 제거'
  }
  style={{
    padding: '2px 8px',
    borderRadius: '12px',
    border: 'none',
    background: scene.mode === 'ai' ? '#6366f1' : '#059669',
    color: '#fff',
    fontSize: '11px',
    cursor: uploadedUrls.length === 0 ? 'not-allowed' : 'pointer',
    opacity: uploadedUrls.length === 0 ? 0.5 : 1,
    whiteSpace: 'nowrap',
  }}
>
  {scene.mode === 'ai' ? '⚡ AI' : '✨ 클린업'}
</button>
```

그리고 prompt textarea를 감싸는 조건부 렌더링을 `scene.mode === 'ai'`인 경우에만 표시하도록 이미 되어 있는지 확인한다 (Spec A에서 이미 `{scene.mode === 'ai' && (...)}` 패턴으로 작성됨). 없으면 textarea 블록 전체를 `{scene.mode === 'ai' && (...)}` 로 감싼다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/storyboard-editor.test.tsx
```

Expected: 모든 테스트 pass (기존 6개 + 신규 3개 = 9개)

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-maker/StoryboardEditor.tsx \
        src/__tests__/components/storyboard-editor.test.tsx
git commit -m "feat(cleanup): add mode badge toggle to StoryboardEditor SceneCard"
```

---

## Task 3: DetailMakerClient generateSceneImages 클린업 분기

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

> **참고:** `generateSceneImages`는 Spec A 플랜(Task 4)에서 `storyboard` 파라미터를 받도록 이미 수정됨. 이 태스크에서는 `storyboard[idx].mode === 'cleanup'`일 때 cleanup API를 호출하는 분기만 추가한다.

- [ ] **Step 1: generateSceneImages 내부 분기 추가**

`src/app/listing/detail-maker/DetailMakerClient.tsx`의 `generateSceneImages` 함수 안, `targets.map(async (section, idx) => {` 바로 뒤, 기존 AI 생성 로직 시작 전에 다음 cleanup 분기를 삽입한다:

```typescript
// cleanup 모드 분기 — storyboard[idx].mode === 'cleanup' 이면 한자 제거 API 호출
if (storyboard && storyboard[idx] && storyboard[idx].mode === 'cleanup') {
  const scene = storyboard[idx];
  const srcIdx = Math.min(scene.sourceImageIndex, refUrls.length - 1);
  const sourceUrl = refUrls[srcIdx];

  const cleanupRes = await fetch('/api/ai/cleanup-product-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: sourceUrl }),
  });
  if (!cleanupRes.ok) return null;

  const cleanupData = await cleanupRes.json() as {
    imageBase64?: string;
    mimeType?: string;
    error?: string;
  };
  if (!cleanupData.imageBase64) return null;

  const uploadRes = await fetch('/api/image/upload-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: cleanupData.imageBase64,
      mimeType: cleanupData.mimeType ?? 'image/png',
      role: 'cleanup',
    }),
  });
  if (!uploadRes.ok) return null;

  const uploadData = await uploadRes.json() as { success: boolean; url?: string };
  if (!uploadData.success || !uploadData.url) return null;
  return { sectionId: section.id, url: uploadData.url };
}
// 이하 기존 AI 생성 로직 (sectionType, headline, sectionRefUrls 계산 등)
```

- [ ] **Step 2: 브라우저에서 수동 검증**

로컬 서버를 실행하고 Detail Maker에서:
1. 이미지를 업로드한다
2. "스토리라인 구성" 클릭
3. 씬 카드의 "⚡ AI" 뱃지를 클릭해 "✨ 클린업"으로 전환
4. "② 씬 이미지 생성" 클릭
5. 서버 콘솔에서 `/api/ai/cleanup-product-image` 호출이 발생했는지 확인
6. 해당 씬 슬롯에 이미지가 로드되는지 확인

```bash
npm run dev
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(cleanup): add cleanup mode branch in generateSceneImages"
```

---

## 완료 확인

- [ ] 전체 테스트 실행

```bash
npx vitest run src/__tests__/api/cleanup-product-image.test.ts \
               src/__tests__/components/storyboard-editor.test.tsx
```

Expected: 모든 테스트 pass

- [ ] TypeScript 빌드 확인

```bash
npx tsc --noEmit
```

Expected: 에러 없음
