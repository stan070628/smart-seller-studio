/**
 * POST /api/ai/generate-frames
 *
 * 상품 리뷰 + 이미지 분석 결과를 Claude API에 전달하여
 * 13개 프레임 상세페이지 카피를 일괄 생성합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { FRAME_SYSTEM_PROMPT, buildFrameUserPrompt, type FrameUserPromptParams } from '@/lib/ai/prompts/frame-generation';
import { parseFrameGenerationResponse } from '@/lib/ai/prompts/frame-generation.schema';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';
import type { GeneratedFrame } from '@/types/frames';
import { withRetry } from '@/lib/ai/resilience';

// ─────────────────────────────────────────
// Rate Limit 설정 (AI 호출이 무거우므로 엄격하게)
// ─────────────────────────────────────────

const FRAMES_RATE_LIMIT = { windowMs: 60_000, maxRequests: 3 };

// ─────────────────────────────────────────
// 요청/응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  data: { frames: GeneratedFrame[] };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// 요청 바디 검증
// ─────────────────────────────────────────

function validateRequestBody(body: unknown): FrameUserPromptParams {
  if (!body || typeof body !== 'object') {
    throw new Error('요청 바디가 유효한 JSON 객체가 아닙니다.');
  }

  const { reviews, productName, imageAnalysis, productDescription, productExtract } = body as Record<string, unknown>;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    throw new Error('reviews 필드는 비어있지 않은 배열이어야 합니다.');
  }

  if (!reviews.every((r) => typeof r === 'string' && r.trim().length > 0)) {
    throw new Error('reviews 배열의 모든 요소는 비어있지 않은 문자열이어야 합니다.');
  }

  if (reviews.length > 50) {
    throw new Error('reviews는 최대 50개까지 허용됩니다.');
  }

  if (productName !== undefined && typeof productName !== 'string') {
    throw new Error('productName은 문자열이어야 합니다.');
  }

  if (productDescription !== undefined && typeof productDescription !== 'string') {
    throw new Error('productDescription은 문자열이어야 합니다.');
  }

  return {
    reviews: reviews as string[],
    productName: productName as string | undefined,
    productDescription: productDescription as string | undefined,
    imageAnalysis: imageAnalysis as FrameUserPromptParams['imageAnalysis'],
    productExtract: productExtract as FrameUserPromptParams['productExtract'],
  };
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
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
    const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'generate-frames'), FRAMES_RATE_LIMIT);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        {
          status: 429,
          headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
        }
      );
    }

    // 요청 바디 파싱
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
        { status: 400 }
      );
    }

    // 입력값 검증
    let input: FrameUserPromptParams;
    try {
      input = validateRequestBody(body);
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          error: validationError instanceof Error ? validationError.message : '입력값 검증 실패',
        },
        { status: 400 }
      );
    }

    // Claude API 호출
    const client = getAnthropicClient();
    const userMessage = buildFrameUserPrompt(input);

    const response = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 16384,
          system: FRAME_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'Claude generateFrames' }
    );

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const frames = parseFrameGenerationResponse(rawText);

    return NextResponse.json({ success: true, data: { frames } }, { status: 200 });
  } catch (error) {
    console.error('[/api/ai/generate-frames] 처리 중 오류:', error);

    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: AI API 키가 구성되지 않았습니다.' },
        { status: 503 }
      );
    }

    if (error instanceof Error && error.message.includes('overloaded')) {
      return NextResponse.json(
        { success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '프레임 카피 생성 중 알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
