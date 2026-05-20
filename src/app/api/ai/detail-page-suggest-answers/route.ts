/**
 * POST /api/ai/detail-page-suggest-answers
 *
 * 대화식 상세페이지 생성 모달이 열릴 때 1회 호출된다.
 * 이미지 + 상품명 + 카테고리를 보고 각 질문에 대한 칩 후보(3~4개)와
 * 추천 답변(첫 번째)을 JSON으로 반환한다.
 *
 * 디자인 문서: docs/superpowers/specs/2026-05-16-conversational-detail-page-design.md §5.1
 *
 * - 인증: requireAuth (JWT 쿠키)
 * - Rate Limit: 분당 5회 (Sonnet Vision 비용 보호)
 * - AI: claude-sonnet-4-6 (Vision), withRetry 래핑
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { fetchImagesFromUrls, resizeForClaude } from '@/lib/ai/claude-vision';
import { ALL_QUESTION_IDS } from '@/lib/conversational-detail/questions';
import type { ChipSuggestion } from '@/lib/conversational-detail/types';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

const SYSTEM_PROMPT = `당신은 한국 이커머스 마케팅 카피라이터입니다.
주어진 상품 이미지·상품명·카테고리를 분석해, 각 질문에 대한 답변 후보(칩) 3~4개를 JSON으로 제안하세요.

규칙:
- 각 후보는 한국어, 12자 이내 짧은 문구. 셀러가 클릭만 해도 의미가 통해야 합니다.
- 첫 번째 후보가 가장 추천하는 답변입니다.
- 동일 질문 내 후보들은 겹치지 않게 다양한 각도로 제시.
- 사진과 카테고리에서 도출되지 않는 추측은 금지.
- 응답은 JSON만 반환. 코드블록·설명 텍스트 금지.

출력 스키마:
{
  "suggestions": [
    { "questionId": "string", "chips": ["string", "string", "string"], "recommendedIndex": 0 }
  ]
}`;

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

export const RequestSchema = z.object({
  productName: z.string().min(1).max(200),
  category: z.enum(['basic', 'fashion', 'living', 'food'] as const),
  imageUrls: z.array(z.string().url()).min(1).max(6),
  questionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .refine((ids) => ids.every((id) => ALL_QUESTION_IDS.includes(id)), {
      message: 'questionIds에 정의되지 않은 ID가 포함되어 있습니다.',
    }),
});

type ApiSuccess = { success: true; data: { suggestions: ChipSuggestion[] } };
type ApiError = { success: false; error: string };

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

export function buildUserPrompt(
  productName: string,
  category: string,
  questionIds: string[],
): string {
  return [
    `상품명: ${productName}`,
    `카테고리: ${category}`,
    `\n답변 후보가 필요한 질문 ID들: ${questionIds.join(', ')}`,
    `\n위 이미지·상품명·카테고리를 분석하여 각 질문 ID에 대해 칩 후보를 JSON으로 반환하세요.`,
  ].join('\n');
}

export function extractJson(rawText: string): unknown {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  return JSON.parse(match[0]);
}

export function parseSuggestions(parsed: unknown, requestedIds: string[]): ChipSuggestion[] {
  const SuggestionSchema = z.object({
    suggestions: z.array(
      z.object({
        questionId: z.string(),
        chips: z.array(z.string().min(1).max(80)).min(2).max(6),
        recommendedIndex: z.number().int().min(0),
      }),
    ),
  });
  const result = SuggestionSchema.parse(parsed);

  // 요청한 questionId만 추리고, recommendedIndex 범위 보정
  const allowed = new Set(requestedIds);
  return result.suggestions
    .filter((s) => allowed.has(s.questionId))
    .map((s) => ({
      questionId: s.questionId,
      chips: s.chips.slice(0, 4),
      recommendedIndex: Math.min(s.recommendedIndex, s.chips.length - 1),
    }));
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccess | ApiError>> {
  // 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) {
    return auth as unknown as NextResponse<ApiError>;
  }

  // Rate Limit
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'detail-page-suggest-answers'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  // 바디 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        success: false,
        error: first ? `${first.path.join('.')}: ${first.message}` : '입력 검증 실패',
      },
      { status: 400 },
    );
  }

  const { productName, category, imageUrls, questionIds } = parsed.data;

  // 이미지 다운로드 + 사이즈 보정
  let safeImages;
  try {
    const downloaded = await fetchImagesFromUrls(imageUrls);
    safeImages = await Promise.all(
      downloaded.map((img) => resizeForClaude(img.imageBase64, img.mimeType)),
    );
  } catch (err) {
    console.error('[detail-page-suggest-answers] 이미지 처리 실패:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? `이미지 처리 실패: ${err.message}` : '이미지 처리 오류',
      },
      { status: 400 },
    );
  }

  // Claude Vision 호출
  let rawText: string;
  try {
    const client = getAnthropicClient();
    const response = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...safeImages.map((img) => ({
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: img.mimeType,
                    data: img.imageBase64,
                  },
                })),
                { type: 'text' as const, text: buildUserPrompt(productName, category, questionIds) },
              ],
            },
          ],
        }),
      { label: 'Claude detailPageSuggestAnswers' },
    );

    rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');
  } catch (err) {
    console.error('[detail-page-suggest-answers] Claude 호출 실패:', err);
    if (err instanceof Error && err.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: AI API 키가 없습니다.' },
        { status: 503 },
      );
    }
    if (err instanceof Error && err.message.includes('overloaded')) {
      return NextResponse.json(
        { success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다.' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'AI 호출 중 오류가 발생했습니다.',
      },
      { status: 502 },
    );
  }

  // JSON 파싱 + 검증
  let suggestions: ChipSuggestion[];
  try {
    const parsedJson = extractJson(rawText);
    suggestions = parseSuggestions(parsedJson, questionIds);
  } catch (err) {
    console.error('[detail-page-suggest-answers] 응답 파싱 실패:', err, rawText.slice(0, 200));
    return NextResponse.json(
      { success: false, error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, data: { suggestions } }, { status: 200 });
}
