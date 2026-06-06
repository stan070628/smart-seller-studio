# Gemini 씬별 이미지 생성 & 사이드 드로어 교체 설계

## Goal

상세페이지 생성 시 사용자가 업로드한 이미지를 참고해 Gemini가 씬별로 새 이미지를 자동 생성하고, 결과 화면의 사이드 드로어에서 씬별 이미지를 기존 업로드 이미지 또는 새 파일로 교체할 수 있다. 원본 이미지를 그대로 상세페이지에 노출하지 않아 저작권 문제를 방지한다.

## Architecture

기존 `AiImageSlotsPanel`(인라인 교체 UI)을 씬 카드 그리드 + 사이드 드로어 방식으로 교체한다. 드로어는 `position: fixed` 오버레이 없이 미리보기와 나란히 표시되며, 내부에서 기존 업로드 이미지 썸네일 선택 또는 새 파일 첨부로 즉시 교체가 가능하다.

## Tech Stack

- React (Next.js 16 App Router)
- Zustand (`useListingStore` — `aiImageSlots`, `aiDetailContent`, `generatedThumbnails`, `generatedDetailHtml`)
- Gemini 2.5 Flash Image (`/api/ai/generate-frame-image`)
- `/api/image/upload-ai` — 교체 이미지 Supabase 업로드
- `buildAiDetailPageHtml` — 슬롯 교체 후 HTML 재빌드

---

## 전체 흐름

```
1. 이미지 업로드 → 생성 버튼 클릭
2. Claude: 상세페이지 구조(content) 생성 → imagePrompts(4개) 생성
3. Gemini: 씬별 이미지 4개 병렬 생성 → Supabase 업로드 → aiImageSlots 저장
4. buildAiDetailPageHtml(content, aiSlots) → generatedDetailHtml 저장
5. 결과 화면: 상세페이지 미리보기 + 씬별 이미지 카드 패널 표시
6. 씬 카드 클릭 → 사이드 드로어 슬라이드인
7. 드로어: 기존 업로드 이미지 선택 OR 새 파일 첨부 → 즉시 교체 + 미리보기 갱신
```

---

## 파일 구조

| 파일 | 변경 | 역할 |
|------|------|------|
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 | `AiImageSlotsPanel` 제거, `SceneImagePanel` + `SceneImageDrawer` 통합 |
| `src/components/listing/assets/SceneImageDrawer.tsx` | 신규 | 사이드 드로어 컴포넌트 |
| `src/components/listing/assets/AssetsTab.tsx` | 수정 | 버그 수정: `refreshRenderedHtml` 자동 덮어쓰기, imagePrompts 디버그 로그 |

---

## Task 1: 버그 수정 — Gemini 이미지 미표시 문제

기존에 생성된 Gemini 이미지가 미리보기에 표시되지 않는 버그를 먼저 수정한다. 드로어 구현 전 이 버그가 수정돼야 한다.

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx:193-199`
- Modify: `src/components/listing/assets/AssetsTab.tsx:194-206`

**근본 원인:**
`detailPageSections`가 처음 채워질 때 `useEffect`가 `/api/detail-page/render`를 자동 호출해 AI 이미지가 포함된 `generatedDetailHtml`을 덮어쓴다. 현재 `aiImageSlots.length === 0` 조건이 있으나, Gemini 생성이 아예 실행되지 않는 경우(`includeAiImages=false` 또는 `result.imagePrompts=undefined`) 조건을 통과해 덮어쓴다.

**수정: `AssetsResultPanel.tsx` useEffect**

변경 전:
```typescript
if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0 && aiImageSlots.length === 0) {
  void refreshRenderedHtml(detailPageSections, detailPageTheme);
}
```

변경 후:
```typescript
// aiDetailContent가 있으면 AI HTML을 직접 빌드했으므로 render API 자동 호출 불필요
if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0 && !aiDetailContent) {
  void refreshRenderedHtml(detailPageSections, detailPageTheme);
}
```

**수정: `AssetsTab.tsx` — `includeAiImages` 기본값 활성화**

`useListingStore.ts`의 `includeAiImages: false` → `includeAiImages: true`로 변경해 기본으로 Gemini 이미지 생성을 활성화한다.

---

## Task 2: SceneImageDrawer 컴포넌트 신규 작성

**Files:**
- Create: `src/components/listing/assets/SceneImageDrawer.tsx`

**Props:**
```typescript
interface SceneImageDrawerProps {
  slots: AiImageSlot[];
  activeIndex: number | null;           // 현재 열린 씬 인덱스
  uploadedImages: string[];             // generatedThumbnails + detailFiles URL 배열
  onReplace: (index: number, newUrl: string, isReplaced: boolean) => void;
  onClose: () => void;
  onSelectScene: (index: number) => void; // 다른 씬 카드 클릭 시 전환
}
```

**드로어 레이아웃:**

```
position: fixed; right: 0; top: 0; height: 100vh; width: 380px;
z-index: 50; background: #fff; border-left: 1px solid #e5e7eb;
box-shadow: -4px 0 16px rgba(0,0,0,0.08);
```

**드로어 내부 구성 (위→아래):**

```
┌─────────────────────────────┐
│ [← 닫기]  라이프스타일 씬  │  헤더 (씬 이름 표시)
├─────────────────────────────┤
│  현재 이미지 (object-fit:   │  200px 높이, 현재 씬 URL
│  cover, 전체 폭)           │
├─────────────────────────────┤
│  내 업로드 이미지           │  섹션 라벨
│  [img][img][img]           │  3열 그리드, 각 80×80
│  [img][img][img]           │  클릭 즉시 교체 + 드로어 닫힘
├─────────────────────────────┤
│  ── 또는 ──                │  구분선
├─────────────────────────────┤
│  [+ 새 파일 첨부]           │  input[type=file] trigger
└─────────────────────────────┘
```

**씬 전환:** 다른 씬 카드를 클릭하면 드로어가 닫히지 않고 `activeIndex`만 변경되어 해당 씬으로 전환.

**파일 첨부 처리:**
```typescript
// 파일 선택 시 /api/image/upload-ai 업로드 후 onReplace 호출
const handleFileSelect = async (file: File) => {
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await fetch('/api/image/upload-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: reader.result,
        mimeType: file.type,
        role: slots[activeIndex].role,
      }),
    });
    const data = await res.json();
    if (data.success && data.url) {
      onReplace(activeIndex, data.url, true);
      onClose();
    }
  };
  reader.readAsDataURL(file);
};
```

**기존 이미지 선택 처리:**
```typescript
// 업로드된 이미지 클릭 시 직접 URL을 onReplace에 전달 (업로드 없이)
const handleUploadedImageSelect = (url: string) => {
  onReplace(activeIndex, url, true);
  onClose();
};
```

---

## Task 3: AssetsResultPanel — 씬 카드 패널 + 드로어 통합

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx`

**변경 사항:**

1. `AiImageSlotsPanel` 컴포넌트 제거
2. 씬 카드 그리드 추가 (기존 `AiImageSlotsPanel` 위치)
3. `SceneImageDrawer` import 및 연결
4. `activeDrawerIndex` state 추가

**씬 카드 그리드:**
```typescript
// aiImageSlots.length > 0 일 때만 렌더
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '12px' }}>
  {aiImageSlots.map((slot, idx) => (
    <div
      key={slot.role}
      onClick={() => setActiveDrawerIndex(idx)}
      style={{
        cursor: 'pointer',
        borderRadius: '8px',
        overflow: 'hidden',
        border: activeDrawerIndex === idx ? '2px solid #7c3aed' : '2px solid transparent',
        position: 'relative',
      }}
    >
      <img src={slot.url} alt={ROLE_LABELS[slot.role]} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
      <div style={{ padding: '4px 6px', fontSize: '11px', fontWeight: 600, color: '#374151', backgroundColor: '#f9fafb' }}>
        {ROLE_LABELS[slot.role]}
        {slot.isReplaced && <span style={{ color: '#16a34a', marginLeft: '4px' }}>✓</span>}
      </div>
    </div>
  ))}
</div>

{/* 드로어 */}
{activeDrawerIndex !== null && (
  <SceneImageDrawer
    slots={aiImageSlots}
    activeIndex={activeDrawerIndex}
    uploadedImages={[...generatedThumbnails]}
    onReplace={handleReplaceSlot}
    onClose={() => setActiveDrawerIndex(null)}
    onSelectScene={setActiveDrawerIndex}
  />
)}
```

**`handleReplaceSlot` 유지**: 기존 로직 그대로 — 슬롯 교체 후 `buildAiDetailPageHtml(aiDetailContent, newSlots)`로 HTML 재빌드.

---

## 버그 수정 보완: `includeAiImages` 기본 활성화

**Files:**
- Modify: `src/store/useListingStore.ts`

```typescript
// 변경 전
includeAiImages: false,

// 변경 후
includeAiImages: true,
```

사용자가 기본으로 Gemini 이미지 생성을 사용하도록 기본값을 변경한다. 원하지 않으면 체크박스를 끌 수 있다.

---

## 검증

1. 이미지를 업로드하고 생성 버튼 클릭
2. 브라우저 콘솔에서 `[AssetsTab] includeAiImages=true, imagePrompts=4개` 확인
3. 상세페이지 미리보기에 Gemini 이미지 4개 포함 확인
4. 씬 카드 클릭 → 드로어 슬라이드인
5. 기존 업로드 이미지 썸네일 클릭 → 해당 씬 교체 + 미리보기 즉시 갱신
6. 새 파일 첨부 → 업로드 후 해당 씬 교체 + 미리보기 갱신
7. 다른 씬 카드 클릭 → 드로어가 해당 씬으로 전환 (닫히지 않음)
8. ESC 또는 닫기 버튼 → 드로어 닫힘
