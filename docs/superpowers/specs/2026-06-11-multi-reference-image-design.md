# 멀티참조 이미지 입력 (제피터식 AI 재생성) 설계

> 작성일: 2026-06-11
> 상태: 설계 확정 (구현 플랜 대기)

## 1. 배경 및 목표

레퍼런스 제품 "제피터"처럼, 사용자가 첨부한 상품 이미지(예: 3장)를 **원본 그대로 쓰지 않고 AI가 통째로 재생성**해 고급 상세페이지 비주얼을 만든다.

### 확정된 핵심 철학 (브레인스토밍 결과)

1. **제피터식 AI 전체 재생성** — 첨부 이미지를 참조로 AI가 제품 포함 장면을 재생성한다.
2. **제품 정체성 유지 + 재연출** — 제품의 형태·색·로고·포장 텍스트는 알아보게 유지하되, 각도·조명·재질감·배경은 AI가 고급스럽게 재해석한다.
3. **멀티참조(최대 3장) → 섹션별 N장 생성** — 업로드한 전체 이미지를 "제품 정체성 참조"로 묶어, 섹션(hero/lifestyle/detail/feature)별로 서로 다른 장면을 생성한다.
4. **기존 `scene-composite` 플랜(원본 픽셀 보존 + Sharp 배경 합성)은 폐기** — 제피터식 AI 재생성으로 일원화한다. (해당 플랜은 미구현 상태라 폐기할 코드 없음.)

### 현황: 80%는 이미 구현됨

현재 코드에는 제피터식에 가까운 흐름이 이미 동작 중이다.

| 원하는 것 | 현재 상태 |
|---|---|
| ① 제피터식 AI 재생성 | ✅ 구현됨 — `generate-scene-image` API가 제품 이미지를 참조로 Gemini가 장면을 재생성 |
| ② 정체성 유지 + 재연출 | ✅ 구현됨 — `PRODUCT_PRESERVATION_RULES` + `SCENE_PROMPT_SYSTEM`이 형태·색·로고 보존 강제, `visualIdentity`가 색/무드/조명 일관성 부여 |
| ③ 멀티참조(3장) → 섹션별 N장 | ❌ **유일한 갭** — 현재는 섹션당 참조 **1장**(`referenceImageIndex`)만 사용. 3장 동시 참조 불가 |
| ④ scene-composite 교체 | ✅ 사실상 이미 비주력 |

**따라서 본 작업의 본질은 "멀티 참조 이미지 입력" 하나를 추가하는 것이다.**

---

## 2. 아키텍처

현재 두 흐름 모두 참조 이미지를 **1장**만 Gemini/Claude에 전달한다.

- `imagen.ts`: `productImageBase64` (단수)
- `generate-scene-image`: `productImageBase64` (단수)
- `detail-image-prompts.ts`: `referenceImageIndex: number` (여러 장 중 1장만 인덱스로 선택)

변경 후: **항상 사용자가 올린 전체 참조(최대 3장)를 함께 전달**한다. `referenceImageIndex`(1장 선택)는 폐기하고, 모든 섹션이 동일한 3장을 다각도 참조로 본다.

```
[업로드 3장: 정면/측면/디테일]
   │ 모두 base64 변환 (장변 1024px, JPEG q80 리사이즈)
   ▼
[Claude Vision] ← 3장 동시 입력 → 제품을 입체적으로 이해 → 섹션별 씬 프롬프트
   ▼
[Gemini 2.5 Flash Image] ← 씬 프롬프트 + 3장 inlineData 동시 입력
   ▼
섹션별 재생성 이미지 (hero / lifestyle / detail / feature)
```

---

## 3. 파일별 변경

### 3-1. `src/lib/ai/imagen.ts` — 입력 타입을 배열로 확장 (하위호환 유지)

```typescript
export interface GenerateFrameImageInput {
  imagePrompt: string;
  // 신규: 여러 참조 이미지 (최대 3장)
  referenceImages?: Array<{ base64: string; mimeType: string }>;
  // deprecated: 단일 — 내부에서 referenceImages[0]로 흡수
  productImageBase64?: string;
  productImageMimeType?: string;
}
```

- parts 구성 시 `referenceImages`를 순회하며 전부 `inlineData`로 push.
- `productImageBase64`/`productImageMimeType` 단일 필드만 오면 1장짜리 배열로 normalize 후 동일 경로 처리.
- 단일 프레임 제약 suffix(`singleFrameConstraint`)는 그대로 유지.

### 3-2. `src/app/api/ai/generate-scene-image/route.ts`

- 요청 스키마에 `referenceImages: Array<{ base64, mimeType }>` 또는 `productImageUrls: string[]` 추가 (URL이면 서버에서 병렬 fetch → base64).
  - 기존 `productImageBase64` / `productImageUrl` 단일 필드는 하위호환으로 유지.
- Claude `userContent`에 이미지 블록을 **N개** push.
- `SCENE_PROMPT_SYSTEM` 수정:
  - "a product reference image" → "**product reference images from multiple angles**"
  - 수량 오인 방지 규칙 추가: *"these are the SAME single product photographed from different angles — do not multiply or duplicate items based on the number of reference images."*
  - 수량 카운트는 "the clearest reference"를 기준으로 하도록 보강.
- `generateFrameImage`에 `referenceImages` 전달.

### 3-3. `src/lib/ai/prompts/detail-image-prompts.ts`

- `SectionImagePrompt.referenceImageIndex` **필드 제거** (모든 섹션이 전체 참조를 보므로 인덱스 개념 자체가 불필요).
- 프롬프트 JSON 예시에서 `referenceImageIndex` 필드 삭제 — 모든 섹션이 전체 참조를 본다.
- `buildImagePromptsUserPrompt`에 "multiple reference angles available" 명시.
- `parseImagePromptsResponse`는 `referenceImageIndex` 없이도 정상 동작하도록 수정.

### 3-4. `src/app/api/ai/generate-frame-image/route.ts`

(`runGeminiImageGeneration`이 직접 호출하는 흐름)

- 요청 스키마에 `referenceImages` 추가.
- `generateFrameImage`에 패스스루.

### 3-5. `src/components/listing/assets/AssetsTab.tsx` (오케스트레이션)

- `runGeminiImageGeneration` / `handleConfirmCrops`에서 단일 대표 이미지 대신 **업로드/크롭 전체(상한 3장)를 base64 배열로** 각 섹션 호출에 전달.
- 전송 전 각 참조를 장변 1024px / JPEG q80으로 리사이즈·압축.

---

## 4. 제약·엣지케이스·에러 처리

| 항목 | 처리 방안 |
|---|---|
| 참조 장수 상한 | 최대 **3장**. 4장 이상 업로드 시 **업로드 순서 기준 첫 3장**만 사용(단순·예측가능). Gemini 멀티 입력은 장수↑ 시 토큰·지연·왜곡 위험↑ |
| base64 페이로드 크기 | 전송 전 장변 1024px, JPEG q80 리사이즈. 합산 페이로드가 `generate-scene-image`의 maxDuration(90s)·요청 한도 내 유지 |
| 장수 1장 | 기존과 동일 동작(배열 길이 1). 회귀 없음 |
| 참조 0장(URL fetch 실패 등) | 텍스트 프롬프트만으로 생성(현행 폴백 유지). ②"정체성 유지"는 보장 불가하므로 경고 메시지 표시 |
| 제품 수량 왜곡 | `SCENE_PROMPT_SYSTEM`에 "same single product from different angles — do not multiply" 규칙 추가 |
| Rate limit | `generate-scene-image` 8회/분 유지. 멀티참조는 호출 수 변화 없음(페이로드만 증가) |

---

## 5. 테스트 (TDD)

- `imagen.test.ts` — `referenceImages` 3장 입력 시 parts에 `inlineData` 3개 생성 + 단일 필드(`productImageBase64`) 하위호환 normalize 검증.
- `generate-scene-image.test.ts` — `productImageUrls[]` fetch→base64, Claude/Gemini에 N개 전달, 0장 폴백, 4장→3장 절삭 검증.
- `detail-image-prompts.test.ts` — 파서가 `referenceImageIndex` 없이도 정상 동작 검증.

---

## 6. 변경 대상 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `src/lib/ai/imagen.ts` | 수정 — `referenceImages[]` 입력 지원 |
| `src/app/api/ai/generate-scene-image/route.ts` | 수정 — 멀티 참조 스키마·Claude·프롬프트 |
| `src/lib/ai/prompts/detail-image-prompts.ts` | 수정 — `referenceImageIndex` 폐기 |
| `src/app/api/ai/generate-frame-image/route.ts` | 수정 — `referenceImages` 패스스루 |
| `src/components/listing/assets/AssetsTab.tsx` | 수정 — 전체 참조 전달 + 리사이즈 |
| `src/__tests__/.../imagen.test.ts` | 수정/신규 |
| `src/__tests__/.../generate-scene-image.test.ts` | 수정/신규 |
| `src/__tests__/.../detail-image-prompts.test.ts` | 수정/신규 |
