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
  · Stability AI remove-background API 호출 (신규 연동 — 기존 erase와 다름)
  · 반환: { success: true; data: { transparentImageUrl: string } }
  · 재사용 이미지는 dedupe: 동일 originalImageUrl이면 1회만 호출

[4] Gemini 배경 씬 생성
  POST /api/ai/generate-frame-image (수정)
  · 합성 경로에서는 productImageBase64를 전송하지 않음 (기존 optional 유지)
  · imagen.ts 변경 불필요 — 이미 텍스트-온리 호출 지원
  · 섹션 타입별 씬 스타일 프롬프트 적용

[5] Sharp 합성
  POST /api/image/composite
  · 투명 PNG 제품 URL + Gemini 배경 URL → Sharp 레이어 합성
  · URL 기반 입력 — base64 왕복 없음 (Vercel 4.5MB 바디 제한 회피)
  · Supabase Storage 업로드 → 최종 URL 반환
```

### 클라이언트 오케스트레이션 흐름

```typescript
// 1단계: 분석
const { crops } = await analyzeDetailImages(imageUrls)
updateAssetsDraft({ pendingCrops: crops })  // → 검토 패널 렌더

// 2단계: 사용자 검토 후 확인
// confirmedCrops는 사용자가 "확인" 클릭 시 updateAssetsDraft로 설정

// 3~5단계: 중복 이미지 dedupe 후 병렬 처리
const uniqueUrls = [...new Set(confirmedCrops.map(c => c.originalImageUrl))]
const bgMap = Object.fromEntries(
  await Promise.all(uniqueUrls.map(async url => [url, await removeBackground(url)]))
)

const slots = await Promise.allSettled(
  confirmedCrops.map(async (crop) => {
    const transparentImageUrl = bgMap[crop.originalImageUrl]
    const sceneUrl = await generateFrameImage(sectionPrompt(crop.sectionType))
    const { url } = await composite({ productImageUrl: transparentImageUrl, backgroundImageUrl: sceneUrl })
    return { role: crop.sectionType, url, prompt: sectionPrompt(crop.sectionType) }
  })
)
```

---

## 신규 API 설계

모든 신규 라우트에 `export const maxDuration = 60` 필수.
에러 응답은 기존 패턴 통일: `{ success: false; error: string }` + 적절한 HTTP 상태코드.

---

### `POST /api/image/analyze-detail-images`

`export const maxDuration = 60`

**Request:**
```typescript
{ imageUrls: string[] }
```

**Response:**
```typescript
{
  success: true
  crops: CropItem[]
}
```

**내부 동작:**
1. 각 이미지 fetch → Sharp로 metadata 읽어 width/height 확인
2. height > 2.5 × width → "긴 이미지" 판정 → Claude Vision으로 유용 영역 좌표(정규화 0~1) + 섹션 타입 추출
3. 그 외 → Claude Vision으로 섹션 타입 분류만 수행 (전체 이미지 사용, cropBox 없음)
4. cropBox 검증: 정규화 좌표 clamp(0,1), 최소 크기 0.1×0.1 이하면 전체 이미지로 fallback
5. 실제 픽셀 좌표 환산: `x = Math.round(cropBox.x * imgWidth)` 등
6. Sharp `.extract({ left, top, width, height })` → Supabase Storage 업로드
7. 이미지 4장 미만 시 섹션 채우기 규칙 적용 (아래 참고)

**cropBox 좌표계:** 0~1 정규화 (Claude Vision 반환값 그대로). 서버에서 픽셀 환산 + clamp 처리.

**Claude Vision 프롬프트 (긴 이미지용):**
```
이 상품상세 이미지에서 히어로(대표 제품), 라이프스타일(생활 연출),
디테일(소재/클로즈업), 특징(기능 강조) 섹션에 쓸 수 있는 영역을
JSON으로 반환하세요.
{
  "crops": [
    { "sectionType": "hero"|"lifestyle"|"detail"|"feature",
      "cropBox": { "x": 0~1, "y": 0~1, "width": 0~1, "height": 0~1 } }
  ]
}
좌표는 이미지 전체 크기 대비 0~1 비율로 반환하세요.
```

**Rate limit:** 분당 5회 (Claude Vision 호출 비용 고려)

---

### `POST /api/image/remove-background`

`export const maxDuration = 60`

**⚠️ 신규 Stability AI API 연동 필요** — 기존 `erase`(워터마크 인페인팅)와 다른 엔드포인트.

**Request:**
```typescript
{ imageUrl: string }
```

**Response:**
```typescript
{ success: true; data: { transparentImageUrl: string } }
// 에러: { success: false; error: string }
```

**내부 동작:**
```typescript
// 기존 watermark-removal.ts의 FormData/AbortSignal 패턴 재사용
const formData = new FormData()
const imageBuffer = await fetch(imageUrl).then(r => r.arrayBuffer())
formData.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'image.png')
formData.append('output_format', 'png')

const res = await fetch('https://api.stability.ai/v2beta/stable-image/edit/remove-background', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
    Accept: 'image/*',
  },
  body: formData,
  signal: AbortSignal.timeout(30_000),
})
// PNG 바이너리 반환 → Supabase Storage 업로드 → URL 반환
```

**Rate limit:** 분당 10회

---

### `POST /api/image/composite`

`export const maxDuration = 60`

**Request:**
```typescript
{
  productImageUrl: string      // 투명 PNG URL (remove-background 결과)
  backgroundImageUrl: string   // Gemini 배경 URL
  placement?: 'center' | 'bottom-center'  // 기본값: 'bottom-center'
}
```

**Response:**
```typescript
{ success: true; data: { url: string } }
// 에러: { success: false; error: string }
```

**내부 동작 (Sharp):**
```typescript
// URL 기반 입력으로 base64 왕복 없음
const [bgBuffer, productBuffer] = await Promise.all([
  fetch(backgroundImageUrl).then(r => r.arrayBuffer()).then(Buffer.from),
  fetch(productImageUrl).then(r => r.arrayBuffer()).then(Buffer.from),
])

// 배경 1024×1024 고정
const bg = sharp(bgBuffer).resize(1024, 1024, { fit: 'cover' })

// 제품: fit:'inside'로 리사이즈 (contain 대신 — 투명 여백 없음)
const productResized = await sharp(productBuffer)
  .resize({ height: Math.round(1024 * 0.68), width: Math.round(1024 * 0.68), fit: 'inside' })
  .toBuffer()

const result = await bg
  .composite([{
    input: productResized,
    gravity: placement === 'bottom-center' ? 'south' : 'centre',
  }])
  .jpeg({ quality: 90 })   // 출력 포맷 명시
  .toBuffer()

// Supabase Storage 업로드 → URL 반환
```

**출력 크기:** 1024×1024 JPEG. hero 섹션은 전체 폭으로 사용, lifestyle/detail은 2컬럼(약 절반 폭)으로 사용 — 1:1 비율은 모든 섹션에서 허용.

**Rate limit:** 분당 20회

---

### `POST /api/ai/generate-frame-image` (수정)

`export const maxDuration = 60` 추가 (기존 누락)

**변경 사항:**
- 합성 경로에서 `productImageBase64`, `productImageMimeType`을 **전송하지 않음** (파라미터 자체는 optional로 유지 — 제거 시 기존 비합성 경로 파손 위험)
- `imagen.ts` 변경 불필요 — 이미 텍스트-온리 호출 지원
- 배경 씬 전용 system prompt 추가 (제품 없는 순수 배경 생성 유도)

**섹션별 배경 씬 프롬프트 스타일:**
```
hero:      Clean studio background, dramatic gradient lighting, empty product space,
           no objects, photographic quality
lifestyle: Natural living space (marble table, wooden shelf, morning window light),
           warm ambient lighting, no people, no text
detail:    Minimal textured surface (linen, stone, matte), macro photography feel,
           soft diffused light, no distractions
feature:   Abstract geometric or thematic background suggesting the product's function,
           brand-appropriate color palette, no text
```

---

## 사용자 검토 UI

### 상태 변화

```
isGenerating: false → [분석 버튼 클릭] → isAnalyzing: true
  → pendingCrops: CropItem[]  → 검토 패널 표시
  → [확인 클릭] → confirmedCrops: CropItem[]
  → isGenerating: true → 씬 생성 시작
  → 완료/취소/재생성 시 → pendingCrops: null, confirmedCrops: null 초기화
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

**슬롯 클릭 시:** 대체 이미지 직접 업로드 가능 (파일 input)

### 상태 추가 위치: `AssetsDraft` 슬라이스

신규 3개 필드는 store 최상위가 아닌 `assetsDraft` 슬라이스 안에 추가. `ASSETS_DRAFT_INITIAL`과 `resetAssetsDraft`에도 반드시 포함.

```typescript
// AssetsDraft 인터페이스에 추가
pendingCrops: CropItem[] | null    // 분석 완료 후 검토 대기
confirmedCrops: CropItem[] | null  // 사용자 확인 완료
isAnalyzing: boolean               // 이미지 분석 중

// ASSETS_DRAFT_INITIAL에 추가
pendingCrops: null,
confirmedCrops: null,
isAnalyzing: false,

interface CropItem {
  id: string
  originalImageUrl: string
  cropBox?: { x: number; y: number; width: number; height: number }  // 정규화 0~1
  sectionType: 'hero' | 'lifestyle' | 'detail' | 'feature'
  croppedImageUrl: string  // Supabase Storage URL
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

**재사용 이미지 remove-background dedupe:** 동일 `originalImageUrl`에 대해 배경 제거는 1회만 호출. 클라이언트 오케스트레이션에서 URL 기준으로 dedupe 처리 (§클라이언트 오케스트레이션 코드 참조).

**Gemini 배경은 슬롯마다 독립 호출:** 같은 제품 투명 PNG를 재사용하더라도 섹션 타입별 다른 프롬프트로 배경 씬 4종 생성 → 같은 제품, 다른 분위기.

---

## HTML 텍스트 오버레이

이미지에 텍스트를 직접 합성하지 않고 `buildAiDetailPageHtml`에서 CSS 오버레이로 추가.

**⚠️ 영향 범위 주의:** 기존 `ai-html-builder.ts`의 hero/lifestyle/detail/feature 섹션은 이미지 옆/아래 별도 블록으로 텍스트를 렌더링 중(2컬럼 레이아웃). CSS 오버레이로 전환하면 기존 레이아웃 구조가 변경된다. 이 변경은 `ai-html-builder.ts` 전면 수정에 해당.

**쿠팡 정책 참고:** 기존 `generate-detail-html` system prompt에 "이미지 위 텍스트 오버레이 박스 금지(쿠팡 광고 가이드)" 규칙이 있음. CSS 오버레이는 이미지 픽셀 합성이 아니므로 허용 범위이나, 구현 전 확인 권장.

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
| cropBox 좌표 검증 실패 | 해당 이미지 전체를 크롭 없이 사용 |
| 배경 제거 실패 | 원본 크롭 이미지(배경 포함) 사용 진행, UI에 ⚠️ 경고 표시 |
| Gemini 씬 생성 실패 | 해당 슬롯 비움 → buildAiDetailPageHtml graceful fallback (텍스트만) |
| 합성 실패 | 배경 제거된 투명 PNG URL 직접 사용 |

모든 섹션 처리는 `Promise.allSettled` — 1개 실패해도 나머지 완성.

---

## 기존 코드 변경 영향

| 파일 | 변경 내용 |
|-----|---------|
| `src/app/api/ai/generate-frame-image/route.ts` | `export const maxDuration = 60` 추가; 합성 경로에서 productImageBase64 미전송 (파라미터 제거 아님) |
| `src/lib/ai/imagen.ts` | 변경 없음 |
| `src/app/api/ai/generate-detail-html/route.ts` | 변경 없음 (imagePrompts 생성 로직 유지) |
| `src/lib/detail-page/ai-html-builder.ts` | 섹션별 CSS 텍스트 오버레이 추가 (레이아웃 전면 수정) |
| `src/components/listing/assets/AssetsTab.tsx` | runGeminiImageGeneration 교체, 검토 패널 연동, dedupe 로직 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 분석 버튼 추가 |
| `src/store/useListingStore.ts` | AssetsDraft에 pendingCrops/confirmedCrops/isAnalyzing 추가, ASSETS_DRAFT_INITIAL 업데이트 |
| `src/app/api/image/analyze-detail-images/route.ts` | 신규 (`maxDuration = 60`) |
| `src/app/api/image/remove-background/route.ts` | 신규 (`maxDuration = 60`, Stability AI 신규 연동) |
| `src/app/api/image/composite/route.ts` | 신규 (`maxDuration = 60`, URL 기반 입력) |

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
3. 이미지 2장 업로드 → 4개 섹션 채우기 (재사용) → remove-background 2회만 호출 확인 → 섹션별 다른 Gemini 배경 확인
4. 배경 제거 실패 케이스 → 경고 표시 + 원본 크롭으로 진행 확인
5. cropBox 경계 초과 좌표 → clamp 처리 후 정상 크롭 확인
6. 최종 HTML: 각 섹션 이미지 위에 CSS 텍스트 오버레이 표시 확인
7. Vercel 배포 환경: 각 라우트 타임아웃 없이 완료 확인 (maxDuration = 60)
