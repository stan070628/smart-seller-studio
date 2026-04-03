/**
 * POST /api/ai/generate-copy
 *
 * 프론트에서 전달받은 쿠팡 고객 리뷰 텍스트 배열을
 * Claude 3.5 Sonnet으로 분석하여 카피, 제목, 셀링 포인트를 생성합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateCopyFromReviews } from "@/lib/ai/claude";
import type { GenerateCopyInput, GenerateCopyOutput } from "@/lib/ai/claude";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

// ─────────────────────────────────────────
// 요청/응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  data: GenerateCopyOutput;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// 요청 바디 검증
// ─────────────────────────────────────────

function validateRequestBody(body: unknown): GenerateCopyInput {
  if (!body || typeof body !== "object") {
    throw new Error("요청 바디가 유효한 JSON 객체가 아닙니다.");
  }

  const { reviews, productName } = body as Record<string, unknown>;

  // reviews 검증: 비어있지 않은 문자열 배열
  if (!Array.isArray(reviews) || reviews.length === 0) {
    throw new Error("reviews 필드는 비어있지 않은 배열이어야 합니다.");
  }

  if (!reviews.every((r) => typeof r === "string" && r.trim().length > 0)) {
    throw new Error("reviews 배열의 모든 요소는 비어있지 않은 문자열이어야 합니다.");
  }

  // 최대 리뷰 수 제한 (토큰 초과 방지)
  if (reviews.length > 50) {
    throw new Error("reviews는 최대 50개까지 허용됩니다.");
  }

  // productName 검증: 선택 필드
  if (productName !== undefined && typeof productName !== "string") {
    throw new Error("productName은 문자열이어야 합니다.");
  }

  return {
    reviews: reviews as string[],
    productName: productName as string | undefined,
  };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    // Rate Limit 검사
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
    const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'generate-copy'), RATE_LIMITS.AI_API)
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        {
          status: 429,
          headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() }
        }
      )
    }

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
    let input: GenerateCopyInput;
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

    // Claude API 호출
    const result = await generateCopyFromReviews(input);

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    console.error("[/api/ai/generate-copy] 처리 중 오류:", error);

    // 환경변수 누락 오류
    if (
      error instanceof Error &&
      error.message.includes("ANTHROPIC_API_KEY")
    ) {
      return NextResponse.json(
        { success: false, error: "서버 설정 오류: AI API 키가 구성되지 않았습니다." },
        { status: 503 }
      );
    }

    // Anthropic API 오류 (rate limit, overload 등)
    if (error instanceof Error && error.message.includes("overloaded")) {
      return NextResponse.json(
        { success: false, error: "AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "카피 생성 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
