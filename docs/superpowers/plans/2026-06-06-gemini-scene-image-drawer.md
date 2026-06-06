# Gemini 씬별 이미지 사이드 드로어 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지 생성 시 Gemini가 씬별 이미지 4개를 생성하고, 결과 화면의 사이드 드로어에서 기존 업로드 이미지 또는 새 파일로 각 씬 이미지를 교체할 수 있게 한다.

**Architecture:** 기존 인라인 `AiImageSlotsPanel`을 씬 카드 4개 그리드로 교체하고, 카드 클릭 시 오른쪽에서 드로어(`SceneImageDrawer`)가 슬라이드인된다. 드로어 안에서 기존 업로드 이미지 또는 새 파일을 선택하면 `handleReplaceSlot`이 `buildAiDetailPageHtml`로 HTML을 즉시 재빌드해 미리보기가 갱신된다.

**Tech Stack:** React/Next.js 16, Zustand(`useListingStore`), Vitest + React Testing Library

---

## 파일 구조

| 파일 | 변경 | 역할 |
|------|------|------|
| `src/store/useListingStore.ts` | 수정 | `includeAiImages` 기본값 `true`로 변경 |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 | useEffect 조건 수정, `AiImageSlotsPanel` 제거, 씬 카드 그리드 + 드로어 연결 |
| `src/components/listing/assets/SceneImageDrawer.tsx` | 신규 | 씬 이미지 교체 사이드 드로어 |
| `src/__tests__/components/scene-image-drawer.test.tsx` | 신규 | SceneImageDrawer 단위 테스트 |

---

## Task 1: 버그 수정 — refreshRenderedHtml 자동 덮어쓰기 + includeAiImages 기본 활성화

**Files:**
- Modify: `src/store/useListingStore.ts:249`
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx:131-138,193-200`

현재 두 가지 버그가 있다:
1. `includeAiImages` 기본값이 `false`라 체크박스를 매번 수동으로 켜야 Gemini 이미지가 생성된다
2. `detailPageSections`가 처음 채워질 때 useEffect가 `/api/detail-page/render`를 자동 호출해 Gemini 이미지가 포함된 `generatedDetailHtml`을 덮어쓴다

- [ ] **Step 1: `useListingStore.ts` — `includeAiImages` 기본값 변경**

`src/store/useListingStore.ts` line 249에서:
```typescript
// 변경 전
includeAiImages: false,

// 변경 후
includeAiImages: true,
```

- [ ] **Step 2: `AssetsResultPanel.tsx` — `includeAiImages` destructuring 추가**

`src/components/listing/assets/AssetsResultPanel.tsx` line 131-138에서:
```typescript
// 변경 전
const {
  generatedThumbnails,
  generatedDetailHtml,
  detailPageSections,
  detailPageTheme,
  aiImageSlots,
  aiDetailContent,
} = assetsDraft;

// 변경 후
const {
  generatedThumbnails,
  generatedDetailHtml,
  detailPageSections,
  detailPageTheme,
  aiImageSlots,
  aiDetailContent,
  includeAiImages,
} = assetsDraft;
```

- [ ] **Step 3: `AssetsResultPanel.tsx` — useEffect 조건 수정**

`src/components/listing/assets/AssetsResultPanel.tsx` line 193-200에서:
```typescript
// 변경 전
useEffect(() => {
  if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0) {
    console.log(`[AssetsResultPanel] sections 첫 채움: aiImageSlots=${aiImageSlots.length}, aiDetailContent=${!!aiDetailContent} → refreshRenderedHtml=${aiImageSlots.length === 0 ? 'YES' : 'NO'}`);
    if (aiImageSlots.length === 0) {
      void refreshRenderedHtml(detailPageSections, detailPageTheme);
    }
  }
  prevSectionsLengthRef.current = detailPageSections.length;
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [detailPageSections]);

// 변경 후
useEffect(() => {
  // includeAiImages=true이고 aiDetailContent가 있으면 AI HTML을 직접 빌드했으므로 render API 자동 호출 불필요
  // 일반 생성(includeAiImages=false)에서는 refreshRenderedHtml로 data-edit-path 포함 HTML 확보
  if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0 && !(includeAiImages && aiDetailContent)) {
    void refreshRenderedHtml(detailPageSections, detailPageTheme);
  }
  prevSectionsLengthRef.current = detailPageSections.length;
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [detailPageSections]);
```

- [ ] **Step 4: 개발 서버에서 동작 확인**

브라우저에서 `/listing?tab=assets` 접속 → 이미지 업로드 → 생성 버튼 클릭 → 브라우저 콘솔에서 확인:
```
[AssetsTab] includeAiImages=true, imagePrompts=4개
```
서버 로그에서 확인:
```
[generate-detail-html] imagePrompts 생성 성공: 4개
POST /api/ai/generate-frame-image 200 in ...   (4회 호출)
```

- [ ] **Step 5: 커밋**

```bash
git add src/store/useListingStore.ts src/components/listing/assets/AssetsResultPanel.tsx
git commit -m "fix: Gemini 이미지 미표시 버그 수정 — includeAiImages 기본 활성화, refreshRenderedHtml 자동 덮어쓰기 방지"
```

---

## Task 2: SceneImageDrawer 컴포넌트 신규 작성

**Files:**
- Create: `src/components/listing/assets/SceneImageDrawer.tsx`
- Create: `src/__tests__/components/scene-image-drawer.test.tsx`

- [ ] **Step 1: 테스트 파일 작성**

`src/__tests__/components/scene-image-drawer.test.tsx` 생성:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SceneImageDrawer from '@/components/listing/assets/SceneImageDrawer';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

const SLOTS: AiImageSlot[] = [
  { role: 'hero', url: 'https://example.com/hero.jpg', prompt: 'hero scene', isReplaced: false },
  { role: 'lifestyle', url: 'https://example.com/lifestyle.jpg', prompt: 'lifestyle scene', isReplaced: false },
];

describe('SceneImageDrawer', () => {
  it('선택된 씬 이름을 헤더에 표시한다', () => {
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={vi.fn()}
      />
    );
    expect(screen.getByText('메인 히어로 교체')).toBeInTheDocument();
  });

  it('닫기 버튼 클릭 시 onClose를 호출한다', () => {
    const onClose = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={onClose}
        onSelectScene={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('←'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('업로드된 이미지 클릭 시 onReplace와 onClose를 호출한다', () => {
    const onReplace = vi.fn();
    const onClose = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={1}
        uploadedImages={['https://example.com/uploaded.jpg']}
        onReplace={onReplace}
        onClose={onClose}
        onSelectScene={vi.fn()}
      />
    );
    fireEvent.click(screen.getByAltText('업로드 이미지 1').closest('button')!);
    expect(onReplace).toHaveBeenCalledWith(1, 'https://example.com/uploaded.jpg', true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('씬 전환 탭 클릭 시 onSelectScene을 호출한다', () => {
    const onSelectScene = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={onSelectScene}
      />
    );
    fireEvent.click(screen.getByText('라이프스타일'));
    expect(onSelectScene).toHaveBeenCalledWith(1);
  });

  it('slots가 비어있거나 activeIndex가 범위 밖이면 null을 반환한다', () => {
    const { container } = render(
      <SceneImageDrawer
        slots={[]}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/scene-image-drawer.test.tsx
```
Expected: FAIL — `SceneImageDrawer` 모듈을 찾을 수 없음

- [ ] **Step 3: `SceneImageDrawer.tsx` 구현**

`src/components/listing/assets/SceneImageDrawer.tsx` 생성:
```typescript
'use client';

import React, { useRef } from 'react';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

const ROLE_LABELS: Record<AiImageSlot['role'], string> = {
  hero: '메인 히어로',
  lifestyle: '라이프스타일',
  detail: '소재·디테일',
  feature: '기능 강조',
};

interface SceneImageDrawerProps {
  slots: AiImageSlot[];
  activeIndex: number;
  uploadedImages: string[];
  onReplace: (index: number, newUrl: string, isReplaced: boolean) => void;
  onClose: () => void;
  onSelectScene: (index: number) => void;
}

export default function SceneImageDrawer({
  slots,
  activeIndex,
  uploadedImages,
  onReplace,
  onClose,
  onSelectScene,
}: SceneImageDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const activeSlot = slots[activeIndex];
  if (!activeSlot) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/image/upload-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: reader.result,
            mimeType: file.type,
            role: activeSlot.role,
          }),
        });
        const data = await res.json() as { success: boolean; url?: string };
        if (data.success && data.url) {
          onReplace(activeIndex, data.url, true);
          onClose();
        }
      } catch { /* silent */ } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUploadedImageSelect = (url: string) => {
    onReplace(activeIndex, url, true);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: '380px',
        backgroundColor: '#fff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* 헤더 */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
        >
          ←
        </button>
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>
          {ROLE_LABELS[activeSlot.role]} 교체
        </span>
      </div>

      {/* 현재 씬 이미지 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '8px' }}>현재 이미지</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeSlot.url}
          alt={ROLE_LABELS[activeSlot.role]}
          style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb' }}
        />
        {activeSlot.isReplaced && (
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '4px' }}>✓ 교체됨</div>
        )}
      </div>

      {/* 씬 전환 탭 */}
      {slots.length > 1 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
          {slots.map((slot, idx) => (
            <button
              key={slot.role}
              onClick={() => onSelectScene(idx)}
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: idx === activeIndex ? '1px solid #7c3aed' : '1px solid #e5e7eb',
                background: idx === activeIndex ? '#f5f3ff' : '#fff',
                color: idx === activeIndex ? '#7c3aed' : '#6b7280',
                cursor: 'pointer',
                fontWeight: idx === activeIndex ? 700 : 400,
              }}
            >
              {ROLE_LABELS[slot.role]}
            </button>
          ))}
        </div>
      )}

      {/* 업로드된 이미지 선택 */}
      {uploadedImages.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>내 업로드 이미지</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {uploadedImages.map((url, idx) => (
              <button
                key={idx}
                onClick={() => handleUploadedImageSelect(url)}
                style={{ padding: 0, border: '2px solid transparent', borderRadius: '6px', cursor: 'pointer', overflow: 'hidden', background: 'none' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`업로드 이미지 ${idx + 1}`}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 새 파일 첨부 */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>새 파일 첨부</div>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { void handleFileSelect(e); }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            width: '100%',
            padding: '10px',
            border: '1.5px dashed #d1d5db',
            borderRadius: '8px',
            background: '#f9fafb',
            color: '#6b7280',
            fontSize: '13px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? '업로드 중...' : '+ 내 기기에서 이미지 선택'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/scene-image-drawer.test.tsx
```
Expected: PASS — 5/5 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/assets/SceneImageDrawer.tsx src/__tests__/components/scene-image-drawer.test.tsx
git commit -m "feat: SceneImageDrawer 컴포넌트 — 씬별 이미지 사이드 드로어 교체 UI"
```

---

## Task 3: AssetsResultPanel 리팩토링 — AiImageSlotsPanel → 씬 카드 그리드 + 드로어

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx`

`AiImageSlotsPanel` 함수 컴포넌트(line 39-127)를 삭제하고, 씬 카드 그리드와 `SceneImageDrawer`를 연결한다.

- [ ] **Step 1: `AiImageSlotsPanel` 및 관련 타입 제거**

`src/components/listing/assets/AssetsResultPanel.tsx` 상단에서 다음을 제거한다:
- `AiImageSlotsPanelProps` interface (line 32-37)
- `AiImageSlotsPanel` 함수 전체 (line 39-127)

- [ ] **Step 2: `SceneImageDrawer` import 추가**

파일 상단 import 섹션에 추가:
```typescript
import SceneImageDrawer from './SceneImageDrawer';
```

- [ ] **Step 3: `activeDrawerIndex` state 추가**

`AssetsResultPanel` 함수 안, 기존 state 선언들 아래에 추가:
```typescript
// 씬 이미지 드로어 — 열린 씬 인덱스 (null이면 닫힘)
const [activeDrawerIndex, setActiveDrawerIndex] = useState<number | null>(null);
```

- [ ] **Step 4: 씬 카드 그리드 + 드로어 렌더링 교체**

기존 `AiImageSlotsPanel` 렌더링 부분(line 590-598):
```typescript
{/* AI 생성 이미지 슬롯 관리 */}
{aiImageSlots.length > 0 && (
  <AiImageSlotsPanel
    slots={aiImageSlots}
    onReplace={handleReplaceSlot}
    onRegenerate={handleRegenerateSlot}
    onDelete={handleDeleteSlot}
  />
)}
```

위 코드를 아래로 교체:
```typescript
{/* AI 씬 이미지 카드 그리드 */}
{aiImageSlots.length > 0 && (
  <div style={{ backgroundColor: '#faf5ff', border: '1px solid #c4b5fd', borderRadius: '12px', padding: '16px' }}>
    <div style={{ fontSize: '13px', fontWeight: 700, color: '#7c3aed', marginBottom: '12px' }}>
      AI 생성 이미지{' '}
      <span style={{ fontWeight: 400, fontSize: '12px', color: '#9ca3af' }}>— 씬을 클릭해서 교체</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
      {aiImageSlots.map((slot, idx) => (
        <div
          key={slot.role}
          onClick={() => setActiveDrawerIndex(idx)}
          style={{
            cursor: 'pointer',
            borderRadius: '8px',
            overflow: 'hidden',
            border: activeDrawerIndex === idx ? '2px solid #7c3aed' : '2px solid #e5e7eb',
            transition: 'border-color 0.15s',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slot.url}
            alt={ROLE_LABELS[slot.role]}
            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            padding: '4px 6px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#374151',
            backgroundColor: '#f9fafb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>{ROLE_LABELS[slot.role]}</span>
            {slot.isReplaced && <span style={{ color: '#16a34a', fontSize: '10px' }}>✓</span>}
          </div>
        </div>
      ))}
    </div>
  </div>
)}

{/* 씬 교체 드로어 */}
{activeDrawerIndex !== null && (
  <SceneImageDrawer
    slots={aiImageSlots}
    activeIndex={activeDrawerIndex}
    uploadedImages={generatedThumbnails}
    onReplace={handleReplaceSlot}
    onClose={() => setActiveDrawerIndex(null)}
    onSelectScene={setActiveDrawerIndex}
  />
)}
```

- [ ] **Step 5: 사용하지 않는 `handleDeleteSlot` 참조 확인**

`handleDeleteSlot`, `handleRegenerateSlot`은 드로어에서 사용하지 않는다. 파일에서 다른 곳에서 참조하는지 확인:
```bash
grep -n "handleDeleteSlot\|handleRegenerateSlot" src/components/listing/assets/AssetsResultPanel.tsx
```
드로어 연결부 외에 참조가 없다면 두 함수를 삭제한다. 참조가 남아있으면 그대로 둔다.

- [ ] **Step 6: TypeScript 타입 에러 없음 확인**

```bash
npx tsc --noEmit 2>&1 | grep -E "AssetsResultPanel|SceneImageDrawer"
```
Expected: 출력 없음 (에러 없음)

- [ ] **Step 7: 개발 서버에서 E2E 동작 확인**

1. 이미지 업로드 → 생성 버튼 클릭
2. 생성 완료 후 씬 카드 4개 표시 확인 (메인 히어로 / 라이프스타일 / 소재·디테일 / 기능 강조)
3. 씬 카드 클릭 → 오른쪽 드로어 슬라이드인 확인
4. 드로어 안: 현재 이미지, 씬 전환 탭, 업로드 이미지 썸네일, 새 파일 첨부 버튼 표시 확인
5. 업로드 이미지 썸네일 클릭 → 해당 씬 이미지 교체 + 미리보기 즉시 갱신 확인
6. 다른 씬 탭 클릭 → 드로어가 해당 씬으로 전환 (닫히지 않음) 확인
7. ← 닫기 클릭 → 드로어 닫힘 확인
8. 상세페이지 미리보기에 Gemini 이미지가 포함된 HTML 표시 확인

- [ ] **Step 8: 커밋**

```bash
git add src/components/listing/assets/AssetsResultPanel.tsx
git commit -m "feat: AiImageSlotsPanel → 씬 카드 그리드 + SceneImageDrawer 사이드 드로어 교체"
```
