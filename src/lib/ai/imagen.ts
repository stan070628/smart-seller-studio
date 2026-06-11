/**
 * Gemini 이미지 생성 헬퍼
 * gemini-2.5-flash-preview-image-generation 모델을 사용해
 * 프레임별 AI 이미지를 생성합니다.
 */

import { getGeminiGenAI } from "./gemini";

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const MODEL = "gemini-2.5-flash-image";

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

export interface GenerateFrameImageInput {
  /** Gemini Imagen에 직접 입력할 상세 영어 프롬프트 */
  imagePrompt: string;
  /** 여러 참조 이미지 (최대 3장, base64 + mimeType) */
  referenceImages?: Array<{ base64: string; mimeType: string }>;
  /** @deprecated 단일 참조 — 내부에서 referenceImages로 흡수 */
  productImageBase64?: string;
  /** @deprecated 상품 이미지 MIME 타입 */
  productImageMimeType?: string;
}

export interface GenerateFrameImageOutput {
  /** 생성된 이미지 base64 데이터 (data URL prefix 제외) */
  imageBase64: string;
  /** 생성된 이미지 MIME 타입 */
  mimeType: string;
}

// ─────────────────────────────────────────
// 이미지 생성 함수
// ─────────────────────────────────────────

/**
 * Gemini Imagen 모델로 프레임 이미지를 생성합니다.
 *
 * @param input - 이미지 프롬프트 및 선택적 상품 참조 이미지
 * @returns 생성된 이미지의 base64 데이터와 MIME 타입
 * @throws Error 이미지 생성 실패 시
 */
export async function generateFrameImage(
  input: GenerateFrameImageInput
): Promise<GenerateFrameImageOutput> {
  const ai = getGeminiGenAI();

  // 참조 이미지 정규화: referenceImages 우선, 없으면 단일 필드를 1장으로 흡수
  const refs =
    input.referenceImages && input.referenceImages.length > 0
      ? input.referenceImages
      : input.productImageBase64 && input.productImageMimeType
        ? [{ base64: input.productImageBase64, mimeType: input.productImageMimeType }]
        : [];

  // parts 배열 구성: 모든 참조 이미지를 inlineData로 추가
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];

  for (const ref of refs) {
    parts.push({
      inlineData: { data: ref.base64, mimeType: ref.mimeType },
    });
  }

  // 이미지 프롬프트 text part 추가 (단일 프레임 제약 suffix 포함)
  const singleFrameConstraint =
    "\n\nCRITICAL COMPOSITION RULE: Generate exactly ONE single-frame photograph. " +
    "Absolutely NO split-panel, diptych, multi-view, collage, triptych, before/after comparison, " +
    "or composite image layouts. The entire image must be a single continuous photographic scene.";

  parts.push({ text: input.imagePrompt + singleFrameConstraint });

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      responseModalities: ["Text", "Image"],
      imageConfig: { imageSize: "1K" },
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  });

  // 응답에서 inlineData(이미지) part 추출
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("이미지 생성에 실패했습니다.");
  }

  const contentParts = candidates[0]?.content?.parts;
  if (!contentParts || contentParts.length === 0) {
    throw new Error("이미지 생성에 실패했습니다.");
  }

  const imagePart = contentParts.find(
    (part) => part.inlineData && part.inlineData.data
  );

  if (!imagePart || !imagePart.inlineData) {
    throw new Error("이미지 생성에 실패했습니다.");
  }

  return {
    imageBase64: imagePart.inlineData.data as string,
    mimeType: imagePart.inlineData.mimeType as string,
  };
}
