# assets 탭 "AI 썸네일 생성" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 전용이던 "AI 썸네일 생성" 기능을 "상품상세 자동만들기"(assets) 탭에서도 쓸 수 있게, generate-thumbnail API에 URL 입력을 추가하고 입력 패널에 생성 UI를 붙인다.

**Architecture:** `generate-thumbnail` API에 `refImageUrls` 입력을 추가하고 서버가 `loadReferenceImages`로 fetch+정규화(기존 base64 `refImages`는 하위호환). 신규 `ThumbnailGeneratePanel`(useListingStore 맥락)을 `AssetsInputPanel` 하단에 렌더하고, 생성 결과를 `upload-ai`로 영속화해 `generatedThumbnails`에 추가하면 기존 결과 패널이 자동 표시한다.

**Tech Stack:** Next.js App Router, TypeScript, Zod, `@google/genai` (Gemini 2.5 Flash Image), `loadReferenceImages`(Sharp), Zustand, Vitest

**참고 설계 문서:** `docs/superpowers/specs/2026-06-12-assets-thumbnail-generate-design.md`

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/app/api/ai/generate-thumbnail/route.ts` | 수정 — `refImageUrls` 입력 + `loadReferenceImages` 정규화, 합산 최소 1장 검증 |
| `src/components/listing/assets/ThumbnailGeneratePanel.tsx` | 신규 — 연출 방향 입력 + 생성 버튼 + 참조 안내 (useListingStore) |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 — 하단에 `ThumbnailGeneratePanel` 렌더 |
| `src/__tests__/api/generate-thumbnail.test.ts` | 신규 — refImageUrls/refImages/검증 경로 |

---

## Task 1: generate-thumbnail API에 refImageUrls + loadReferenceImages

**Files:**
- Modify: `src/app/api/ai/generate-thumbnail/route.ts`
- Create test: `src/__tests__/api/generate-thumbnail.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/__tests__/api/generate-thumbnail.test.ts
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

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: mockGenerateContent } }),
}));

import { POST } from '@/app/api/ai/generate-thumbnail/route';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-thumbnail', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function partsOfLastCall(): Part[] {
  return mockGenerateContent.mock.calls[0][0].contents[0].parts as Part[];
}

const VALID_DIRECTION = '화이트 스튜디오 배경, 조명 강조';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadReferenceImages.mockResolvedValue([{ base64: 'X', mimeType: 'image/jpeg' }]);
  mockGenerateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/png' } }] } }],
  });
});

describe('POST /api/ai/generate-thumbnail', () => {
  it('refImageUrls 3장 → loadReferenceImages 호출 + Gemini parts에 inlineData 3개 + 200', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        refImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'],
        direction: VALID_DIRECTION,
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.imageBase64).toBe('GEN');

    expect(mockLoadReferenceImages).toHaveBeenCalledWith(
      expect.objectContaining({ productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'] }),
    );
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(3);
    expect(inline.map((p) => p.inlineData!.data)).toEqual(['A', 'B', 'C']);
  });

  it('하위호환: refImages(base64) → loadReferenceImages에 referenceImages로 매핑 + 200', async () => {
    const res = await POST(
      makeRequest({
        refImages: [{ imageBase64: 'AAA', mimeType: 'image/jpeg' }],
        direction: VALID_DIRECTION,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLoadReferenceImages).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [{ base64: 'AAA', mimeType: 'image/jpeg' }] }),
    );
  });

  it('refImages·refImageUrls 둘 다 없으면 400', async () => {
    const res = await POST(makeRequest({ direction: VALID_DIRECTION }));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('direction 5자 미만이면 400', async () => {
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: '짧음' }));
    expect(res.status).toBe(400);
  });

  it('loadReferenceImages 결과가 0장이면 400', async () => {
    mockLoadReferenceImages.mockResolvedValue([]);
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: VALID_DIRECTION }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/generate-thumbnail.test.ts`
Expected: FAIL — 현재 라우트는 `refImageUrls`를 모르고 `refImages.min(1)`을 강제하므로 첫 테스트부터 실패

- [ ] **Step 3: route 수정**

(a) import 추가 (20번 줄 `getGeminiGenAI` import 아래):

```typescript
import { loadReferenceImages } from '@/lib/ai/reference-images';
```

(b) `RequestSchema`(27-41번 줄)를 다음으로 교체:

```typescript
const RequestSchema = z.object({
  // 하위호환: 에디터(ThumbnailGenerateSection)의 base64 입력
  refImages: z
    .array(
      z.object({
        imageBase64: z.string().min(1),
        mimeType: MimeTypeEnum,
      }),
    )
    .max(3, '참조 사진은 최대 3장까지 가능합니다')
    .optional(),
  // 신규: assets 탭의 URL 입력 (서버가 fetch)
  refImageUrls: z.array(z.string().url()).max(3, '참조 사진은 최대 3장까지 가능합니다').optional(),
  direction: z
    .string()
    .min(5, '연출 방향을 입력해주세요 (5자 이상)')
    .max(300),
});
```

(c) `const { refImages, direction } = parsed.data;`(79번 줄)부터 parts 구성의 `for (const img of refImages) { parts.push(...) }` 루프(86-92번 줄)까지를 다음으로 교체:

```typescript
    const { refImages, refImageUrls, direction } = parsed.data;

    // 두 소스 모두 비어있으면 400
    if ((!refImages || refImages.length === 0) && (!refImageUrls || refImageUrls.length === 0)) {
      return NextResponse.json(
        { success: false, error: '참조 사진이 최소 1장 필요합니다' },
        { status: 400 },
      );
    }

    // 참조 이미지 정규화 (URL fetch + Sharp 리사이즈 + base64, 최대 3장)
    const referenceImages = await loadReferenceImages({
      referenceImages: refImages?.map((r) => ({ base64: r.imageBase64, mimeType: r.mimeType })),
      productImageUrls: refImageUrls,
    });

    if (referenceImages.length === 0) {
      return NextResponse.json(
        { success: false, error: '참조 사진을 불러오지 못했습니다' },
        { status: 400 },
      );
    }

    // Gemini parts 구성: 참조 이미지들 → 텍스트 프롬프트
    type GeminiPart =
      | { text: string }
      | { inlineData: { data: string; mimeType: string } };

    const parts: GeminiPart[] = [];

    for (const ref of referenceImages) {
      parts.push({
        inlineData: { data: ref.base64, mimeType: ref.mimeType },
      });
    }
```

> 주의: 기존 코드에 이미 있던 `type GeminiPart` 선언과 `const parts: GeminiPart[] = [];`는 위 교체 블록으로 흡수되므로, 교체 후 중복 선언이 남지 않도록 한다. 교체 범위는 `const { refImages, direction } = parsed.data;`부터 base64 push `for` 루프 끝(`}`)까지이며, 그 뒤의 `// 썸네일 생성 전용 프롬프트` 주석과 `const prompt = ...`, `parts.push({ text: prompt })`, Gemini 호출은 그대로 유지한다.

(d) 라우트 전체가 이미 하나의 `try {}` 블록(43-161번 줄)으로 감싸여 있으므로 `loadReferenceImages` 호출은 자연히 try 내부에 위치한다 — 추가 조치 불필요.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/generate-thumbnail.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: generate-thumbnail/route.ts에 새 타입 오류 없음 (사전 존재 무관 오류는 무시)

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-thumbnail/route.ts src/__tests__/api/generate-thumbnail.test.ts
git commit -m "feat: generate-thumbnail refImageUrls 입력 + loadReferenceImages 정규화"
```

---

## Task 2: ThumbnailGeneratePanel 신규 컴포넌트

**Files:**
- Create: `src/components/listing/assets/ThumbnailGeneratePanel.tsx`

> assets 탭 컴포넌트는 단위 테스트가 없는 패턴(AssetsInputPanel/AssetsTab 동일)이므로 `npx tsc --noEmit`로 검증한다.

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/listing/assets/ThumbnailGeneratePanel.tsx
'use client';

/**
 * ThumbnailGeneratePanel.tsx
 * assets 탭(상품상세 자동만들기)의 AI 썸네일 생성 패널.
 *
 * 흐름:
 *  1. 업로드/크롤링한 이미지(thumbnailFiles → detailFiles → generatedThumbnails)를 참조(최대 3장)로 사용
 *  2. 연출 방향 입력 + "AI 썸네일 생성" 클릭
 *  3. POST /api/ai/generate-thumbnail { refImageUrls, direction }
 *  4. 결과 base64 → POST /api/image/upload-ai → generatedThumbnails에 append
 */

import React, { useState } from 'react';
import { Wand2, Loader2, X } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

export default function ThumbnailGeneratePanel() {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const { mode, thumbnailFiles, detailFiles, generatedThumbnails } = assetsDraft;

  const [direction, setDirection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 참조 URL 수집 (최대 3장)
  const refImageUrls = (
    mode === 'url'
      ? generatedThumbnails
      : thumbnailFiles.length > 0
        ? thumbnailFiles
        : detailFiles
  )
    .filter(Boolean)
    .slice(0, 3);

  const hasRef = refImageUrls.length > 0;
  const canGenerate = hasRef && direction.trim().length >= 5 && !isLoading;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    try {
      const genRes = await fetch('/api/ai/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refImageUrls, direction: direction.trim() }),
      });
      const genData = (await genRes.json()) as
        | { success: true; data: { imageBase64: string; mimeType: string } }
        | { success: false; error: string };
      if (!genRes.ok || !genData.success) {
        throw new Error(genData.success === false ? genData.error : '썸네일 생성 실패');
      }

      // Supabase 영속화 (role 생략 — upload-ai role enum은 hero/lifestyle/detail/feature만 허용)
      const uploadRes = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: genData.data.imageBase64,
          mimeType: genData.data.mimeType,
        }),
      });
      const uploadData = (await uploadRes.json()) as { success: boolean; url?: string; error?: string };
      if (!uploadRes.ok || !uploadData.success || !uploadData.url) {
        throw new Error(uploadData.error ?? '이미지 업로드 실패');
      }

      updateAssetsDraft({ generatedThumbnails: [...generatedThumbnails, uploadData.url] });
    } catch (err) {
      setError(err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1a1c1c' }}>AI 썸네일 생성</p>

      <div style={{
        padding: '8px 10px',
        borderRadius: 8,
        backgroundColor: hasRef ? 'rgba(22,163,74,0.06)' : '#f9f9f9',
        border: `1px solid ${hasRef ? 'rgba(22,163,74,0.2)' : '#eee'}`,
        fontSize: 12,
        color: hasRef ? '#16a34a' : '#9ca3af',
      }}>
        {hasRef ? `참조 사진 ${refImageUrls.length}장 준비됨` : '이미지를 먼저 업로드하거나 URL에서 가져오세요'}
      </div>

      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        placeholder="예: 스튜디오 조명, 화이트 배경으로 1·2번 사진 합성"
        rows={3}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 12, color: '#111827',
          border: '1px solid #e5e7eb', borderRadius: 8, resize: 'vertical', outline: 'none',
          lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {DIRECTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDirection(ex)}
            style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 20, background: 'none', cursor: 'pointer', color: '#6b7280', lineHeight: 1.4 }}
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: '#dc2626', flex: 1, lineHeight: 1.5 }}>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#dc2626' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={!canGenerate}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 11, borderRadius: 8, border: 'none',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          backgroundColor: canGenerate ? '#be0014' : '#e5e7eb',
          color: canGenerate ? '#fff' : '#9ca3af',
          fontWeight: 700, fontSize: 13,
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            생성 중...
          </>
        ) : (
          <>
            <Wand2 size={15} />
            AI 썸네일 생성
          </>
        )}
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: ThumbnailGeneratePanel.tsx에 타입 오류 없음

> 검증 포인트: `useListingStore()`가 반환하는 `assetsDraft`에 `mode`, `thumbnailFiles`, `detailFiles`, `generatedThumbnails`가 존재하고 `updateAssetsDraft`가 `{ generatedThumbnails: string[] }` 부분 업데이트를 받는지 확인(기존 AssetsInputPanel과 동일 패턴). 타입 오류가 나면 해당 필드명을 store 정의(`src/store/useListingStore.ts`)에 맞춰 수정.

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/assets/ThumbnailGeneratePanel.tsx
git commit -m "feat: ThumbnailGeneratePanel — assets 탭 AI 썸네일 생성 UI"
```

---

## Task 3: AssetsInputPanel에 패널 렌더 + 통합 검증

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`

- [ ] **Step 1: import 추가**

`AssetsInputPanel.tsx` 상단 import 영역에 추가:

```typescript
import ThumbnailGeneratePanel from './ThumbnailGeneratePanel';
```

- [ ] **Step 2: 패널 렌더**

`AssetsInputPanel`의 return JSX에서, 기존 "🔍 씬 이미지 분석" 버튼 블록(`{canAnalyze && (...)}` 또는 includeAiImages 조건 버튼) **다음**이자 모달 렌더(`{inputImageEditTarget && (...)}`) **앞** 위치에 다음을 삽입:

```tsx
      {/* AI 썸네일 생성 패널 */}
      <ThumbnailGeneratePanel />
```

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit`
Expected: AssetsInputPanel.tsx에 새 타입 오류 없음

- [ ] **Step 4: 회귀 테스트 (우리 변경 관련)**

Run: `npx vitest run src/__tests__/api/generate-thumbnail.test.ts src/__tests__/components/assets-tab.test.tsx`
Expected: generate-thumbnail 5 PASS. assets-tab.test.tsx는 사전 존재 실패가 있을 수 있으나(main에서도 동일), 우리 변경으로 **새로 깨진 테스트가 없는지** 확인 — 통과/실패 개수가 main 기준과 동일해야 함.

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx
git commit -m "feat: AssetsInputPanel에 AI 썸네일 생성 패널 추가"
```

---

## Task 4: 통합 수동 검증

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev` → `http://localhost:3000/listing?tab=assets`

- [ ] **Step 2: 시나리오 검증**

**시나리오 A — 업로드 모드:**
1. 업로드 모드에서 썸네일 슬롯에 상품 사진 2장 업로드
2. 하단 "AI 썸네일 생성" 패널에 "참조 사진 2장 준비됨" 표시 확인
3. 연출 방향 입력(또는 예시 태그 클릭) → "AI 썸네일 생성" 클릭
4. Network 탭에서 `/api/ai/generate-thumbnail` 요청 body에 `refImageUrls` 배열(최대 3) 확인
5. 생성 완료 후 우측 결과 패널 썸네일 그리드에 새 이미지 추가 확인

**시나리오 B — 참조/방향 검증:**
1. 이미지 없이 패널 확인 → "이미지를 먼저 업로드…" + 버튼 비활성
2. 연출 방향 5자 미만 → 버튼 비활성

**시나리오 C — 에디터 회귀:**
1. 상품 에디터의 기존 "AI 썸네일 생성"(ThumbnailGenerateSection)이 여전히 동작하는지 확인 (refImages base64 경로 회귀)

- [ ] **Step 3: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "test: assets 탭 AI 썸네일 생성 통합 검증"
```
