# AssetsTab 상세페이지 기능 확장 설계

## 개요

"썸네일·상세만 만들기" 탭(`AssetsTab`)에 다음 기능을 추가한다.

1. 업로드 이미지(썸네일·상세) AI 편집 — `AssetsInputPanel`
2. 섹션 이미지 AI 편집 버튼 — `SectionImageAttachment`
3. 섹션 이미지 최대 2장 제한 + 2장 나란히 렌더링
4. 미리보기 인라인 텍스트 수정
5. 미리보기 섹션별 구분 (hover 아웃라인)

---

## 1. 배경 및 현황

| 기능 | 현재 상태 |
|------|-----------|
| 썸네일 AI 편집 (AiEditModal) | ✅ AssetsResultPanel에 구현됨 |
| 썸네일 2장 합치기 (merge 모드) | ✅ AssetsResultPanel에 구현됨 |
| 상세용 업로드 이미지 AI 편집 | ✗ 없음 |
| 섹션 이미지 AI 편집 버튼 | ✗ 없음 |
| 섹션 이미지 최대 장수 | 3장 (변경 필요) |
| 섹션 이미지 2장 나란히 렌더링 | ✗ 첫 번째 1장만 렌더링 |
| 미리보기 텍스트 인라인 수정 | ✗ 정적 iframe |
| 미리보기 섹션별 구분 | ✗ 없음 |

Step3ReviewRegister는 `DetailPageEditor`에 `hidePreview` prop을 설정하므로, `DetailPageEditor` 내부 preview를 수정해도 Step3에 영향 없다.

### 임시저장·불러오기 스펙과의 관계

별도 스펙(`2026-05-10-assets-draft-save-load-design.md`)에서 `assets_drafts` 테이블과 `AssetsSaveLoad` 컴포넌트를 추가 예정. 본 설계는 해당 스펙과 스키마 변경 없이 호환된다.

- AI 편집 결과 URL은 모두 Supabase URL → `draft_data`에 그대로 저장·복원
- `detailPageSections[].attachedImages[].url`은 이미 draft_data 스키마에 포함
- `thumbnailFiles`, `detailFiles`도 이미 draft_data에 포함 → AI 편집 후 교체된 URL 자동 저장

---

## 2. 변경 파일 목록

| 파일 | 종류 |
|------|------|
| `src/lib/detail-page/section-renderer.ts` | 수정 |
| `src/components/listing/detail-editor/SectionImageAttachment.tsx` | 수정 |
| `src/components/listing/detail-editor/SectionCard.tsx` | 수정 |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | 수정 |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 수정 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 |

---

## 3. 상세 설계

### 3-1. section-renderer.ts — 2장 나란히 렌더링

`renderAttachedImage(section)` 함수 수정.

- `attachedImages.length === 0` → 빈 문자열 반환 (현행 유지)
- `attachedImages.length === 1` → 현행 방식 유지 (단일 `<img>` 100% width)
- `attachedImages.length >= 2` → 처음 2장을 flex row로 나란히 배치

```html
<!-- 2장 나란히 렌더링 출력 -->
<div style="display:flex;gap:8px;width:100%;box-sizing:border-box;">
  <img src="[url1]" alt="" style="flex:1;min-width:0;width:50%;display:block;height:auto;" />
  <img src="[url2]" alt="" style="flex:1;min-width:0;width:50%;display:block;height:auto;" />
</div>
```

---

### 3-2. SectionImageAttachment.tsx — MAX 2장 + AI 편집 버튼

**변경 사항:**

- `MAX_IMAGES` 상수: `3` → `2`
- Props에 `onAiEdit?: (imageUrl: string, index: number) => void` 추가
- 각 이미지 썸네일에 🪄 AI편집 버튼 추가 (삭제 버튼과 함께 절대 위치)
- `onAiEdit`가 없으면 버튼 미노출 (하위 호환)

```tsx
interface SectionImageAttachmentProps {
  images: AttachedImage[];
  palette: PaletteName;
  onChange: (images: AttachedImage[]) => void;
  onAiEdit?: (imageUrl: string, index: number) => void; // 신규
}
```

이미지 썸네일 내 버튼 배치:
- 우상단: 삭제(×) — 현행 유지
- 좌하단: 🪄 AI편집 버튼 (onAiEdit 있을 때만 노출)

---

### 3-3. SectionCard.tsx — onSectionImageAiEdit prop 전달

Props에 `onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void` 추가.
`SectionImageAttachment`의 `onAiEdit`에 바인딩해서 전달.

```tsx
<SectionImageAttachment
  images={section.attachedImages}
  palette={theme.palette}
  onChange={...}
  onAiEdit={onSectionImageAiEdit
    ? (url, idx) => onSectionImageAiEdit(section.id, url, idx)
    : undefined}
/>
```

---

### 3-4. DetailPageEditor.tsx — 두 가지 추가

#### ① onSectionImageAiEdit prop 추가

```tsx
export interface DetailPageEditorProps {
  // ... 기존 props
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
}
```

각 `SectionCard`에 prop 전달.

#### ② 내부 preview에 인라인 텍스트 수정 + 섹션 구분 적용

Step3ReviewRegister의 `PREVIEW_GUIDE_CSS`와 `buildEditablePreviewDocument`를 `DetailPageEditor.tsx` 내부로 이식.

- `hidePreview=false`(기본값)일 때만 적용
- `generatedHtml`이 있을 때, `buildEditablePreviewDocument(generatedHtml)`로 래핑해서 iframe에 주입
- iframe의 `postMessage` → 부모 컴포넌트에서 catch → `onSectionsChange`로 sections 업데이트

Step3와 코드가 일부 중복되지만, Step3는 `hidePreview`로 내부 preview를 비활성화하므로 충돌 없음. 향후 공통 유틸 파일로 추출 가능 (현재 범위 밖).

**섹션 구분 CSS (PREVIEW_GUIDE_CSS 동일):**
```css
[data-section-id] {
  position: relative;
  outline: 1px dashed transparent;
  outline-offset: -2px;
  transition: outline-color 120ms ease;
}
[data-section-id]:hover {
  outline-color: #7c3aed;
}
[data-section-id]:hover::before {
  content: attr(data-section-label);
  position: absolute;
  top: 8px; left: 8px; z-index: 20;
  padding: 4px 8px; border-radius: 6px;
  background: #5b21b6; color: #fff;
  font: 700 12px/1.2 system-ui, sans-serif;
}
[data-edit-path] { border-radius: 4px; cursor: text; }
[data-edit-path]:hover { box-shadow: 0 0 0 2px rgba(124,58,237,0.24); }
[data-edit-path][contenteditable="true"]:focus {
  outline: 2px solid #7c3aed;
  background: rgba(255,255,255,0.72);
}
```

---

### 3-5. AssetsResultPanel.tsx — 섹션 이미지 AI 편집 모달 연결

**추가 state:**
```tsx
const [sectionImageEditTarget, setSectionImageEditTarget] = useState<{
  sectionId: string;
  imageUrl: string;
  imageIndex: number;
} | null>(null);
```

**handleSectionImageAiEdit:**
```tsx
const handleSectionImageAiEditSaved = (resultUrl: string) => {
  if (!sectionImageEditTarget) return;
  const { sectionId, imageIndex } = sectionImageEditTarget;
  const updated = detailPageSections.map(s => {
    if (s.id !== sectionId) return s;
    const newImages = [...s.attachedImages];
    newImages[imageIndex] = { ...newImages[imageIndex], url: resultUrl };
    return { ...s, attachedImages: newImages };
  });
  updateAssetsDraft({ detailPageSections: updated });
  refreshRenderedHtml(updated, detailPageTheme);
  setSectionImageEditTarget(null);
};
```

`DetailPageEditor`에 `onSectionImageAiEdit` 전달:
```tsx
<DetailPageEditor
  ...
  onSectionImageAiEdit={(sectionId, imageUrl, imageIndex) =>
    setSectionImageEditTarget({ sectionId, imageUrl, imageIndex })
  }
/>
```

섹션 이미지 AI 편집 모달 (기존 썸네일 편집 모달과 동일 컴포넌트):
```tsx
{sectionImageEditTarget && (
  <AiEditModal
    imageUrl={sectionImageEditTarget.imageUrl}
    imageFile={null}
    onClose={() => setSectionImageEditTarget(null)}
    onSave={handleSectionImageAiEditSaved}
  />
)}
```

---

### 3-6. AssetsInputPanel.tsx — 업로드 이미지 AI 편집

**thumbnailFiles, detailFiles 각 슬롯의 이미지 썸네일에 🪄 버튼 추가.**

```tsx
const [inputImageEditTarget, setInputImageEditTarget] = useState<{
  slot: 'thumbnail' | 'detail';
  index: number;
  url: string;
} | null>(null);

const handleInputImageAiEditSaved = (resultUrl: string) => {
  if (!inputImageEditTarget) return;
  const { slot, index } = inputImageEditTarget;
  if (slot === 'thumbnail') {
    const next = [...thumbnailFiles];
    next[index] = resultUrl;
    updateAssetsDraft({ thumbnailFiles: next });
  } else {
    const next = [...detailFiles];
    next[index] = resultUrl;
    updateAssetsDraft({ detailFiles: next });
  }
  setInputImageEditTarget(null);
};
```

각 이미지 그리드에 버튼 추가 (삭제 버튼 옆):
```tsx
<button onClick={() => setInputImageEditTarget({ slot, index: i, url })}>
  🪄 AI편집
</button>
```

`AiEditModal`은 `isGenerating` 상태와 무관하게 모달을 열 수 있어야 함 (생성 중에는 버튼 비활성화).

---

## 4. 데이터 흐름

```
[AssetsInputPanel]
  업로드 이미지 썸네일
    → 🪄 AI편집 버튼
    → AiEditModal (imageUrl=Supabase URL, imageFile=null)
    → onSave(resultUrl)
    → thumbnailFiles[i] 또는 detailFiles[i] URL 교체
    → 생성 시 편집된 URL 사용

[AssetsResultPanel → DetailPageEditor → SectionCard → SectionImageAttachment]
  섹션 이미지 썸네일
    → 🪄 AI편집 버튼
    → onAiEdit(url, idx) → onSectionImageAiEdit(sectionId, url, idx) → setSectionImageEditTarget
    → AiEditModal
    → onSave(resultUrl)
    → detailPageSections[sectionId].attachedImages[idx].url 교체
    → refreshRenderedHtml()

[DetailPageEditor 내부 preview]
  섹션 hover → 보라색 아웃라인 + 섹션 레이블
  텍스트 클릭 → contenteditable=true
  텍스트 수정 후 blur → postMessage → onSectionsChange 업데이트
```

---

## 5. 에러 처리

- AI 편집 모달 오픈 후 편집 실패: AiEditModal 내부에서 에러 표시 (기존 동작 유지)
- 섹션 이미지 AI 편집 저장 실패: 모달 내 에러 표시, 기존 URL 유지
- 미리보기 텍스트 편집 → `onSectionsChange` 실패: 에러 무시, 섹션 상태는 변경 없음

---

## 6. 범위 밖

- `/detail` 페이지 (`app/detail/DetailClient.tsx`) 수정 없음 — 별도 독립 페이지
- Step3ReviewRegister 수정 없음 — `hidePreview` 사용으로 영향 없음
- `AiEditModal` 자체 수정 없음 — 기존 API 그대로 활용
- 자동 AI 편집 (배치 처리) 없음 — 사용자가 직접 버튼 클릭 시에만 동작
- 섹션 이미지 3장 이상 지원 없음 — 2장 고정
