/**
 * POST /api/ai/detail-page-delegate-answer
 *
 * 대화식 상세페이지 생성 모달에서 사용자가 `🤖 AI에게 맡기기` 칩을 누를 때
 * 단일 항목에 대한 답변을 Haiku로 결정한다. 텍스트 전용, 가볍고 빠름.
 *
 * 디자인 문서: docs/superpowers/specs/2026-05-16-conversational-detail-page-design.md §5.2
 *
 * - 인증: requireAuth
 * - Rate Limit: 분당 20회
 * - AI: claude-haiku-4-5 (callClaude 헬퍼)
 */

import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai/claude-cli';
import { withRetry } from '@/lib/ai/resilience';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { RequestSchema, buildUserPrompt, extractValue } from './utils';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const SYSTEM_PROMPT = `당신은 한국 이커머스 마케팅 카피라이터입니다.
주어진 상품 정보·카테고리·앞선 답변을 종합해, 단일 마케팅 브리프 질문에 대한 가장 적합한 한국어 답변을 한 줄로 결정하세요.

규칙:
- 답변은 한국어, 30자 이내. 셀러가 모달에서 그대로 표시될 수 있는 짧은 문구.
- 추측·과장 금지. 카테고리와 앞선 답변과의 일관성 유지.
- 응답은 JSON만 반환. 코드블록·설명 텍스트 금지.

출력 스키마:
{ "value": "string" }`;

type ApiSuccess = { success: true; data: { value: string } };
type ApiError = { success: false; error: string };

export async function POST(request: NextRequest): Promise<NextResponse<ApiSuccess | ApiError>> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) {
    return auth as unknown as NextResponse<ApiError>;
  }

  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'detail-page-delegate-answer'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

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

  const { productName, category, questionId, questionText, previousAnswers } = parsed.data;

  let rawText: string;
  try {
    rawText = await withRetry(
      () =>
        callClaude(
          SYSTEM_PROMPT,
          buildUserPrompt(productName, category, questionId, questionText, previousAnswers),
          'haiku',
          400,
        ),
      { label: 'Claude detailPageDelegateAnswer' },
    );
  } catch (err) {
    console.error('[detail-page-delegate-answer] Claude 호출 실패:', err);
    if (err instanceof Error && err.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: AI API 키가 없습니다.' },
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

  let value: string;
  try {
    value = extractValue(rawText);
  } catch (err) {
    console.error('[detail-page-delegate-answer] 응답 파싱 실패:', err, rawText.slice(0, 200));
    return NextResponse.json(
      { success: false, error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, data: { value } }, { status: 200 });
}
