/**
 * POST /api/ai/regenerate-prompt
 *
 * 단일 프레임의 현재 텍스트를 받아 imagePrompt만 새로 생성합니다.
 * 텍스트 수정 후 프롬프트가 outdated 상태가 됐을 때 프론트에서 호출합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';

// ─────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────

const REGENERATE_PROMPT_SYSTEM = `You are an expert at writing image generation prompts for e-commerce product detail pages.
Given a frame's text content, generate a concise English prompt for AI image generation.
The prompt should describe the visual scene, lighting, composition, and mood that best matches the text.
If an imageDirection is provided, you MUST treat it as the primary creative direction and prioritize it above all other inputs when crafting the prompt. The imageDirection represents the art director's explicit instruction and should strongly shape the visual description.
Output ONLY the prompt text, no JSON, no markdown, no explanation.
Keep it under 200 characters.`;

// ─────────────────────────────────────────
// 요청/응답 타입
// ─────────────────────────────────────────

interface RegeneratePromptRequest {
  frameType: string;
  headline: string;
  subheadline?: string;
  bodyText?: string;
  imageDirection?: string;
}

interface ApiSuccessResponse {
  success: true;
  data: { imagePrompt: string };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// 요청 바디 검증
// ─────────────────────────────────────────

function validateRequestBody(body: unknown): RegeneratePromptRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('요청 바디가 유효한 JSON 객체가 아닙니다.');
  }

  const { frameType, headline, subheadline, bodyText, imageDirection } =
    body as Record<string, unknown>;

  if (!frameType || typeof frameType !== 'string') {
    throw new Error('frameType은 비어있지 않은 문자열이어야 합니다.');
  }

  if (headline !== undefined && typeof headline !== 'string') {
    throw new Error('headline은 문자열이어야 합니다.');
  }

  if (subheadline !== undefined && typeof subheadline !== 'string') {
    throw new Error('subheadline은 문자열이어야 합니다.');
  }

  if (bodyText !== undefined && typeof bodyText !== 'string') {
    throw new Error('bodyText는 문자열이어야 합니다.');
  }

  if (imageDirection !== undefined && typeof imageDirection !== 'string') {
    throw new Error('imageDirection은 문자열이어야 합니다.');
  }

  return {
    frameType,
    headline: (headline as string) ?? '',
    subheadline: subheadline as string | undefined,
    bodyText: bodyText as string | undefined,
    imageDirection: imageDirection as string | undefined,
  };
}

// ─────────────────────────────────────────
// 유저 프롬프트 빌더
// ─────────────────────────────────────────

function buildUserPrompt(input: RegeneratePromptRequest): string {
  const lines: string[] = [
    `Frame type: ${input.frameType}`,
    `Headline: ${input.headline}`,
  ];

  if (input.subheadline) {
    lines.push(`Subheadline: ${input.subheadline}`);
  }

  if (input.bodyText) {
    lines.push(`Body text: ${input.bodyText}`);
  }

  if (input.imageDirection) {
    lines.push(`Image direction (PRIMARY — follow this closely): ${input.imageDirection}`);
  }

  lines.push('');
  if (input.imageDirection) {
    lines.push('Generate an image generation prompt. The imageDirection above is the top priority creative instruction — reflect it faithfully in the prompt.');
  } else {
    lines.push('Generate an image generation prompt that visually represents this frame content.');
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    // Rate Limit 검사 (분당 10회)
    const ip =
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const rateLimitResult = checkRateLimit(
      getRateLimitKey(ip, 'regenerate-prompt'),
      RATE_LIMITS.AI_API,
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        {
          status: 429,
          headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
        },
      );
    }

    // 요청 바디 파싱
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
        { status: 400 },
      );
    }

    // 입력값 검증
    let input: RegeneratePromptRequest;
    try {
      input = validateRequestBody(body);
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          error:
            validationError instanceof Error ? validationError.message : '입력값 검증 실패',
        },
        { status: 400 },
      );
    }

    // Claude API 호출
    const client = getAnthropicClient();
    const userMessage = buildUserPrompt(input);

    const response = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 256,
          system: REGENERATE_PROMPT_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'Claude regeneratePrompt' },
    );

    const imagePrompt = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('')
      .trim();

    if (!imagePrompt) {
      return NextResponse.json(
        { success: false, error: 'AI가 프롬프트를 생성하지 못했습니다.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: { imagePrompt } }, { status: 200 });
  } catch (error) {
    console.error('[/api/ai/regenerate-prompt] 처리 중 오류:', error);

    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: AI API 키가 구성되지 않았습니다.' },
        { status: 503 },
      );
    }

    if (error instanceof Error && error.message.includes('overloaded')) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.',
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : '프롬프트 재생성 중 알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}
