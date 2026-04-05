# AI 프레임 이미지 자동 생성 기능 구현 명세

## 1. 개요

현재 Smart Seller Studio는 13개 프레임의 텍스트 카피를 AI로 자동 생성하지만, 프레임에 들어갈 **이미지**는 사용자가 외부 도구(Gemini 나노바나나 등)에서 수동으로 만들어 붙여야 한다. 이 기능은 **프레임별 AI 이미지 생성을 앱 안에서 직접 수행**할 수 있도록 개선한다.

---

## 2. 핵심 워크플로우

```
[Step 1] 프레임 카피 생성 시 (기존 Claude 호출 확장)
         기존: imageDirection = "손가락으로 버튼 누르는 클로즈업 컷" (짧은 힌트)
         변경: imagePrompt = "Close-up shot of a finger pressing a one-touch button
               on a matte black stainless tumbler, soft studio lighting,
               white background, commercial product photography, 4k --ar 3:4"
               (나노바나나/Gemini용 상세 영어 프롬프트)
         추가: needsProductImage = true/false (이 프레임에 실제 상품 사진이 필요한지)

[Step 2] 프레임 카드 UI에서:
         ├── needsProductImage: true  → [사진 선택] + [AI 이미지 생성] 버튼
         │   사용자가 업로드한 상품 사진을 참조 이미지로 전달하여
         │   상품이 포함된 합성 이미지를 생성한다.
         │
         └── needsProductImage: false → [AI 이미지 생성] 버튼만
             프롬프트 텍스트만으로 이미지를 생성한다.
             (pain_point, before_after, target 등 상황/감성 프레임)

[Step 3] 생성된 이미지가 프레임의 frameImages[frameType]에 자동 저장
```

---

## 3. 프레임별 needsProductImage 분류

| frameType | needsProductImage | 이유 |
|-----------|:-:|------|
| hero | true | 상품 메인 사진 필수 |
| pain_point | false | 고객 불편 상황 연출 (상품 무관) |
| solution | true | 상품이 문제를 해결하는 장면 |
| usp | true | 상품 기능 클로즈업 비교 |
| detail_1 | true | 소재/기능 상세 촬영 |
| detail_2 | true | 디자인/감성 촬영 |
| how_to_use | true | 상품 사용 장면 |
| before_after | false | 사용 전후 상황 대비 (상품보다 변화 중심) |
| target | false | 타겟 고객 라이프스타일 (인물 중심) |
| spec | true | 상품 실측/디테일 |
| faq | false | 텍스트 중심, 이미지 보조 |
| social_proof | false | 리뷰/사용자 후기 분위기 |
| cta | true | 상품 구매 유도 비주얼 |

> 이 분류는 기본값이며, 사용자가 프레임별로 토글할 수 있어야 한다.

---

## 4. 기술 구현 상세

### 4-1. SDK 교체

```bash
npm uninstall @google/generative-ai
npm install @google/genai
```

**기존 `src/lib/ai/gemini.ts` 마이그레이션 필요:**

```typescript
// 변경 전 (레거시)
import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(apiKey);

// 변경 후 (신규)
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey });
```

> 기존 `analyzeProductImage` 함수는 `analyze-image/route.ts`에서 이미 Claude를 직접 호출하는 방식으로 동작 중이므로, `src/lib/ai/gemini.ts`에서 레거시 SDK 제거 후 새 SDK로 이미지 생성 함수만 추가하면 된다.

### 4-2. 이미지 생성 모듈: `src/lib/ai/imagen.ts`

```typescript
import { GoogleGenAI } from "@google/genai";

// 모델: Gemini 2.5 Flash Image (텍스트+이미지 입출력 지원)
const MODEL = "gemini-2.5-flash-preview-image-generation";

interface GenerateFrameImageInput {
  /** 나노바나나용 상세 영어 프롬프트 */
  imagePrompt: string;
  /** 참조할 상품 사진 Base64 (needsProductImage: true일 때) */
  productImageBase64?: string;
  /** 상품 사진 MIME 타입 */
  productImageMimeType?: string;
}

interface GenerateFrameImageOutput {
  /** 생성된 이미지 Base64 */
  imageBase64: string;
  /** 생성된 이미지 MIME 타입 */
  mimeType: string;
}

export async function generateFrameImage(
  input: GenerateFrameImageInput
): Promise<GenerateFrameImageOutput> {
  const ai = getGeminiGenAI(); // 싱글톤 패턴

  const parts = [];

  // 상품 참조 이미지가 있으면 먼저 추가
  if (input.productImageBase64 && input.productImageMimeType) {
    parts.push({
      inlineData: {
        mimeType: input.productImageMimeType,
        data: input.productImageBase64,
      },
    });
  }

  // 이미지 생성 프롬프트
  parts.push({ text: input.imagePrompt });

  const response = await ai.models.generateContent({
    model: MODEL,
    config: { responseModalities: ["Text", "Image"] },
    contents: [{ role: "user", parts }],
  });

  // 응답에서 이미지 파트 추출
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData
  );

  if (!imagePart?.inlineData) {
    throw new Error("이미지 생성에 실패했습니다.");
  }

  return {
    imageBase64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType,
  };
}
```

### 4-3. API 라우트: `POST /api/ai/generate-frame-image`

```
요청 바디:
{
  "frameType": "detail_1",
  "imagePrompt": "Close-up shot of...",
  "productImageBase64": "...",        // optional
  "productImageMimeType": "image/jpeg" // optional
}

응답 (성공):
{
  "success": true,
  "data": {
    "imageBase64": "...",
    "mimeType": "image/png"
  }
}
```

인증: `requireAuth()` 적용
Rate Limit: 10회/분 (이미지 생성은 카피 생성보다 가볍게)

### 4-4. 프레임 카피 생성 프롬프트 확장

`src/lib/ai/prompts/frame-generation.ts`의 시스템 프롬프트에 다음 규칙 추가:

```
## imagePrompt 규칙 (신규)
- 기존 imageDirection 대신 imagePrompt 필드를 사용합니다.
- imagePrompt는 AI 이미지 생성 도구(Gemini Imagen)에 직접 입력할 수 있는
  상세한 영어 프롬프트입니다.
- 반드시 다음 요소를 포함해야 합니다:
  1. 카메라 앵글/샷 타입 (예: "Close-up shot", "Wide angle overhead view")
  2. 피사체 묘사 (소재, 색상, 형태 등 — 이미지 분석 결과 활용)
  3. 배경/환경 (예: "on a white marble countertop", "in a cozy home office")
  4. 조명 스타일 (예: "soft natural light from left", "dramatic studio lighting")
  5. 종횡비 지시: --ar 3:4 (상세페이지 세로형 기준)
- hero 프레임: imagePrompt는 null (사용자 원본 사진 사용)
- 200자 이내의 영어 1문장으로 작성

## needsProductImage 규칙 (신규)
- 각 프레임에 needsProductImage(boolean) 필드를 추가합니다.
- true: 이미지 생성 시 실제 상품 사진을 참조 이미지로 사용해야 합니다.
- false: 텍스트 프롬프트만으로 이미지를 생성합니다 (상황/감성 연출).
```

### 4-5. 타입 확장: `src/types/frames.ts`

```typescript
// GeneratedFrame 인터페이스 확장
export interface GeneratedFrame {
  frameType: FrameType;
  headline: string | null;
  subheadline: string | null;
  bodyText: string | null;
  ctaText: string | null;
  metadata: Record<string, unknown>;

  // 기존
  imageDirection?: string | null;  // deprecated, 하위호환용 유지
  skip?: boolean;

  // 신규
  imagePrompt?: string | null;       // Gemini Imagen용 상세 영어 프롬프트
  needsProductImage?: boolean;        // 상품 참조 이미지 필요 여부
}
```

### 4-6. Zustand Store 확장: `src/store/useEditorStore.ts`

```typescript
// 추가할 상태
generatingImageForFrame: FrameType | null;  // 현재 이미지 생성 중인 프레임

// 추가할 액션
setGeneratingImageForFrame: (frameType: FrameType | null) => void;
generateFrameImage: (frameType: FrameType) => Promise<void>;
  // 내부 동작:
  // 1. frames에서 해당 frameType의 imagePrompt 조회
  // 2. needsProductImage이면 uploadedImages 중 대표 이미지 Base64 로드
  // 3. POST /api/ai/generate-frame-image 호출
  // 4. 응답 이미지를 frameImages[frameType]에 저장
```

### 4-7. FrameCard UI 변경: `src/components/editor/FrameCard.tsx`

기존 이미지 선택 팝오버 영역에 **AI 이미지 생성 버튼** 추가:

```
┌─────────────────────────────────────┐
│  [이미지 선택 ▾]                    │  ← 기존 기능 (업로드 이미지 중 선택)
│                                     │
│  📝 프롬프트 미리보기:              │  ← 신규: imagePrompt 표시
│  "Close-up shot of a matte..."      │
│  [프롬프트 수정] [복사]             │  ← 신규: 프롬프트 편집/복사 버튼
│                                     │
│  ┌─ needsProductImage: true ──┐     │
│  │ [상품 사진 선택] [AI 생성] │     │  ← 신규: 상품 사진 + AI 생성
│  └────────────────────────────┘     │
│  ┌─ needsProductImage: false ─┐     │
│  │ [AI 이미지 생성]           │     │  ← 신규: 프롬프트만으로 생성
│  └────────────────────────────┘     │
└─────────────────────────────────────┘
```

---

## 5. 변경 대상 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|:------:|------|
| `package.json` | 수정 | `@google/generative-ai` → `@google/genai` |
| `src/lib/ai/gemini.ts` | **재작성** | 레거시 SDK 제거, 이미지 생성 함수 추가 |
| `src/lib/ai/imagen.ts` | **신규** | `generateFrameImage()` 함수 |
| `src/app/api/ai/generate-frame-image/route.ts` | **신규** | 이미지 생성 API 엔드포인트 |
| `src/app/api/ai/analyze-image/route.ts` | 확인 | Claude 직접 호출이므로 SDK 교체 영향 없음 |
| `src/lib/ai/prompts/frame-generation.ts` | 수정 | imagePrompt, needsProductImage 규칙 추가 |
| `src/lib/ai/prompts/frame-generation.schema.ts` | 수정 | 스키마에 imagePrompt, needsProductImage 추가 |
| `src/types/frames.ts` | 수정 | GeneratedFrame에 신규 필드 추가 |
| `src/store/useEditorStore.ts` | 수정 | 이미지 생성 상태/액션 추가 |
| `src/components/editor/FrameCard.tsx` | 수정 | AI 이미지 생성 버튼/UI 추가 |

---

## 6. 구현 순서 (권장)

### Phase 1: 인프라 (SDK + API)
1. `@google/generative-ai` → `@google/genai` SDK 교체
2. `src/lib/ai/gemini.ts` 마이그레이션 (기존 이미지 분석 함수 유지 or 제거)
3. `src/lib/ai/imagen.ts` 신규 생성
4. `POST /api/ai/generate-frame-image` 라우트 구현
5. API 동작 검증 (curl 또는 테스트)

### Phase 2: 프롬프트 + 타입
6. `GeneratedFrame` 타입에 `imagePrompt`, `needsProductImage` 추가
7. `frame-generation.ts` 프롬프트에 imagePrompt 규칙 추가
8. `frame-generation.schema.ts` Zod 스키마 확장
9. 카피 생성 후 imagePrompt 출력 검증

### Phase 3: UI
10. `useEditorStore` 이미지 생성 상태/액션 추가
11. `FrameCard` 에 AI 이미지 생성 버튼 추가
12. 프롬프트 미리보기/편집 UI
13. 로딩 상태, 에러 핸들링

### Phase 4: 마무리
14. 프롬프트 복사 버튼 (외부 도구 대비)
15. 생성된 이미지 Supabase Storage 업로드 (영속화)
16. 기존 테스트 업데이트

---

## 7. 환경 변수

```env
# 기존 (변경 없음)
GOOGLE_AI_API_KEY=AIza...   # Gemini API Key — 이미지 생성에도 동일 키 사용
```

---

## 8. 비용 추정

| 모델 | 비용 | 비고 |
|------|------|------|
| gemini-2.5-flash-image-preview | 무료 (rate limit 있음) | 개발/테스트용 |
| imagen-3.0-generate-002 | ~$0.04/장 | 고품질 필요 시 |
| gemini-2.5-flash-image (GA) | 추후 유료화 예상 | 프로덕션 대비 |

13개 프레임 전체 생성 시 약 $0.52 (Imagen 기준) 또는 무료 (Gemini Flash 기준).

---

## 9. 제약 사항 및 주의점

- Gemini 이미지 생성은 사람 얼굴 생성에 제한이 있을 수 있음 (Google 안전 정책)
- 상품 사진 합성 시 원본 상품의 형태가 왜곡될 수 있음 — 프롬프트에 "Keep the product exactly as shown in the reference image" 명시 필요
- Rate Limit: Gemini API 무료 티어 기준 분당 15 요청
- 이미지 생성 실패 시 사용자에게 프롬프트 복사 → 외부 도구 사용 폴백 제공
