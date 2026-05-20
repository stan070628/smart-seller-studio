# 대화로 만들기 이미지 수정 + 미리보기 텍스트 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "썸네일·상세만 만들기" 탭의 "대화로 만들기"에서 상세용 이미지만 HTML에 포함되도록 수정하고, 이미지 한도를 6장으로 올리며, 생성 직후 미리보기에서 텍스트를 인라인 편집할 수 있게 한다.

**Architecture:** 3개 컴포넌트만 수정한다. `ConversationalDetailModal`에서 `.slice(0, 5)` → `.slice(0, 6)`. `AssetsInputPanel`에서 modal에 전달하는 이미지를 `detailFiles`로 교체. `AssetsResultPanel`에서 sections가 처음 채워질 때 `/api/detail-page/render`를 자동 호출해 `data-edit-path` 포함 HTML로 교체.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, MSW

---

## 파일 구조

| 파일 | 역할 | 변경 유형 |
|------|------|-----------|
| `src/components/listing/assets/ConversationalDetailModal.tsx` | 대화 플로우 + API 호출 | 수정 (slice 3곳) |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 이미지 슬롯 관리 + modal 호출 | 수정 (imageUrls prop) |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 결과 렌더링 + HTML 갱신 | 수정 (useRef + useEffect 추가) |
| `src/__tests__/components/conversational-detail-modal.test.tsx` | modal 테스트 | 수정 (6장 케이스 추가) |
| `src/__tests__/components/assets-input-panel.test.tsx` | input panel 테스트 | 수정 (detailFiles 전달 케이스 추가) |
| `src/__tests__/components/assets-result-panel.test.tsx` | result panel 테스트 | 수정 (auto-render 케이스 추가) |

---

## Task 1: ConversationalDetailModal — 이미지 한도 5 → 6

**Files:**
- Modify: `src/components/listing/assets/ConversationalDetailModal.tsx:124,252,260`
- Test: `src/__tests__/components/conversational-detail-modal.test.tsx`

- [ ] **Step 1: 6장 이미지를 전달할 때 suggest-answers 호출이 6장을 body에 포함하는지 검증하는 실패 테스트 추가**

기존 `conversational-detail-modal.test.tsx` 파일을 열고, `describe('ConversationalDetailModal')` 블록 안에 다음 테스트를 추가한다.

```typescript
it('imageUrls가 6장이면 suggest-answers 호출 시 6장 모두 전달된다', async () => {
  const sixUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/img${i}.jpg`);
  let capturedBody: unknown;
  server.use(
    http.post('/api/ai/detail-page-suggest-answers', async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json({ success: true, data: { suggestions: [] } });
    }),
  );
  server.use(
    http.post('/api/ai/generate-detail-html', () =>
      HttpResponse.json({ html: '<div>ok</div>' }),
    ),
  );

  render(
    <ConversationalDetailModal
      {...defaultProps}
      imageUrls={sixUrls}
      onClose={() => {}}
      onComplete={() => {}}
    />,
  );

  await waitFor(() => expect(capturedBody).toBeDefined());
  expect((capturedBody as { imageUrls: string[] }).imageUrls).toHaveLength(6);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/conversational-detail-modal.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: `expect(received).toHaveLength(6)` 실패 (현재 5장만 전달)

- [ ] **Step 3: ConversationalDetailModal.tsx 3곳 수정**

`src/components/listing/assets/ConversationalDetailModal.tsx`를 열어 다음 3곳을 수정한다.

**124번 줄** (`detail-page-suggest-answers` 호출):
```typescript
// Before
imageUrls: imageUrls.slice(0, 5),
// After
imageUrls: imageUrls.slice(0, 6),
```

**252번 줄** (`conversationContext` 객체):
```typescript
// Before
imageUrls: imageUrls.slice(0, 5),
// After
imageUrls: imageUrls.slice(0, 6),
```

**260번 줄** (`generate-detail-html` 호출 body):
```typescript
// Before
imageUrls: imageUrls.slice(0, 5),
// After
imageUrls: imageUrls.slice(0, 6),
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/conversational-detail-modal.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: PASS (새 테스트 포함 전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/assets/ConversationalDetailModal.tsx \
        src/__tests__/components/conversational-detail-modal.test.tsx
git commit -m "fix(assets): 대화로 만들기 이미지 한도 5장 → 6장"
```

---

## Task 2: AssetsInputPanel — detailFiles만 ConversationalDetailModal에 전달

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx:508`
- Test: `src/__tests__/components/assets-input-panel.test.tsx`

- [ ] **Step 1: detailFiles만 전달되는지 검증하는 실패 테스트 추가**

기존 `assets-input-panel.test.tsx` 파일을 열고 다음 테스트를 추가한다. MSW와 `vi.fn()`을 사용해 modal에 전달된 `imageUrls` prop을 캡처한다.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssetsInputPanel from '@/components/listing/assets/AssetsInputPanel';
import { useListingStore } from '@/store/useListingStore';

// ConversationalDetailModal을 mock해서 전달된 imageUrls를 캡처
vi.mock('@/components/listing/assets/ConversationalDetailModal', () => ({
  default: ({ imageUrls, onClose }: { imageUrls: string[]; onClose: () => void }) => (
    <div data-testid="modal" data-image-count={imageUrls.length} data-first-url={imageUrls[0] ?? ''}>
      <button onClick={onClose}>닫기</button>
    </div>
  ),
}));

describe('AssetsInputPanel — 대화로 만들기 imageUrls', () => {
  it('ConversationalDetailModal에 detailFiles만 전달된다 (thumbnailFiles 제외)', async () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: ['https://example.com/detail1.jpg', 'https://example.com/detail2.jpg'],
      category: 'basic',
    });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} />);

    // 대화로 만들기 버튼 클릭
    fireEvent.click(screen.getByRole('button', { name: /대화로 만들기/ }));

    const modal = await waitFor(() => screen.getByTestId('modal'));

    // imageUrls에 detailFiles만 있어야 함 (thumbnailFiles 제외)
    expect(modal.dataset.imageCount).toBe('2');
    expect(modal.dataset.firstUrl).toBe('https://example.com/detail1.jpg');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: `imageCount`가 3(thumbnail+detail)이어서 실패

- [ ] **Step 3: AssetsInputPanel.tsx 수정**

`src/components/listing/assets/AssetsInputPanel.tsx` 508번 줄을 수정한다.

```tsx
// Before (508번 줄)
imageUrls={allImageUrls}

// After
imageUrls={detailFiles}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/assets-input-panel.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx \
        src/__tests__/components/assets-input-panel.test.tsx
git commit -m "fix(assets): 대화로 만들기에 상세용 이미지만 전달"
```

---

## Task 3: AssetsResultPanel — sections 첫 채움 시 렌더 HTML 자동 갱신

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx:3`
- Test: `src/__tests__/components/assets-result-panel.test.tsx`

- [ ] **Step 1: sections가 비었다가 채워지면 render API가 호출되는지 검증하는 실패 테스트 추가**

기존 `assets-result-panel.test.tsx`를 열고 다음 테스트를 추가한다.

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import AssetsResultPanel from '@/components/listing/assets/AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import { server } from '../mocks/server';
import type { DetailSection } from '@/types/detail-page';

const makeSection = (): DetailSection => ({
  id: 'sec-1',
  type: 'hero',
  order: 0,
  content: { headline: '타이틀', subheadline: '서브타이틀' },
  attachedImages: [],
});

describe('AssetsResultPanel — 자동 렌더 갱신', () => {
  it('detailPageSections가 빈 상태에서 채워지면 /api/detail-page/render를 호출한다', async () => {
    let renderCalled = false;
    server.use(
      http.post('/api/detail-page/render', () => {
        renderCalled = true;
        return HttpResponse.json({ html: '<div data-edit-path="content.headline">타이틀</div>' });
      }),
    );

    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      generatedThumbnails: ['https://example.com/t.jpg'],
      generatedDetailHtml: '<div>초기 HTML (data-edit-path 없음)</div>',
      detailPageSections: [],
    });

    render(<AssetsResultPanel />);

    // sections를 채움 (대화 완료 시나리오)
    await act(async () => {
      store.updateAssetsDraft({ detailPageSections: [makeSection()] });
    });

    expect(renderCalled).toBe(true);
  });

  it('이미 sections가 있는 상태에서 추가되면 render를 재호출하지 않는다', async () => {
    let renderCallCount = 0;
    server.use(
      http.post('/api/detail-page/render', () => {
        renderCallCount++;
        return HttpResponse.json({ html: '<div>ok</div>' });
      }),
    );

    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      generatedThumbnails: ['https://example.com/t.jpg'],
      generatedDetailHtml: '<div>기존 HTML</div>',
      detailPageSections: [makeSection()],
    });

    render(<AssetsResultPanel />);

    // sections가 이미 있는 상태에서 또 변경
    await act(async () => {
      store.updateAssetsDraft({ detailPageSections: [makeSection(), { ...makeSection(), id: 'sec-2', order: 1 }] });
    });

    expect(renderCallCount).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/assets-result-panel.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: `expect(renderCalled).toBe(true)` 실패

- [ ] **Step 3: AssetsResultPanel.tsx 수정**

`src/components/listing/assets/AssetsResultPanel.tsx`를 아래 순서로 수정한다.

**① 3번 줄 — import 수정:**
```typescript
// Before
import React, { useState } from 'react';

// After
import React, { useState, useRef, useEffect } from 'react';
```

**② `refreshRenderedHtml`을 early return 앞으로 이동:**

현재 `refreshRenderedHtml`은 179번 줄(early return 이후)에 정의돼 있다. React Hooks 규칙상 `useRef`/`useEffect`는 early return(81번 줄) 앞에 위치해야 하므로, `refreshRenderedHtml`도 함께 앞으로 옮긴다.

179~203번 줄의 `refreshRenderedHtml` 함수 전체를 **잘라내어**, `sectionImageEditTarget` useState 선언 직후(약 38번 줄, `toggleSelect` 정의 앞)에 **붙여넣는다**:

```typescript
  // early return 전에 정의해야 useEffect가 참조할 수 있다.
  const refreshRenderedHtml = async (
    sections: DetailSection[] = detailPageSections,
    theme: DetailPageTheme = detailPageTheme,
  ) => {
    if (sections.length === 0) return;
    setIsRendering(true);
    setRenderError(null);
    try {
      const res = await fetch('/api/detail-page/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections, theme }),
      });
      const json = await res.json();
      if (res.ok) {
        updateAssetsDraft({ generatedDetailHtml: json.html });
      } else {
        setRenderError(json.error ?? '미리보기 갱신에 실패했습니다.');
      }
    } catch {
      setRenderError('미리보기 갱신 중 오류가 발생했습니다.');
    } finally {
      setIsRendering(false);
    }
  };
```

**③ `refreshRenderedHtml` 바로 아래에 `useRef` + `useEffect` 추가 (early return 전):**

```typescript
  // sections가 빈 상태(0)에서 처음 채워질 때 section-renderer HTML로 교체.
  // buildDetailPageHtml 출력에는 data-edit-path가 없어 인라인 편집이 안 되므로
  // 최초 1회만 render API를 호출해 편집 가능한 HTML로 바꾼다.
  const prevSectionsLengthRef = useRef(detailPageSections.length);
  useEffect(() => {
    if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0) {
      void refreshRenderedHtml(detailPageSections, detailPageTheme);
    }
    prevSectionsLengthRef.current = detailPageSections.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPageSections]);
```

> **주의**: `refreshRenderedHtml`을 dependency에 넣으면 매 섹션 변경마다 재호출된다. `eslint-disable` 주석으로 경고를 억제하고 `prevSectionsLengthRef`로 "첫 채움"만 감지한다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/assets-result-panel.test.tsx --reporter=verbose 2>&1 | tail -20
```

예상: PASS (새 테스트 2개 포함 전체 통과)

- [ ] **Step 5: 전체 테스트 실행 — 회귀 확인**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

예상: 전체 PASS, 실패 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/assets/AssetsResultPanel.tsx \
        src/__tests__/components/assets-result-panel.test.tsx
git commit -m "feat(assets): 대화 완료 후 미리보기 텍스트 인라인 편집 활성화"
```
