# 썸네일·상세만 만들기 — 대화로 만들기 이미지 수정 + 미리보기 텍스트 편집

**날짜**: 2026-05-20  
**범위**: `AssetsInputPanel`, `ConversationalDetailModal`, `AssetsResultPanel`

---

## 1. 문제 요약

### 1-1. 이미지 중복 및 누락

`AssetsInputPanel`이 `ConversationalDetailModal`에 `imageUrls={[...thumbnailFiles, ...detailFiles]}`를 전달한다. 내부에서 `.slice(0, 5)` 한도가 적용되므로 썸네일 이미지가 배열 앞에 오면 상세용 이미지가 한도에서 잘린다. 결과 HTML에 썸네일 이미지가 포함되어 사용자 입장에서 "같은 사진이 중복"으로 보인다.

### 1-2. 미리보기 텍스트 편집 불가

`DetailPageEditor`는 `[data-edit-path]` 속성이 있는 요소를 `contenteditable`로 만들어 인라인 편집을 지원한다. 그런데 "대화로 만들기" 완료 시 `generatedDetailHtml`은 `buildDetailPageHtml`이 생성한 HTML로, 이 함수는 `data-edit-path`를 포함하지 않는다. 섹션 데이터는 채워지지만 미리보기 HTML이 교체되지 않아 클릭해도 편집이 되지 않는다.

---

## 2. 설계

### Feature 1 — 이미지 분리 및 6장 제한

**원칙**: 상세 HTML에 포함될 이미지는 "상세페이지용" 슬롯 이미지만 사용한다. 썸네일용 이미지는 AI가 상품을 이해하는 데 사용하지 않고, 오직 결과 썸네일로만 사용한다.

#### 변경 1: `AssetsInputPanel.tsx`

```tsx
// Before
<ConversationalDetailModal
  imageUrls={allImageUrls}   // [...thumbnailFiles, ...detailFiles]
  ...
/>

// After
<ConversationalDetailModal
  imageUrls={detailFiles}    // 상세용만
  ...
/>
```

- `canStartConversation` 조건은 `allImageUrls.length > 0`으로 유지 (썸네일만 올려도 대화 시작 가능)
- 단, 상세 이미지가 없으면 HTML에 이미지가 들어가지 않음 — 사용자가 상세용 슬롯을 비워두면 이미지 없이 텍스트 중심 상세페이지 생성됨 (기존 동작 범위)

#### 변경 2: `ConversationalDetailModal.tsx`

3곳의 `.slice(0, 5)` → `.slice(0, 6)`:

| 위치 | 용도 |
|------|------|
| `detail-page-suggest-answers` 호출 body | AI 칩 제안용 이미지 |
| `conversationContext.imageUrls` | 대화 컨텍스트 기록 |
| `generate-detail-html` 호출 body | 실제 HTML 생성용 이미지 |

---

### Feature 2 — 미리보기 인라인 텍스트 편집 활성화

#### 변경 1: `AssetsResultPanel.tsx`

`detailPageSections`가 비었다가 처음 채워질 때 자동으로 `refreshRenderedHtml()`을 호출한다.

```tsx
// 대화 완료 후 sections가 처음 채워지면 section-renderer HTML로 교체
const prevSectionsLengthRef = useRef(0);
useEffect(() => {
  if (prevSectionsLengthRef.current === 0 && detailPageSections.length > 0) {
    void refreshRenderedHtml(detailPageSections, detailPageTheme);
  }
  prevSectionsLengthRef.current = detailPageSections.length;
}, [detailPageSections]);
```

`refreshRenderedHtml`이 `/api/detail-page/render`를 호출하면 `section-renderer.ts`가 `data-edit-path` 속성을 포함한 HTML을 반환한다. 이후 `DetailPageEditor`의 `buildEditablePreviewDocument`가 이를 `contenteditable`로 변환하여 미리보기에서 텍스트를 직접 클릭해 편집할 수 있다.

---

## 3. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/listing/assets/AssetsInputPanel.tsx` | `imageUrls={allImageUrls}` → `imageUrls={detailFiles}` |
| `src/components/listing/assets/ConversationalDetailModal.tsx` | `.slice(0, 5)` → `.slice(0, 6)` × 3곳 |
| `src/components/listing/assets/AssetsResultPanel.tsx` | sections 첫 채움 시 `refreshRenderedHtml` 자동 호출 `useEffect` 추가 |

---

## 4. 영향 범위

- API 변경 없음
- 다른 탭(AI 상품 등록, 내 상품 조회)에 영향 없음
- "빠른 생성(폼)" 경로는 `ConversationalDetailModal`을 사용하지 않으므로 미영향
