/**
 * POST /api/ai/analyze-image
 *
 * 프론트에서 업로드한 제품 이미지(Base64)를 받아
 * Claude Vision으로 분석하여 재질, 색상, 특징, 비주얼 프롬프트를 반환합니다.
 * 여러 장의 이미지를 받아 종합 분석하며, 단일 이미지 형식도 하위 호환으로 지원합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient } from "@/lib/ai/claude";
import { IMAGE_ANALYSIS_PROMPT } from "@/lib/ai/prompts/image-analysis";
import { parseImageResponse } from "@/lib/ai/schemas";
import type { ImageAnalysisSchemaType } from "@/lib/ai/schemas";

/** 다중 이미지 입력 타입 */
type AnalyzeImageInput = {
  images: { imageBase64: string; mimeType: string }[];
  productDescription?: string;
};

type AnalyzeImageOutput = ImageAnalysisSchemaType;

// ─────────────────────────────────────────
// 요청/응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  data: AnalyzeImageOutput;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 허용 MIME 타입 */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Base64 최대 크기 제한: 약 10MB (Base64는 원본의 약 1.33배) */
const MAX_BASE64_LENGTH = 14 * 1024 * 1024; // ~10MB 원본 기준

/** 한 번에 처리 가능한 최대 이미지 수 */
const MAX_IMAGE_COUNT = 10;

// ─────────────────────────────────────────
// data URL prefix 제거 헬퍼
// ─────────────────────────────────────────

function stripDataUrlPrefix(imageBase64: string): string {
  if (!imageBase64.startsWith("data:")) {
    return imageBase64;
  }
  const commaIndex = imageBase64.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("data URL 형식이 올바르지 않습니다.");
  }
  return imageBase64.slice(commaIndex + 1);
}

// ─────────────────────────────────────────
// 요청 바디 검증
// ─────────────────────────────────────────

function validateRequestBody(body: unknown): AnalyzeImageInput {
  if (!body || typeof body !== "object") {
    throw new Error("요청 바디가 유효한 JSON 객체가 아닙니다.");
  }

  const raw = body as Record<string, unknown>;

  // ── 하위 호환: 단일 이미지 형식 (imageBase64 + mimeType) → images 배열로 변환
  if (raw.imageBase64 !== undefined || raw.mimeType !== undefined) {
    const { imageBase64, mimeType, productDescription } = raw;

    if (typeof imageBase64 !== "string" || imageBase64.trim().length === 0) {
      throw new Error("imageBase64 필드는 비어있지 않은 문자열이어야 합니다.");
    }

    const cleanedBase64 = stripDataUrlPrefix(imageBase64);

    if (cleanedBase64.length > MAX_BASE64_LENGTH) {
      throw new Error("이미지 크기가 너무 큽니다. 10MB 이하의 이미지만 허용됩니다.");
    }

    if (
      typeof mimeType !== "string" ||
      !ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])
    ) {
      throw new Error(
        `mimeType이 올바르지 않습니다. 허용 타입: ${ALLOWED_MIME_TYPES.join(", ")}`
      );
    }

    if (productDescription !== undefined && typeof productDescription !== "string") {
      throw new Error("productDescription은 문자열이어야 합니다.");
    }

    return {
      images: [{ imageBase64: cleanedBase64, mimeType }],
      productDescription: productDescription as string | undefined,
    };
  }

  // ── 다중 이미지 형식 (images 배열)
  const { images, productDescription } = raw;

  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("images 필드는 비어있지 않은 배열이어야 합니다.");
  }

  if (images.length > MAX_IMAGE_COUNT) {
    throw new Error(`이미지는 최대 ${MAX_IMAGE_COUNT}장까지 허용됩니다.`);
  }

  const validatedImages = images.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`images[${idx}]가 유효한 객체가 아닙니다.`);
    }

    const { imageBase64, mimeType } = item as Record<string, unknown>;

    if (typeof imageBase64 !== "string" || imageBase64.trim().length === 0) {
      throw new Error(`images[${idx}].imageBase64 필드는 비어있지 않은 문자열이어야 합니다.`);
    }

    const cleanedBase64 = stripDataUrlPrefix(imageBase64);

    if (cleanedBase64.length > MAX_BASE64_LENGTH) {
      throw new Error(`images[${idx}] 크기가 너무 큽니다. 10MB 이하의 이미지만 허용됩니다.`);
    }

    if (
      typeof mimeType !== "string" ||
      !ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])
    ) {
      throw new Error(
        `images[${idx}].mimeType이 올바르지 않습니다. 허용 타입: ${ALLOWED_MIME_TYPES.join(", ")}`
      );
    }

    return { imageBase64: cleanedBase64, mimeType };
  });

  if (productDescription !== undefined && typeof productDescription !== "string") {
    throw new Error("productDescription은 문자열이어야 합니다.");
  }

  return {
    images: validatedImages,
    productDescription: productDescription as string | undefined,
  };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    // 요청 바디 파싱
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
        { status: 400 }
      );
    }

    // 입력값 검증
    let input: AnalyzeImageInput;
    try {
      input = validateRequestBody(body);
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          error:
            validationError instanceof Error
              ? validationError.message
              : "입력값 검증 실패",
        },
        { status: 400 }
      );
    }

    // Claude Vision API 호출 (모든 이미지를 content 배열에 포함)
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            ...input.images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: img.imageBase64,
              },
            })),
            {
              type: "text" as const,
              text: input.productDescription
                ? `${IMAGE_ANALYSIS_PROMPT}\n\n[판매자 제품 설명]\n${input.productDescription}`
                : IMAGE_ANALYSIS_PROMPT,
            },
          ],
        },
      ],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const result = parseImageResponse(rawText);

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    console.error("[/api/ai/analyze-image] 처리 중 오류:", error);

    // 환경변수 누락 오류
    if (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { success: false, error: "서버 설정 오류: AI API 키가 구성되지 않았습니다." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "이미지 분석 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
