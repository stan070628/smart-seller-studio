# 상품상세 자동만들기 — AI 썸네일 만들기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/listing/detail-maker` 화면에서 이미 올린 참고 이미지로 AI 썸네일(쿠팡 규격)을 생성·수정·다운로드할 수 있게 한다.

**Architecture:** 신규 백엔드 없음. 생성·수정 흐름을 순수 lib 함수(`thumbnail-flow.ts`)로 추출해 단위 테스트하고, 좌측 입력 패널 하단 생성 섹션(`DetailMakerThumbnailPanel`)과 우측 결과 갤러리(`DetailMakerThumbnailGallery`) 두 프레젠테이션 컴포넌트를 추가한 뒤 `DetailMakerClient`에서 상태·핸들러로 배선한다.

**Tech Stack:** Next.js(App Router), React, TypeScript, Vitest + React Testing Library, 기존 API(generate-thumbnail, upload-ai, coupang-resize, edit-thumbnail).

**참고 spec:** `docs/superpowers/specs/2026-06-15-detail-maker-thumbnail-design.md`

## File Structure

- Create: `src/lib/detail-page/thumbnail-flow.ts` — 생성/수정 흐름 순수 함수 (fetch 조합)
- Create: `src/__tests__/lib/detail-page/thumbnail-flow.test.ts`
- Create: `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` — 좌측 생성 섹션
- Create: `src/__tests__/components/detail-maker-thumbnail-panel.test.tsx`
- Create: `src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx` — 우측 결과 갤러리
- Create: `src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx`
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` — 썸네일 패널 props 추가 + 렌더
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx` — 상태/핸들러/갤러리 배치

**테스트 실행 주의:** 이 저장소는 인자 없는 `npx vitest run`이 라이브러리 테스트까지 돌려 대량 실패한다. 항상 **경로를 지정**해서 실행한다.

---

### Task 1: thumbnail-flow 라이브러리

**Files:**
- Create: `src/lib/detail-page/thumbnail-flow.ts`
- Test: `src/__tests__/lib/detail-page/thumbnail-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib/detail-page/thumbnail-flow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCoupangThumbnail, editThumbnail } from '@/lib/detail-page/thumbnail-flow';

function mockFetchSequence(responses: Array<{ ok?: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ ok: r.ok ?? true, json: () => Promise.resolve(r.json) });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('generateCoupangThumbnail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generate → upload → coupang-resize 순서로 호출하고 최종 URL을 반환한다', async () => {
    const fn = mockFetchSequence([
      { json: { success: true, data: { imageBase64: 'B64', mimeType: 'image/png' } } },
      { json: { success: true, url: 'https://x/temp.jpg' } },
      { json: { url: 'https://x/coupang-resized/final.jpg' } },
    ]);
    const url = await generateCoupangThumbnail(['https://x/a.jpg'], '화이트 배경 스튜디오');
    expect(url).toBe('https://x/coupang-resized/final.jpg');
    expect(fn).toHaveBeenNthCalledWith(1, '/api/ai/generate-thumbnail', expect.anything());
    expect(fn).toHaveBeenNthCalledWith(2, '/api/image/upload-ai', expect.anything());
    expect(fn).toHaveBeenNthCalledWith(3, '/api/image/coupang-resize', expect.anything());
  });

  it('coupang-resize 실패 시 업로드 URL로 폴백한다', async () => {
    mockFetchSequence([
      { json: { success: true, data: { imageBase64: 'B64', mimeType: 'image/png' } } },
      { json: { success: true, url: 'https://x/temp.jpg' } },
      { ok: false, json: { error: 'resize 실패' } },
    ]);
    const url = await generateCoupangThumbnail(['https://x/a.jpg'], '화이트 배경 스튜디오');
    expect(url).toBe('https://x/temp.jpg');
  });

  it('generate 실패 시 에러를 던진다', async () => {
    mockFetchSequence([{ ok: false, json: { success: false, error: '생성 실패' } }]);
    await expect(generateCoupangThumbnail(['https://x/a.jpg'], '방향')).rejects.toThrow('생성 실패');
  });
});

describe('editThumbnail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edit-thumbnail을 호출하고 editedUrl을 반환한다', async () => {
    const fn = mockFetchSequence([
      { json: { success: true, data: { editedUrl: 'https://x/edited.jpg' } } },
    ]);
    const url = await editThumbnail('https://x/orig.jpg', '배경을 더 밝게');
    expect(url).toBe('https://x/edited.jpg');
    expect(fn).toHaveBeenCalledWith('/api/ai/edit-thumbnail', expect.anything());
  });

  it('실패 시 에러를 던진다', async () => {
    mockFetchSequence([{ ok: false, json: { success: false, error: '수정 실패' } }]);
    await expect(editThumbnail('https://x/orig.jpg', 'p')).rejects.toThrow('수정 실패');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/detail-page/thumbnail-flow.test.ts`
Expected: FAIL — `@/lib/detail-page/thumbnail-flow` 모듈 없음

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/detail-page/thumbnail-flow.ts
/**
 * detail-maker 썸네일 생성/수정 흐름.
 * 신규 백엔드 없이 기존 API를 조합한다.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * 참고 이미지 URL + 연출 방향으로 썸네일을 생성하고 쿠팡 규격으로 리사이즈한 최종 URL을 반환한다.
 * 흐름: generate-thumbnail → upload-ai → coupang-resize (resize 실패 시 업로드 URL 폴백).
 */
export async function generateCoupangThumbnail(
  refImageUrls: string[],
  direction: string,
): Promise<string> {
  // 1. 생성
  const genRes = await fetch('/api/ai/generate-thumbnail', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refImageUrls, direction }),
  });
  const genJson = (await genRes.json()) as
    | { success: true; data: { imageBase64: string; mimeType: string } }
    | { success: false; error: string };
  if (!genRes.ok || !genJson.success) {
    throw new Error(genJson.success === false ? genJson.error : '썸네일 생성 실패');
  }

  // 2. Supabase 영속화
  const upRes = await fetch('/api/image/upload-ai', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imageBase64: genJson.data.imageBase64,
      mimeType: genJson.data.mimeType,
    }),
  });
  const upJson = (await upRes.json()) as { success: boolean; url?: string; error?: string };
  if (!upRes.ok || !upJson.success || !upJson.url) {
    throw new Error(upJson.error ?? '이미지 업로드 실패');
  }
  const tempUrl = upJson.url;

  // 3. 쿠팡 규격 리사이즈 (실패해도 치명적 아님 → 업로드 URL 폴백)
  try {
    const rsRes = await fetch('/api/image/coupang-resize', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ imageUrl: tempUrl }),
    });
    const rsJson = (await rsRes.json()) as { url?: string; error?: string };
    if (rsRes.ok && rsJson.url) return rsJson.url;
    console.warn('[thumbnail-flow] coupang-resize 실패, 원본 사용:', rsJson.error);
    return tempUrl;
  } catch (e) {
    console.warn('[thumbnail-flow] coupang-resize 예외, 원본 사용:', e);
    return tempUrl;
  }
}

/**
 * 기존 썸네일 URL을 프롬프트로 AI 수정한다. edit-thumbnail이 쿠팡 1200² 후처리를 내장한다.
 */
export async function editThumbnail(imageUrl: string, prompt: string): Promise<string> {
  const res = await fetch('/api/ai/edit-thumbnail', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ imageUrl, prompt }),
  });
  const json = (await res.json()) as
    | { success: true; data: { editedUrl: string } }
    | { success: false; error: string };
  if (!res.ok || !json.success) {
    throw new Error(json.success === false ? json.error : '썸네일 수정 실패');
  }
  return json.data.editedUrl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/detail-page/thumbnail-flow.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/thumbnail-flow.ts src/__tests__/lib/detail-page/thumbnail-flow.test.ts
git commit -m "feat: 썸네일 생성/수정 흐름 lib (generate→upload→coupang-resize, edit)"
```

---

### Task 2: DetailMakerThumbnailPanel (좌측 생성 섹션)

**Files:**
- Create: `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx`
- Test: `src/__tests__/components/detail-maker-thumbnail-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/detail-maker-thumbnail-panel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerThumbnailPanel from '@/components/listing/detail-maker/DetailMakerThumbnailPanel';

const base = {
  refImageUrls: ['https://x/a.jpg'],
  isGenerating: false,
  error: null as string | null,
  onGenerate: vi.fn(),
};

describe('DetailMakerThumbnailPanel', () => {
  it('참조 이미지가 없으면 생성 버튼이 비활성이다', () => {
    render(<DetailMakerThumbnailPanel {...base} refImageUrls={[]} onGenerate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeDisabled();
  });

  it('연출 방향이 5자 미만이면 버튼이 비활성이다', () => {
    render(<DetailMakerThumbnailPanel {...base} onGenerate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/연출/), { target: { value: '짧음' } });
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeDisabled();
  });

  it('참조 1장 + 방향 5자 이상이면 클릭 시 onGenerate(direction) 호출', () => {
    const onGenerate = vi.fn();
    render(<DetailMakerThumbnailPanel {...base} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByPlaceholderText(/연출/), { target: { value: '화이트 스튜디오 배경' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 썸네일 생성/ }));
    expect(onGenerate).toHaveBeenCalledWith('화이트 스튜디오 배경');
  });

  it('예시 칩 클릭 시 연출 방향 입력이 채워진다', () => {
    render(<DetailMakerThumbnailPanel {...base} onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByText('화이트 스튜디오 배경, 조명 강조'));
    expect(screen.getByDisplayValue('화이트 스튜디오 배경, 조명 강조')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/detail-maker-thumbnail-panel.test.tsx`
Expected: FAIL — 컴포넌트 모듈 없음

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx
'use client';

import React, { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';

const DIRECTION_EXAMPLES = [
  '화이트 스튜디오 배경, 조명 강조',
  '자연광 야외 라이프스타일 컷',
  '1번·2번 사진을 나란히 합성, 미니멀',
  '그라데이션 배경, 제품 클로즈업',
];

interface Props {
  refImageUrls: string[];
  isGenerating: boolean;
  error: string | null;
  onGenerate: (direction: string) => void;
}

export default function DetailMakerThumbnailPanel({
  refImageUrls,
  isGenerating,
  error,
  onGenerate,
}: Props) {
  const [direction, setDirection] = useState('');
  const hasRef = refImageUrls.length > 0;
  const canGenerate = hasRef && direction.trim().length >= 5 && !isGenerating;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>AI 썸네일 생성</div>

      <div
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: hasRef ? 'rgba(22,163,74,0.06)' : '#f9f9f9',
          border: `1px solid ${hasRef ? 'rgba(22,163,74,0.2)' : C.border}`,
          fontSize: 12,
          color: hasRef ? '#16a34a' : '#9ca3af',
        }}
      >
        {hasRef ? `참조 사진 ${Math.min(refImageUrls.length, 3)}장 사용` : '참고 이미지를 먼저 업로드하세요'}
      </div>

      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        placeholder="연출 방향 예: 스튜디오 조명, 화이트 배경으로 합성"
        rows={3}
        style={{
          width: '100%', padding: '8px 10px', fontSize: 12, color: '#111827',
          border: `1px solid ${C.border}`, borderRadius: 8, resize: 'vertical', outline: 'none',
          lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {DIRECTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setDirection(ex)}
            style={{ padding: '3px 8px', fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 20, background: 'none', cursor: 'pointer', color: '#6b7280', lineHeight: 1.4 }}
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => onGenerate(direction.trim())}
        disabled={!canGenerate}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 10, borderRadius: 8, border: 'none',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          background: canGenerate ? '#be0014' : C.border,
          color: canGenerate ? '#fff' : C.textSub,
          fontWeight: 700, fontSize: 12,
        }}
      >
        {isGenerating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
        {isGenerating ? '생성 중...' : 'AI 썸네일 생성'}
      </button>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/detail-maker-thumbnail-panel.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx src/__tests__/components/detail-maker-thumbnail-panel.test.tsx
git commit -m "feat: DetailMakerThumbnailPanel — 좌측 썸네일 생성 섹션"
```

---

### Task 3: DetailMakerThumbnailGallery (우측 결과 갤러리)

**Files:**
- Create: `src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx`
- Test: `src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerThumbnailGallery from '@/components/listing/detail-maker/DetailMakerThumbnailGallery';

const base = {
  thumbnails: ['https://x/1.jpg', 'https://x/2.jpg'],
  editingUrl: null as string | null,
  onDownload: vi.fn(),
  onRemove: vi.fn(),
  onEdit: vi.fn(),
};

describe('DetailMakerThumbnailGallery', () => {
  it('썸네일 개수만큼 이미지를 렌더한다', () => {
    render(<DetailMakerThumbnailGallery {...base} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('다운로드 버튼 클릭 시 onDownload(url) 호출', () => {
    const onDownload = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onDownload={onDownload} />);
    fireEvent.click(screen.getAllByRole('button', { name: /다운로드/ })[0]);
    expect(onDownload).toHaveBeenCalledWith('https://x/1.jpg');
  });

  it('삭제 버튼 클릭 시 onRemove(url) 호출', () => {
    const onRemove = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getAllByRole('button', { name: /삭제/ })[0]);
    expect(onRemove).toHaveBeenCalledWith('https://x/1.jpg');
  });

  it('AI 수정 → 프롬프트 입력 → 적용 시 onEdit(url, prompt) 호출', () => {
    const onEdit = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onEdit={onEdit} />);
    fireEvent.click(screen.getAllByRole('button', { name: /AI 수정/ })[0]);
    fireEvent.change(screen.getByPlaceholderText(/수정/), { target: { value: '배경 밝게' } });
    fireEvent.click(screen.getByRole('button', { name: /적용/ }));
    expect(onEdit).toHaveBeenCalledWith('https://x/1.jpg', '배경 밝게');
  });

  it('editingUrl인 항목은 수정 중 표시를 보여준다', () => {
    render(<DetailMakerThumbnailGallery {...base} editingUrl="https://x/1.jpg" />);
    expect(screen.getByText(/수정 중/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx`
Expected: FAIL — 컴포넌트 모듈 없음

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx
'use client';

import React, { useState } from 'react';
import { Download, Trash2, Wand2, Loader2 } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface Props {
  thumbnails: string[];
  editingUrl: string | null;
  onDownload: (url: string) => void;
  onRemove: (url: string) => void;
  onEdit: (url: string, prompt: string) => void;
}

export default function DetailMakerThumbnailGallery({
  thumbnails,
  editingUrl,
  onDownload,
  onRemove,
  onEdit,
}: Props) {
  const [editTargetUrl, setEditTargetUrl] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  function startEdit(url: string) {
    setEditTargetUrl(url);
    setEditPrompt('');
  }
  function applyEdit(url: string) {
    if (editPrompt.trim().length === 0) return;
    onEdit(url, editPrompt.trim());
    setEditTargetUrl(null);
    setEditPrompt('');
  }

  return (
    <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: C.card }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        생성된 썸네일 ({thumbnails.length})
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
        {thumbnails.map((url) => {
          const isEditing = editingUrl === url;
          return (
            <div key={url} style={{ position: 'relative', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="생성된 썸네일" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', opacity: isEditing ? 0.5 : 1 }} />

              {isEditing && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(255,255,255,0.6)', fontSize: 12, color: C.text, fontWeight: 600 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 수정 중...
                </div>
              )}

              {editTargetUrl === url ? (
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="수정 지시 예: 배경 밝게"
                    style={{ width: '100%', padding: '6px 8px', fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, color: '#111', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => applyEdit(url)} style={{ flex: 1, padding: '6px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: '#be0014', color: '#fff', cursor: 'pointer' }}>적용</button>
                    <button type="button" onClick={() => setEditTargetUrl(null)} style={{ flex: 1, padding: '6px', fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff', color: C.textSub, cursor: 'pointer' }}>취소</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 4, padding: 8 }}>
                  <button type="button" aria-label="다운로드" onClick={() => onDownload(url)} title="다운로드" style={iconBtn}><Download size={14} /></button>
                  <button type="button" aria-label="AI 수정" onClick={() => startEdit(url)} title="AI 수정" disabled={isEditing} style={iconBtn}><Wand2 size={14} /></button>
                  <button type="button" aria-label="삭제" onClick={() => onRemove(url)} title="삭제" style={{ ...iconBtn, marginLeft: 'auto', color: '#dc2626' }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 6,
  background: '#fff', color: '#374151', cursor: 'pointer',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx
git commit -m "feat: DetailMakerThumbnailGallery — 우측 썸네일 결과 갤러리"
```

---

### Task 4: DetailMakerInputPanel에 썸네일 패널 연결

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`

DetailMakerInputPanel은 순수 프레젠테이션 컴포넌트다. 썸네일 패널을 무드 브리프(CreativeBriefPanel) 아래에 렌더하도록 props를 추가한다.

- [ ] **Step 1: import 추가**

`DetailMakerInputPanel.tsx` 상단 import 블록(`import CreativeBriefPanel from './CreativeBriefPanel';` 아래)에 추가:

```tsx
import DetailMakerThumbnailPanel from './DetailMakerThumbnailPanel';
```

- [ ] **Step 2: Props 인터페이스에 썸네일 필드 추가**

`interface Props { ... }` 의 `onSelectMood: (id: string) => void;` 다음 줄에 추가:

```tsx
  // 썸네일 생성
  thumbnailRefUrls: string[];
  isGeneratingThumbnail: boolean;
  thumbnailError: string | null;
  onGenerateThumbnail: (direction: string) => void;
```

- [ ] **Step 3: 구조분해 파라미터에 추가**

`export default function DetailMakerInputPanel({ ... })` 의 구조분해 목록 `onSelectMood,` 다음에 추가:

```tsx
  thumbnailRefUrls,
  isGeneratingThumbnail,
  thumbnailError,
  onGenerateThumbnail,
```

- [ ] **Step 4: CreativeBriefPanel 아래에 썸네일 패널 렌더**

`<CreativeBriefPanel ... />` JSX 블록(닫는 `/>` 포함) 바로 다음에 추가:

```tsx
        {/* AI 썸네일 생성 */}
        <DetailMakerThumbnailPanel
          refImageUrls={thumbnailRefUrls}
          isGenerating={isGeneratingThumbnail}
          error={thumbnailError}
          onGenerate={onGenerateThumbnail}
        />
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit 2>&1 | grep DetailMakerInputPanel || echo "OK"`
Expected: `OK` (이 시점엔 DetailMakerClient가 새 props를 아직 안 넘겨 에러가 날 수 있음 — Task 5에서 해소. 컴포넌트 자체 문법 에러만 없으면 됨)

- [ ] **Step 6: Commit**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx
git commit -m "feat: DetailMakerInputPanel에 썸네일 생성 패널 배선"
```

---

### Task 5: DetailMakerClient 상태·핸들러·갤러리 배치

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: import 추가**

`DetailMakerClient.tsx` 상단, `import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';` 아래에 추가:

```tsx
import DetailMakerThumbnailGallery from '@/components/listing/detail-maker/DetailMakerThumbnailGallery';
import { generateCoupangThumbnail, editThumbnail } from '@/lib/detail-page/thumbnail-flow';
```

- [ ] **Step 2: 상태 추가**

`const [isSuggestingMood, setIsSuggestingMood] = useState(false);` 다음 줄에 추가:

```tsx
  // 썸네일
  const [generatedThumbnails, setGeneratedThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [editingThumbnailUrl, setEditingThumbnailUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
```

- [ ] **Step 3: 핸들러 추가**

`handleSelectMood` 함수 정의 다음(닫는 `}` 뒤)에 추가:

```tsx
  // ─── 썸네일 생성/수정/관리 ────────────────────────────────────────────────────
  async function handleGenerateThumbnail(direction: string) {
    if (uploadedUrls.length === 0) { setThumbnailError('참고 이미지를 먼저 업로드하세요.'); return; }
    setIsGeneratingThumbnail(true);
    setThumbnailError(null);
    try {
      const url = await generateCoupangThumbnail(uploadedUrls.slice(0, 3), direction);
      setGeneratedThumbnails(prev => [...prev, url]);
    } catch (e) {
      setThumbnailError(e instanceof Error ? e.message : '썸네일 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGeneratingThumbnail(false);
    }
  }

  async function handleEditThumbnail(url: string, prompt: string) {
    setEditingThumbnailUrl(url);
    setThumbnailError(null);
    try {
      const editedUrl = await editThumbnail(url, prompt);
      setGeneratedThumbnails(prev => prev.map(u => (u === url ? editedUrl : u)));
    } catch (e) {
      setThumbnailError(e instanceof Error ? e.message : '썸네일 수정 중 오류가 발생했습니다.');
    } finally {
      setEditingThumbnailUrl(null);
    }
  }

  function handleRemoveThumbnail(url: string) {
    setGeneratedThumbnails(prev => prev.filter(u => u !== url));
  }

  async function handleDownloadThumbnail(url: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `thumbnail-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setThumbnailError('다운로드에 실패했습니다.');
    }
  }
```

- [ ] **Step 4: InputPanel에 썸네일 props 전달**

`<DetailMakerInputPanel ... />` 의 `onSelectMood={handleSelectMood}` 다음 줄에 추가:

```tsx
        thumbnailRefUrls={uploadedUrls}
        isGeneratingThumbnail={isGeneratingThumbnail}
        thumbnailError={thumbnailError}
        onGenerateThumbnail={handleGenerateThumbnail}
```

- [ ] **Step 5: 우측 영역에 갤러리 배치**

우측 `<div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>` 의 여는 태그 바로 다음 줄(기존 `{sections.length > 0 ? (` 위)에, 우측 영역을 세로 스택으로 바꾸기 위해 갤러리를 추가한다. 기존 우측 컨테이너의 `overflow: 'hidden'`을 `overflowY: 'auto'`로 바꾸고 내부를 세로 컬럼으로 감싼다:

기존:
```tsx
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {sections.length > 0 ? (
```

변경 후:
```tsx
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {generatedThumbnails.length > 0 && (
          <DetailMakerThumbnailGallery
            thumbnails={generatedThumbnails}
            editingUrl={editingThumbnailUrl}
            onDownload={handleDownloadThumbnail}
            onRemove={handleRemoveThumbnail}
            onEdit={handleEditThumbnail}
          />
        )}
        {sections.length > 0 ? (
```

> 주의: 우측 영역이 이제 갤러리 + (에디터 또는 EmptyState)를 세로로 쌓는다. 에디터/EmptyState를 감싸는 기존 블록은 그대로 두되, EmptyState가 `height: '100%'`로 갤러리를 밀어내지 않도록 갤러리가 있을 때 빈 영역 높이가 깨지면 EmptyState 래퍼를 `flex: 1`로 둔다. 기존 EmptyState/에디터 컨테이너 구조는 유지하고, 시각 확인은 Step 7에서.

- [ ] **Step 6: 타입 체크 + 전체 관련 테스트**

Run: `npx tsc --noEmit 2>&1 | grep -E "DetailMaker|thumbnail-flow" || echo "OK"`
Expected: `OK`

Run: `npx vitest run src/__tests__/lib/detail-page/thumbnail-flow.test.ts src/__tests__/components/detail-maker-thumbnail-panel.test.tsx src/__tests__/components/detail-maker-thumbnail-gallery.test.tsx`
Expected: PASS (14 tests)

- [ ] **Step 7: 수동 시각 확인 (dev 서버)**

로컬 dev 서버(`http://localhost:3000/listing/detail-maker`)에 로그인 후: 참고 이미지 업로드 → 좌측 하단 "AI 썸네일 생성" 섹션에서 연출 방향 입력 → 생성 → 우측 상단 갤러리에 썸네일 표시 → 다운로드/삭제/AI수정 동작 확인.

- [ ] **Step 8: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: detail-maker에 썸네일 생성/수정/갤러리 배선"
```

---

## 최종 검증

- [ ] `npx tsc --noEmit` 전체 통과 (기존 무관 에러 제외)
- [ ] `npx eslint src/lib/detail-page/thumbnail-flow.ts src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx src/components/listing/detail-maker/DetailMakerThumbnailGallery.tsx src/components/listing/detail-maker/DetailMakerInputPanel.tsx src/app/listing/detail-maker/DetailMakerClient.tsx` 클린
- [ ] 신규 테스트 14개 통과
- [ ] dev 서버에서 생성→다운로드→AI수정 흐름 수동 확인
