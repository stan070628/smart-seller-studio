# assets 탭에 "AI 썸네일 생성" 추가 설계

> 작성일: 2026-06-12
> 상태: 설계 확정 (구현 플랜 대기)

## 1. 배경 및 목표

에디터(`src/components/editor/inspector/sections/ThumbnailGenerateSection.tsx`)에만 있던 **"AI 썸네일 생성"** 기능을 **"상품상세 자동만들기"(assets) 탭**에서도 쓸 수 있게 추가한다.

- 기존 `generate-thumbnail` API(참조 사진 1~3장 + 연출 방향 → AI 1:1 정사각형 썸네일)는 **그대로 재사용**한다. 텍스트 오버레이는 없다(프롬프트에 `no text overlays` 명시됨).
- 에디터의 `ThumbnailGenerateSection`은 `useEditorStore`(`frameImages`/`frameId`/`setFrameImage`)에 강결합돼 있어 그대로는 옮길 수 없다 → assets 탭(`useListingStore`) 맥락의 **신규 UI 컴포넌트**를 만든다.

### 확정된 결정 (브레인스토밍)
1. **기능 정의**: 기존 "AI 썸네일 생성"을 assets 탭에 추가 (텍스트 오버레이 없음 — 기존 기능 그대로).
2. **노출 방식**: 좌측 `AssetsInputPanel` 하단에 "AI 썸네일 생성" 섹션 추가.
3. **API 개선**: 클라이언트 base64 변환을 없애고, 서버가 URL을 fetch하는 멀티참조 패턴(`loadReferenceImages`)과 일관되게 `refImageUrls` 입력을 추가한다.

---

## 2. 아키텍처

### 데이터 흐름
```
[assets 탭: 업로드/크롤링한 이미지 URL 배열]
   │ 참조 URL 수집 (최대 3장)
   ▼
POST /api/ai/generate-thumbnail { refImageUrls, direction }
   │ 서버: loadReferenceImages(refImageUrls) → fetch + Sharp 정규화 + base64
   │ Gemini 2.5 Flash Image: 참조 inlineData N개 + 썸네일 프롬프트
   ▼
응답 { imageBase64, mimeType }
   │ POST /api/image/upload-ai → Supabase 영속화 (URL화)
   ▼
generatedThumbnails 배열에 append (updateAssetsDraft)
   ▼
기존 AssetsResultPanel이 썸네일 그리드에 자동 표시 (다운로드/삭제 기존 기능)
```

### 참조 이미지 소스 (최대 3장)
- 업로드 모드: `thumbnailFiles` 우선, 비어있으면 `detailFiles`
- URL 모드: 크롤링된 `generatedThumbnails`

---

## 3. 파일별 변경

### 3-1. `src/app/api/ai/generate-thumbnail/route.ts` (수정)

`RequestSchema`에 `refImageUrls`를 추가하고, 기존 `refImages`(base64)는 하위호환으로 유지한다. 서버에서 `loadReferenceImages`로 정규화한 뒤 Gemini parts를 구성한다.

- `refImages`: 기존대로 `Array<{ imageBase64, mimeType }>` (min 1 제거 — 아래 참조), 에디터 호출 하위호환.
- `refImageUrls`: 신규 `z.array(z.string().url()).max(3).optional()`.
- 검증 규칙: `refImages`와 `refImageUrls` **둘 다 비어있으면 400** ("참조 사진이 최소 1장 필요합니다"). 둘 중 하나라도 있으면 통과.
- 정규화: `loadReferenceImages({ referenceImages: refImages?.map(r => ({ base64: r.imageBase64, mimeType: r.mimeType })), productImageUrls: refImageUrls })` → `ReferenceImage[]`. 결과가 0장이면 **400**("참조 사진을 불러오지 못했습니다") 처리.
- `loadReferenceImages` 호출은 라우트의 `try {}` 블록 **안**에 둔다(throw 시 JSON 에러 응답 보장 — 멀티참조 작업의 최종 리뷰 교훈).
- `direction`은 기존대로 `z.string().min(5).max(300)`.
- Gemini parts: 정규화된 참조들을 `inlineData`로 push 후 기존 썸네일 프롬프트 text push (기존 로직 유지).

> 주의: 기존 `refImages`의 `.min(1)`은 스키마에서 제거하고 `.optional()`로 바꾼다. "최소 1장" 검증은 두 소스를 합산해 라우트 로직에서 수행한다.

### 3-2. `src/components/listing/assets/ThumbnailGeneratePanel.tsx` (신규)

`ThumbnailGenerateSection`의 UI 패턴을 `useListingStore` 맥락으로 재작성한 신규 컴포넌트.

- `useListingStore`에서 `assetsDraft`(`mode`, `thumbnailFiles`, `detailFiles`, `generatedThumbnails`)와 `updateAssetsDraft` 사용.
- 로컬 `useState`: `direction`, `isLoading`, `error` (상세 생성의 `isGenerating`과 독립).
- 참조 URL 계산 (최대 3):
  ```
  mode === 'url'
    ? generatedThumbnails.slice(0, 3)
    : (thumbnailFiles.length > 0 ? thumbnailFiles : detailFiles).slice(0, 3)
  ```
- UI 요소:
  - 참조 상태 표시 ("참조 N장 준비됨" / "이미지를 먼저 업로드하세요")
  - 연출 방향 `textarea` + 예시 태그(화이트 스튜디오 배경 / 자연광 라이프스타일 / 1·2번 합성 / 그라데이션 클로즈업)
  - "AI 썸네일 생성" 버튼 — 참조 0장이거나 방향 5자 미만이면 비활성
  - 로딩/완료/에러 상태 표시
- 생성 핸들러:
  1. `POST /api/ai/generate-thumbnail { refImageUrls, direction }`
  2. 응답 base64 → `POST /api/image/upload-ai { imageBase64, mimeType, role: 'thumbnail' }`
  3. 반환 URL을 `updateAssetsDraft({ generatedThumbnails: [...generatedThumbnails, newUrl] })`
  4. 실패(429/503/500) 시 `error` 표시.

### 3-3. `src/components/listing/assets/AssetsInputPanel.tsx` (수정)

`ThumbnailGeneratePanel`을 import해 패널 하단(상세 생성 버튼 영역 아래)에 렌더한다. Props 변경 없음(컴포넌트 자체가 store에서 상태를 읽음).

---

## 4. 테스트 (TDD)

### `src/__tests__/api/generate-thumbnail.test.ts` (신규/수정)
- `refImageUrls` 전달 시 `loadReferenceImages`가 호출되고 Gemini parts에 inlineData가 N개 들어간다 (loader/Gemini mock).
- 기존 `refImages`(base64) 경로 회귀: 여전히 200.
- `refImages`·`refImageUrls` 둘 다 없으면 400.
- `direction` 5자 미만이면 400.
- 정규화 결과 0장(모든 URL fetch 실패)이면 에러 응답.

### `ThumbnailGeneratePanel`
- assets 탭은 UI 단위 테스트가 없는 패턴(`AssetsTab`/`AssetsInputPanel` 동일) → `npx tsc --noEmit`로 타입 검증.

---

## 5. 엣지 케이스

| 항목 | 처리 |
|---|---|
| 참조 0장 | 버튼 비활성 + 안내 메시지 (API의 min 1과 일치) |
| 연출 방향 5자 미만 | 버튼 비활성 (API가 400) |
| 생성 실패(429/503/500) | 패널 내 에러 메시지 |
| 참조 4장 이상 | 클라이언트 `.slice(0,3)` + API `max(3)` + loader cap |
| upload-ai 실패 | 에러 표시, generatedThumbnails 미변경 |

---

## 6. 변경 대상 파일 요약

| 파일 | 유형 |
|---|---|
| `src/app/api/ai/generate-thumbnail/route.ts` | 수정 — `refImageUrls` + `loadReferenceImages` |
| `src/components/listing/assets/ThumbnailGeneratePanel.tsx` | 신규 — 생성 UI |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 수정 — 패널 렌더 |
| `src/__tests__/api/generate-thumbnail.test.ts` | 신규/수정 |
