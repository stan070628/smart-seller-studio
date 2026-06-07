# 씬 이미지 생성 — HTML 제거 + 섹션 소스 통합 설계

## 배경

씬 이미지를 생성할 때 HTML을 새로 만들어버리는 버그가 지속 발생.
세 진입점(`handleConfirmCrops`, `handleGenerate`, `generateDetailPageFromPicked`) 모두에서
`buildAiDetailPageHtml` / `appendPrivacyFooter`가 불필요하게 호출되어 기존 상세페이지 HTML을 덮어씀.

## 결정

**HTML 생성을 씬 이미지 플로우에서 완전 제거.**
씬 이미지 4장을 생성해 `assetsDraft.aiImageSlots`에 저장하는 것으로 끝.
사용자가 섹션 편집 창에서 직접 원하는 이미지를 선택해 각 섹션에 붙임.

## 변경 파일

### 1. `src/components/listing/assets/AssetsTab.tsx`

#### `handleConfirmCrops`
- 씬 이미지 생성 후 `buildAiDetailPageHtml` / `appendPrivacyFooter` 호출 제거
- `aiSlots`를 `updateAssetsDraft({ aiImageSlots: aiSlots })`로 저장하고 종료

#### `handleGenerate`
- URL 모드 / 업로드 모드 양쪽에서 `buildAiDetailPageHtml` / `appendPrivacyFooter` 호출 제거
- 씬 이미지 생성 후 `aiSlots`를 store에 저장하고 종료

### 2. `src/store/useListingStore.ts`

#### `generateDetailPageFromPicked`
- 기존 `detailPageSections` + `aiDetailContent`가 있는 경로(line ~1332): `buildAiDetailPageHtml` 호출 제거
- 씬 이미지를 `aiImageSlots`에 저장 후 `detailPageStatus: 'done'`으로 설정하고 종료

### 3. `src/components/listing/detail-editor/SectionImageAttachment.tsx`

#### props 추가
```typescript
aiImageSlots?: AiImageSlot[]
```

#### UI 추가
- 기존 소스 이미지 목록 위에 "AI 생성 이미지" 섹션 추가
- `aiImageSlots`가 있을 때만 렌더링
- 각 슬롯 이미지 클릭 → `onChange([...images, { url: slot.url, order: images.length, processingMode: 'none' }])`

#### 호출 측 수정
`SectionImageAttachment`를 사용하는 상위 컴포넌트에서 `aiImageSlots={assetsDraft.aiImageSlots}` 전달

## 데이터 흐름

```
씬 이미지 생성 버튼 클릭
→ /api/ai/generate-scene-image × 4 (hero/lifestyle/detail/feature)
→ assetsDraft.aiImageSlots 에 저장
→ (HTML 생성 없음)

섹션 편집 창 열기
→ SectionImageAttachment 렌더
→ "AI 생성 이미지" 섹션에 aiImageSlots 4장 표시
→ 사용자가 원하는 이미지 클릭
→ 해당 섹션 attachedImages에 추가
```

## 범위 밖

- 기존 "AI와 함께 만들기" 전체 플로우(HTML 생성 자체)는 건드리지 않음
- HTML 생성 로직(`buildAiDetailPageHtml`, `appendPrivacyFooter`) 자체는 삭제하지 않음 — 씬 이미지 생성 경로에서만 호출 제거
