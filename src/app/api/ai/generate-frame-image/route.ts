/**
 * POST /api/ai/generate-frame-image
 *
 * 프레임별 이미지 프롬프트를 Gemini Imagen 모델에 전달하여
 * AI 생성 이미지를 반환합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { generateFrameImage } from "@/lib/ai/imagen";

// ─────────────────────────────────────────
// Rate Limit 설정 (이미지 생성은 무거우므로 분당 10회)
// ─────────────────────────────────────────

const FRAME_IMAGE_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

// ─────────────────────────────────────────
// 프레임 타입 목록 (generate-frames와 동일한 13개)
// ─────────────────────────────────────────

const FRAME_TYPES = [
  "hero",
  "pain_point",
  "solution",
  "usp",
  "detail_1",
  "detail_2",
  "how_to_use",
  "before_after",
  "target",
  "spec",
  "faq",
  "social_proof",
  "cta",
] as const;

// ─────────────────────────────────────────
// 요청 바디 Zod 스키마
// ─────────────────────────────────────────

const RequestBodySchema = z.object({
  frameType: z.enum(FRAME_TYPES),
  imagePrompt: z.string().min(10).max(500),
  productImageBase64: z.string().optional(),
  productImageMimeType: z
    .enum(["image/jpeg", "image/png", "image/webp"])
    .optional(),
});

type RequestBody = z.infer<typeof RequestBodySchema>;

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  data: { imageBase64: string; mimeType: string };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    // 인증 검사
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult as unknown as NextResponse<ApiErrorResponse>;
    }

    // Rate Limit 검사
    const ip =
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const rateLimitResult = checkRateLimit(
      getRateLimitKey(ip, "generate-frame-image"),
      FRAME_IMAGE_RATE_LIMIT
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Reset": rateLimitResult.resetAt.toString(),
          },
        }
      );
    }

    // 요청 바디 파싱
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
        { status: 400 }
      );
    }

    // Zod 검증
    const parseResult = RequestBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      const messages = parseResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" | ");
      return NextResponse.json(
        { success: false, error: `입력값 검증 실패: ${messages}` },
        { status: 400 }
      );
    }

    const body: RequestBody = parseResult.data;

    // productImageBase64만 있고 productImageMimeType이 없으면 400
    if (body.productImageBase64 && !body.productImageMimeType) {
      return NextResponse.json(
        {
          success: false,
          error:
            "productImageBase64를 전송할 때는 productImageMimeType도 함께 제공해야 합니다.",
        },
        { status: 400 }
      );
    }

    // Gemini Imagen 호출
    const result = await generateFrameImage({
      imagePrompt: body.imagePrompt,
      productImageBase64: body.productImageBase64,
      productImageMimeType: body.productImageMimeType,
    });

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    console.error("[/api/ai/generate-frame-image] 처리 중 오류:", error);

    if (
      error instanceof Error &&
      error.message.includes("GOOGLE_AI_API_KEY")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "서버 설정 오류: AI API 키가 구성되지 않았습니다.",
        },
        { status: 503 }
      );
    }

    if (
      error instanceof Error &&
      (error.message.includes("overloaded") ||
        error.message.includes("quota") ||
        error.message.includes("RESOURCE_EXHAUSTED"))
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "이미지 생성 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
