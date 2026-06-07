# Gemini 씬 합성 파이프라인 설계

## 개요

상품상세 이미지를 분석해 섹션별 제품 크롭을 추출하고, 배경 제거 → Gemini 배경 씬 생성 → Sharp 합성의 3단계로 "제품 원본 픽셀 + AI 배경" 합성 이미지를 만드는 파이프라인. 텍스트는 이미지가 아닌 HTML CSS 오버레이로 추가한다.

---

## 문제 정의

### 현재 문제
1. `generate-frame-image`에 `productImageBase64`를 Gemini 참조로 전달하면 Gemini가 제품을 재해석/변형하거나 소스 이미지를 그대로 반환함
2. `buildAiDetailPageHtml`이 정적 HTML만 생성 — 섹션 네비게이션, 클릭 활성화 등 기존 인터랙션 없음
3. 긴 상품상세 이미지에서 개별 제품 씬을 추출하는 기능 없음

### 목표
- 제품 픽셀을 원본 그대로 보존하면서 Gemini가 섹션별 배경 씬을 생성
- 긴 상품상세 이미지와 개별 씬 이미지 모두 지원
- 사용자가 추출된 씬을 검토하고 조정할 수 있는 검토 단계 포함

---

## 아키텍처

### 전체 파이프라인 (5단계)

```
[1] 이미지 분석
  POST /api/image/analyze-detail-images
  · Claude Vision으로 각 이미지 검사
  · 긴 이미지 감지 (height > 2.5× width) → 유용 영역 자동 크롭 제안
  · 개별 이미지 → 섹션 타입 자동 분류 (hero / lifestyle / detail / feature)
  · Sharp로 크롭 실행 → Supabase Storage 업로드 → croppedImageUrl 반환
  · 반환: { crops: CropItem[] }

[2] 사용자 검토 UI
  · 추출된 크롭 썸네일 + 섹션 타입 표시
  · 섹션 타입 변경, 크롭 제외, 대체 이미지 업로드 가능
  · "확인" 클릭 → confirmedCrops 확정

[3] 배경 제거
  POST /api/image/remove-background
  · Stability AI remove-background API 호출
  · 반환: { transparentPngBase64, mimeType: 'image/png' }

[4] Gemini 배경 씬 생성
  POST /api/ai/generate-frame-image (수정)
  · productImageBase64 파라미터 제거
  · 텍스트 프롬프트만으로 배경 씬 생성 (제품 없이 순수 배경)
  · 섹션 타입별 씬 스타일 프롬프트 적용

[5] Sharp 합성
  POST /api/image/composite
  · 투명 PNG 제품 + Gemini 배경 → Sharp 레이어 합성
  · 제품 크기: 배경 높이의 68%, south gravity
  · Supabase Storage 업로드 → 최종 URL 반환
```

### 클라이언트 오케스트레이션 흐름

```typescript
// 1단계: 분석
const { crops } = await analyzeDetailImages(imageUrls)
setPendingCrops(crops)  // → 검토 패널 렌더

// 2단계: 사용자 검토 후 확인
const confirmedCrops = await userReviewStep()

// 3~5단계: 병렬 처리
const slots = await Promise.allSettled(
  confirmedCrops.map(async (crop) => {
    const [bgResult, sceneResult] = await Promise.allSettled([
      removeBackground(crop.croppedImageUrl),
      generateFrameImage(sectionPrompt(crop.sectionType)),
    ])
    const url = await composite(bgResult, sceneResult)
    return { role: crop.sectionType, url, prompt: ... }
  })
)
```

---

## 신규 API 설계

### `POST /api/image/analyze-detail-images`

**Request:**
```typescript
{ imageUrls: string[] }
```

**Response:**
```typescript
{
  crops: Array<{
    id: string
    originalImageUrl: string
    cropBox?: { x: number; y: number; width: number; height: number }
    sectionType: 'hero' | 'lifestyle' | 'detail' | 'feature'
    croppedImageUrl: string
  }>
}
```

**내부 동작:**
1. 각 이미지 width/height 비율 계산
2. height > 2.5 × width → "긴 이미지" 판정 → Claude Vision으로 유용 영역 좌표 + 섹션 타입 추출
3. 그 외 → Claude Vision으로 섹션 타입 분류만 수행 (전체 이미지 사용)
4. Sharp로 크롭 실행 → Supabase Storage 업로드
5. 이미지 4장 미만 시 섹션 채우기 규칙 적용 (아래 참고)

**Claude Vision 프롬프트 (긴 이미지용):**
```
이 상품상세 이미지에서 히어로(대표 제품), 라이프스타일(생활 연출),
디테일(소재/클로즈업), 특징(기능 강조) 섹션에 쓸 수 있는 영역을
JSON으로 반환하세요. { sectionType, cropBox: { x, y, width, height } }
```

---

### `POST /api/image/remove-background`

**Request:**
```typescript
{ imageUrl: string }
```

**Response:**
```typescript
{ transparentPngBase64: string; mimeType: 'image/png' }
```

**내부 동작:** Stability AI `/v2beta/stable-image/edit/remove-background` 호출 (기존 연동 활용)

---

### `POST /api/image/composite`

**Request:**
```typescript
{
  productPngBase64: string
  backgroundBase64: string
  backgroundMimeType: string
  placement?: 'center' | 'bottom-center'  // 기본값: 'bottom-center'
}
```

**Response:**
```typescript
{ url: string }  // Supabase Storage URL
```

**내부 동작 (Sharp):**
```typescript
const bg = sharp(Buffer.from(backgroundBase64, 'base64'))
  .resize(1024, 1024, { fit: 'cover' })

const product = await sharp(Buffer.from(productPngBase64, 'base64'))
  .resize({ height: Math.round(1024 * 0.68), fit: 'contain' })
  .toBuffer()

const result = await bg.composite([{
  input: product,
  gravity: placement === 'bottom-center' ? 'south' : 'center',
}]).toBuffer()
```

---

### `POST /api/ai/generate-frame-image` (수정)

**변경 사항:**
- `productImageBase64`, `productImageMimeType` 파라미터 제거
- Gemini 호출 시 참조 이미지 없이 텍스트 프롬프트만 전달
- 배경 씬 전용 프롬프트 스타일로 system prompt 수정

**섹션별 배경 씬 프롬프트 스타일:**
```
hero:      드라마틱한 단색 그라데이션 배경, 스튜디오 조명, 제품 공간 여백
lifestyle: 자연스러운 생활 공간 (테이블, 선반, 창가), 따뜻한 조명
detail:    미니멀 배경, 소재감 강조, 클로즈업 분위기
feature:   추상적 패턴 또는 기능을 연상시키는 아이코닉 배경
```

---

## 사용자 검토 UI

### 상태 변화

```
isGenerating: false → [분석 버튼 클릭] → isAnalyzing: true
  → pendingCrops: CropItem[]  → 검토 패널 표시
  → [확인 클릭] → confirmedCrops: CropItem[]
  → isGenerating: true → 씬 생성 시작
```

### 검토 패널 레이아웃

```
┌─────────────────────────────────────────────────────┐
│  씬 이미지 검토                                      │
├──────────┬──────────┬──────────┬────────────────────┤
│  [크롭]  │  [크롭]  │  [크롭]  │      [크롭]        │
│  히어로  │라이프스타일│  디테일  │      특징          │
│  [타입▼] │  [타입▼] │  [타입▼] │     [타입▼]       │
│  🗑️ 제외 │  🗑️ 제외 │  🗑️ 제외 │     🗑️ 제외       │
├──────────┴──────────┴──────────┴────────────────────┤
│                              [확인 — AI 씬 생성 시작] │
└─────────────────────────────────────────────────────┘
```

**"✏️ 변경" 기능:** 해당 슬롯을 클릭하면 다른 이미지 직접 업로드 가능

### 상태 추가 (`useListingStore`)

```typescript
pendingCrops: CropItem[] | null    // 분석 완료 후 검토 대기
confirmedCrops: CropItem[] | null  // 사용자 확인 완료
isAnalyzing: boolean               // 이미지 분석 중

interface CropItem {
  id: string
  originalImageUrl: string
  cropBox?: { x: number; y: number; width: number; height: number }
  sectionType: 'hero' | 'lifestyle' | 'detail' | 'feature'
  croppedImageUrl: string
}
```

---

## 이미지 수량별 섹션 채우기 규칙

| 업로드 수 | hero | lifestyle | detail | feature |
|----------|------|-----------|--------|---------|
| 4장 이상 | 이미지1 | 이미지2 | 이미지3 | 이미지4 |
| 3장 | 이미지1 | 이미지2 | 이미지3 | 이미지1 재사용 |
| 2장 | 이미지1 | 이미지2 | 이미지1 재사용 | 이미지2 재사용 |
| 1장 | 이미지1 | 이미지1 | 이미지1 | 이미지1 |

**4장 미만 재사용 시:** 동일 투명 PNG를 사용하되 Gemini는 섹션별 다른 배경 씬 생성 → 같은 제품, 다른 분위기의 씬 4개 완성

---

## HTML 텍스트 오버레이

이미지에 텍스트를 직접 합성하지 않고 `buildAiDetailPageHtml`에서 CSS 오버레이로 추가.

### 섹션별 텍스트 매핑 (DetailPageContent 활용)

| 섹션 | 텍스트 소스 | 위치 | 스타일 |
|------|-----------|------|--------|
| hero | `content.headline` + `content.subheadline` | 이미지 하단 그라데이션 오버레이 | 흰색 대형 타이틀 |
| lifestyle | `content.sellingPoints[0]` | 이미지 좌측 반투명 패널 | 중간 크기 |
| detail | `content.sellingPoints[1]` | 이미지 우측 반투명 패널 | 중간 크기 |
| feature | `content.features` 목록 | 이미지 하단 태그 형태 | 소형 뱃지 |

---

## 에러 처리

| 실패 단계 | 처리 방식 |
|---------|---------|
| Claude Vision 분석 실패 | 폴백: 이미지를 섹션에 순서대로 1:1 매핑, 사용자가 검토에서 조정 |
| 배경 제거 실패 | 원본 크롭 이미지(배경 포함) 사용 진행, UI에 ⚠️ 경고 표시 |
| Gemini 씬 생성 실패 | 해당 슬롯 비움 → buildAiDetailPageHtml graceful fallback (텍스트만) |
| 합성 실패 | 배경 제거된 투명 PNG를 URL로 직접 사용 |

모든 섹션 처리는 `Promise.allSettled` — 1개 실패해도 나머지 완성

---

## 기존 코드 변경 영향

| 파일 | 변경 내용 |
|-----|---------|
| `src/app/api/ai/generate-frame-image/route.ts` | `productImageBase64` 파라미터 제거, 배경 전용 프롬프트 |
| `src/app/api/ai/generate-detail-html/route.ts` | 변경 없음 (imagePrompts 생성 로직 유지) |
| `src/lib/detail-page/ai-html-builder.ts` | 섹션별 CSS 텍스트 오버레이 추가 |
| `src/components/listing/assets/AssetsTab.tsx` | runGeminiImageGeneration 교체, 검토 패널 연동 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 분석 버튼 추가 |
| `src/store/useListingStore.ts` | pendingCrops, confirmedCrops, isAnalyzing 상태 추가 |
| `src/app/api/image/analyze-detail-images/route.ts` | 신규 |
| `src/app/api/image/remove-background/route.ts` | 신규 |
| `src/app/api/image/composite/route.ts` | 신규 |

---

## 별도 처리: HTML 인터랙션 회귀

다음 기능은 이 스펙과 별도로 `/investigate`로 조사 후 수정:
- HTML 미리보기 내부 섹션 탭 클릭 → 스크롤/강조
- AssetsResultPanel 사이드바 ↔ 미리보기 섹션 연동
- 섹션 카드 클릭 → 편집 인터페이스

---

## 검증 시나리오

1. 긴 상품상세 이미지 1장 업로드 → 분석 → 4개 크롭 제안 → 검토 UI 확인
2. 개별 이미지 4장 업로드 → 분석 → 섹션 자동 분류 → 확인 → 4개 합성 이미지 생성
3. 이미지 2장 업로드 → 4개 섹션 채우기 (재사용) → 섹션별 다른 Gemini 배경 확인
4. 배경 제거 실패 케이스 → 경고 표시 + 원본 크롭으로 진행 확인
5. 최종 HTML: 각 섹션 이미지 위에 CSS 텍스트 오버레이 표시 확인
