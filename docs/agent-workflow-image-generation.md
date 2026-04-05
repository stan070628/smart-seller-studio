# AI 프레임 이미지 자동 생성 — 에이전트 워크플로우

> 원본 명세: `docs/ai-image-generation-spec.md`
> 작성일: 2026-04-04

---

## 전체 흐름 요약

```
Phase 1 (backend-dev)
  └── SDK 교체 + imagen.ts 신규 + API 라우트 구현

Phase 2 (backend-dev)
  └── GeneratedFrame 타입 확장 + 프롬프트/스키마 확장

Phase 3 (frontend-dev)
  └── useEditorStore 확장 + FrameCard UI 변경

Phase 4 (backend-dev + frontend-dev 병렬)
  ├── backend-dev: Supabase Storage 영속화
  └── frontend-dev: 프롬프트 복사 버튼 + 에러 폴백 UI
```

---

## Phase 1 — 인프라 (backend-dev)

**담당 에이전트:** `backend-dev`
**병렬 실행 가능 여부:** 없음 (순차 실행)

### Task 1-1. SDK 교체

**파일:** `package.json`, `src/lib/ai/gemini.ts`

현재 `@google/generative-ai` (v0.24.1)를 신규 `@google/genai`로 교체한다.

```bash
npm uninstall @google/generative-ai
npm install @google/genai
```

`src/lib/ai/gemini.ts` 마이그레이션:
- 기존 `GoogleGenerativeAI` → `GoogleGenAI` (import + 인스턴스화)
- `analyzeProductImage` 함수는 `analyze-image/route.ts`에서 Claude를 직접 호출하고 있으므로, `gemini.ts`에서 해당 함수를 **제거해도 무방**
- `getGeminiGenAI()` 싱글톤 함수만 export하도록 재작성

> 주의: `analyze-image/route.ts`는 현재 Claude API를 직접 호출하므로 SDK 교체 영향 없음. 건드리지 않는다.

---

### Task 1-2. imagen.ts 신규 생성

**파일:** `src/lib/ai/imagen.ts` (신규)

```typescript
import { GoogleGenAI } from "@google/genai";
import { getGeminiGenAI } from "./gemini";

const MODEL = "gemini-2.5-flash-preview-image-generation";

interface GenerateFrameImageInput {
  imagePrompt: string;
  productImageBase64?: string;     // needsProductImage: true일 때
  productImageMimeType?: string;
}

interface GenerateFrameImageOutput {
  imageBase64: string;
  mimeType: string;
}

export async function generateFrameImage(
  input: GenerateFrameImageInput
): Promise<GenerateFrameImageOutput>
```

구현 로직:
1. `getGeminiGenAI()` 호출로 싱글톤 클라이언트 획득
2. `productImageBase64` 있으면 `inlineData` part 먼저 추가
3. `imagePrompt` text part 추가
4. `ai.models.generateContent({ model: MODEL, config: { responseModalities: ["Text", "Image"] }, ... })` 호출
5. `response.candidates[0].content.parts`에서 `inlineData` 있는 part 추출
6. 없으면 `Error("이미지 생성에 실패했습니다.")` throw

---

### Task 1-3. API 라우트 구현

**파일:** `src/app/api/ai/generate-frame-image/route.ts` (신규)

```
POST /api/ai/generate-frame-image

요청 바디:
{
  "frameType": "detail_1",
  "imagePrompt": "Close-up shot of...",
  "productImageBase64"?: "...",
  "productImageMimeType"?: "image/jpeg"
}

성공 응답:
{
  "success": true,
  "data": {
    "imageBase64": "...",
    "mimeType": "image/png"
  }
}
```

구현 요구사항:
- `requireAuth()` 적용 (기존 패턴 동일하게)
- Rate Limit: **10회/분** (`rate-limit.ts` 활용)
- Zod 요청 검증:
  - `frameType`: `z.enum([...FRAME_TYPES])`
  - `imagePrompt`: `z.string().min(10).max(500)`
  - `productImageBase64`: `z.string().optional()`
  - `productImageMimeType`: `z.enum(["image/jpeg", "image/png", "image/webp"]).optional()`
- `productImageMimeType` 없이 `productImageBase64`만 오면 400 반환
- `generateFrameImage()` 호출 → 응답 반환
- 에러: `AiResponseParseError` 또는 Gemini API 에러 시 500

---

### Task 1-4. API 동작 검증

- `npm run dev` 기동 후 curl로 기본 동작 확인
- `imagePrompt`만 전송 (텍스트 전용) 케이스
- `productImageBase64` 포함 케이스 (테스트용 작은 JPEG base64)
- Rate Limit 초과 케이스

---

## Phase 2 — 프롬프트 + 타입 확장 (backend-dev)

**담당 에이전트:** `backend-dev`
**Phase 1 완료 후 실행**

### Task 2-1. GeneratedFrame 타입 확장

**파일:** `src/types/frames.ts`

`GeneratedFrame` 인터페이스에 신규 필드 추가:

```typescript
export interface GeneratedFrame {
  // ... 기존 필드 유지 ...
  imageDirection?: string | null;    // deprecated, 하위 호환용 유지

  // 신규
  imagePrompt?: string | null;       // Gemini Imagen용 상세 영어 프롬프트
  needsProductImage?: boolean;       // 상품 참조 이미지 필요 여부
}
```

> `imageDirection` 제거 금지 — 기존 카피 생성 데이터 하위 호환 필요

---

### Task 2-2. Zod 스키마 확장

**파일:** `src/lib/ai/prompts/frame-generation.schema.ts`

`GeneratedFrameSchema`에 신규 필드 추가:

```typescript
imagePrompt: z.string().max(200).nullable().optional(),
needsProductImage: z.boolean().optional().default(false),
```

- `hero` 프레임은 `imagePrompt: null` 강제 — 스키마 레벨보다 프롬프트 지시로 처리
- `parseFrameGenerationResponse` 함수는 변경 불필요 (필드 추가만이므로)

---

### Task 2-3. 프레임 생성 시스템 프롬프트 확장

**파일:** `src/lib/ai/prompts/frame-generation.ts`

`FRAME_SYSTEM_PROMPT`에 다음 규칙 추가:

```
## imagePrompt 규칙 (신규)
각 프레임의 JSON에 imagePrompt 필드를 추가합니다.
- imagePrompt는 Gemini Imagen에 직접 입력할 상세한 영어 프롬프트입니다.
- 반드시 포함할 요소:
  1. 카메라 앵글/샷 타입 (예: "Close-up shot", "Wide angle overhead view")
  2. 피사체 묘사 (이미지 분석 결과의 material, shape, colors 활용)
  3. 배경/환경 (예: "on a white marble countertop", "soft studio lighting")
  4. 조명 스타일 (예: "soft natural light from left", "dramatic studio lighting")
  5. 종횡비: --ar 3:4
- hero 프레임: imagePrompt는 null (사용자 원본 사진 사용)
- 200자 이내 영어 1문장으로 작성

## needsProductImage 규칙 (신규)
각 프레임 JSON에 needsProductImage(boolean) 필드를 추가합니다.
- true: 실제 상품 사진을 참조 이미지로 사용 (hero/solution/usp/detail_1/detail_2/how_to_use/spec/cta)
- false: 텍스트 프롬프트만으로 생성 (pain_point/before_after/target/faq/social_proof)
```

> `imageDirection`은 프롬프트에서 **제거하지 않음** — 기존 생성 결과 호환성 유지

---

### Task 2-4. 카피 생성 후 imagePrompt 출력 검증

- `generate-frames` API 호출 시 응답에 `imagePrompt`, `needsProductImage` 포함 확인
- hero 프레임: `imagePrompt === null` 확인
- pain_point 프레임: `needsProductImage === false` 확인
- detail_1 프레임: `needsProductImage === true`, `imagePrompt` 200자 이내 영어 확인

---

## Phase 3 — UI (frontend-dev)

**담당 에이전트:** `frontend-dev`
**Phase 2 완료 후 실행**

### Task 3-1. useEditorStore 확장

**파일:** `src/store/useEditorStore.ts`

상태 추가:
```typescript
generatingImageForFrame: FrameType | null;   // 현재 이미지 생성 중인 프레임
```

액션 추가:
```typescript
setGeneratingImageForFrame: (frameType: FrameType | null) => void;
generateFrameImage: (frameType: FrameType) => Promise<void>;
```

`generateFrameImage` 구현 로직:
1. `frames`에서 `frameType`으로 해당 프레임 조회 → `imagePrompt` 없으면 에러 throw
2. `generatingImageForFrame = frameType` 세팅
3. `needsProductImage === true`이면:
   - `uploadedImages[0]`을 기본 대표 이미지로 사용
   - `fetch(imageUrl)` → `arrayBuffer` → `base64` 변환
4. `POST /api/ai/generate-frame-image` 호출
5. 성공: `setFrameImage(frameType, "data:{mimeType};base64,{imageBase64}")`
6. 실패: 에러 상태 저장 or throw
7. `finally`: `generatingImageForFrame = null`

---

### Task 3-2. FrameCard AI 이미지 생성 버튼 추가

**파일:** `src/components/editor/FrameCard.tsx`

변경 위치: 기존 이미지 선택 팝오버(Popover) 내부

현재 구조 (이미지 선택 팝오버):
```
[이미지 선택 ▾] → 팝오버 → 업로드된 이미지 목록
```

변경 후 구조:
```
[이미지 선택 ▾] → 팝오버
  ├── 기존: 업로드된 이미지 목록 (유지)
  ├── 구분선
  ├── 📝 imagePrompt 미리보기 텍스트 (있을 때만 표시)
  │   └── [프롬프트 수정] [복사] 버튼
  └── needsProductImage === true  → [상품 사진 선택] + [AI 이미지 생성]
      needsProductImage === false → [AI 이미지 생성]
```

AI 이미지 생성 버튼 클릭 핸들러:
```typescript
const handleGenerateAIImage = async () => {
  await generateFrameImage(frame.frameType);  // store 액션 호출
};
```

로딩 상태: `generatingImageForFrame === frame.frameType`이면 버튼 disabled + spinner

에러 처리: toast 또는 팝오버 내 에러 메시지 (기존 에러 처리 패턴 따름)

---

### Task 3-3. 프롬프트 미리보기 + 편집 UI

**파일:** `src/components/editor/FrameCard.tsx`

- `frame.imagePrompt`가 있을 때만 렌더링
- 기본은 읽기 전용 텍스트 (`<p>`)
- [수정] 클릭 시 `<textarea>`로 전환 (인라인 편집)
- 편집 완료 시 `updateFrame(frameType, { imagePrompt: newValue })` 호출
- [복사] 클릭 시 `navigator.clipboard.writeText(imagePrompt)`

---

### Task 3-4. hero 프레임 예외 처리

- `frame.frameType === 'hero'`이면 AI 이미지 생성 버튼 렌더링 안 함
- hero는 `imagePrompt === null` — 원본 사진 사용이 기본

---

## Phase 4 — 마무리 (병렬 실행 가능)

### Task 4-1. Supabase Storage 영속화 (backend-dev)

**파일:** `src/app/api/ai/generate-frame-image/route.ts` 또는 별도 라우트

생성된 이미지를 메모리(base64)에만 두지 않고 Storage에 저장:
- 경로: `{userId}/projects/{projectId}/frames/{frameType}.png`
- 저장 후 Supabase Public URL 반환 옵션 추가
- 해당 기능은 **선택적 파라미터**(`persistToStorage?: boolean`)로 구현

> Phase 4 우선순위 낮음. Phase 3까지 완료 후 진행.

---

### Task 4-2. 폴백 + 접근성 마무리 (frontend-dev)

**파일:** `src/components/editor/FrameCard.tsx`

- 이미지 생성 실패 시: "프롬프트 복사" 버튼 노출 → 외부 도구(나노바나나 등) 안내
- Rate Limit 초과(429) 시: "잠시 후 다시 시도해주세요" 메시지
- 생성 중 다른 프레임 버튼은 disabled (동시 생성 1개 제한)

---

## 에이전트별 작업 요약

| Phase | 에이전트 | 파일 | 우선순위 |
|-------|----------|------|---------|
| 1-1 | backend-dev | `package.json`, `src/lib/ai/gemini.ts` | 최고 |
| 1-2 | backend-dev | `src/lib/ai/imagen.ts` (신규) | 최고 |
| 1-3 | backend-dev | `src/app/api/ai/generate-frame-image/route.ts` (신규) | 최고 |
| 2-1 | backend-dev | `src/types/frames.ts` | 높음 |
| 2-2 | backend-dev | `src/lib/ai/prompts/frame-generation.schema.ts` | 높음 |
| 2-3 | backend-dev | `src/lib/ai/prompts/frame-generation.ts` | 높음 |
| 3-1 | frontend-dev | `src/store/useEditorStore.ts` | 높음 |
| 3-2 | frontend-dev | `src/components/editor/FrameCard.tsx` | 높음 |
| 3-3 | frontend-dev | `src/components/editor/FrameCard.tsx` | 중간 |
| 4-1 | backend-dev | API 라우트 확장 | 낮음 |
| 4-2 | frontend-dev | `src/components/editor/FrameCard.tsx` | 낮음 |

---

## 에이전트 호출 순서 (copy & paste용)

### Step 1 — backend-dev 호출 (Phase 1+2 묶음)

```
@backend-dev
docs/agent-workflow-image-generation.md의 Phase 1 (Task 1-1 ~ 1-4)과 Phase 2 (Task 2-1 ~ 2-4)를 구현해줘.

현재 상태:
- @google/generative-ai v0.24.1 설치됨, @google/genai는 미설치
- src/lib/ai/gemini.ts: GoogleGenerativeAI 사용 중, analyzeProductImage 함수 있음
- analyze-image/route.ts는 Claude를 직접 호출하므로 gemini.ts 의존성 없음

주의사항:
- imageDirection 필드 및 관련 프롬프트 규칙 제거 금지 (하위 호환)
- requireAuth() 패턴은 기존 generate-frames/route.ts와 동일하게
- rate-limit.ts 활용: 10회/분
```

### Step 2 — frontend-dev 호출 (Phase 3)

```
@frontend-dev
docs/agent-workflow-image-generation.md의 Phase 3 (Task 3-1 ~ 3-4)를 구현해줘.

현재 상태:
- src/store/useEditorStore.ts: generatingImageForFrame 상태 없음
- src/components/editor/FrameCard.tsx: 이미지 선택 팝오버 있음, imageDirection 표시 중
- POST /api/ai/generate-frame-image 라우트는 Phase 1에서 구현 완료

주의사항:
- hero 프레임은 AI 이미지 생성 버튼 표시 안 함
- 동시 생성 1개 제한 (generatingImageForFrame !== null이면 다른 버튼 disabled)
- 기존 이미지 선택 팝오버 구조 최대한 유지
```

---

## 환경 변수 체크리스트

```env
# 변경 없음 — 기존 키 그대로 사용
GOOGLE_AI_API_KEY=AIza...   # imagen.ts에서도 동일 키 사용
ANTHROPIC_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## 제약 및 주의사항

| 항목 | 내용 |
|------|------|
| Gemini 안전 정책 | 사람 얼굴 생성 제한 있음. `target` 프레임 실패 시 폴백 필요 |
| 상품 합성 왜곡 | `needsProductImage: true` 프롬프트에 "Keep the product exactly as shown" 추가 |
| Rate Limit | 무료 티어 기준 분당 15 요청. API 라우트에서 10/분으로 제한 |
| Base64 크기 | 업로드 이미지 base64 전송 시 10MB 이하 검증 필요 |
| 모델 GA 여부 | `gemini-2.5-flash-preview-image-generation`은 preview — GA 전환 시 모델명 교체 필요 |
