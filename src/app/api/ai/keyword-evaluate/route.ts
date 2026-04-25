import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { callClaude } from '@/lib/ai/claude-cli';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';

export interface EvaluateParams {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  topReviewCount?: number;
}

export interface EvaluateResult {
  pass: boolean | null;
  reasoning: string | null;
}

interface ApiSuccessResponse {
  success: true;
  data: EvaluateResult;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 키워드 소싱 전문가입니다.
셀러가 신규로 진입할 수 있는 키워드인지 판단합니다.

판단 기준 (네이버 쇼핑 기준):
- 경쟁 상품수 10만 이하: 틈새시장, 5만 이하: 유리
- 경쟁 상품수 50만 초과: 경쟁 심함, 100만 초과: 진입 매우 어려움
- 검색량 대비 경쟁수 비율(경쟁수/검색량): 10 이하면 유리, 50 초과면 불리
- 특정 브랜드명 포함(신일, LG, 삼성 등) 키워드는 진입 불가
- 경쟁 상품수 데이터가 없으면(null) 키워드명과 카테고리로 판단
- pass: true 기준 — 합리적으로 진입 가능성이 있으면 true, 명백히 불가능할 때만 false

반드시 JSON만 응답:
{"pass": true/false, "reasoning": "판단 근거 1~2문장"}`;

export async function evaluateKeyword(params: EvaluateParams): Promise<EvaluateResult> {
  const { keyword, searchVolume, competitorCount, topReviewCount } = params;
  const reviewLine = topReviewCount != null ? `상위 리뷰수: ${topReviewCount}` : '';
  const ccLine = competitorCount != null ? `경쟁 상품수: ${competitorCount.toLocaleString()}` : '경쟁 상품수: 데이터 없음 (키워드명과 카테고리로 판단)';
  const userPrompt = `키워드: ${keyword}
월 검색량: ${searchVolume.toLocaleString()}
${ccLine}${reviewLine ? `\n${reviewLine}` : ''}

이 키워드가 신규 셀러 진입에 적합한지 판단해주세요.`;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userPrompt, 'haiku', 256);
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.pass !== 'boolean' || typeof parsed.reasoning !== 'string') {
      return { pass: null, reasoning: null };
    }
    return { pass: parsed.pass, reasoning: parsed.reasoning };
  } catch {
    return { pass: null, reasoning: null };
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'keyword-evaluate'), RATE_LIMITS.AI_API);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const keyword = typeof b.keyword === 'string' ? b.keyword.trim() : '';
  const searchVolume = typeof b.searchVolume === 'number' ? b.searchVolume : null;
  const competitorCount = typeof b.competitorCount === 'number' ? b.competitorCount : null;
  const topReviewCount = typeof b.topReviewCount === 'number' ? b.topReviewCount : undefined;

  if (!keyword) {
    return NextResponse.json({ success: false, error: 'keyword가 필요합니다.' }, { status: 400 });
  }
  if (searchVolume === null) {
    return NextResponse.json({ success: false, error: 'searchVolume이 필요합니다.' }, { status: 400 });
  }
  if (competitorCount === null) {
    return NextResponse.json({ success: false, error: 'competitorCount가 필요합니다.' }, { status: 400 });
  }

  const result = await evaluateKeyword({ keyword, searchVolume, competitorCount, topReviewCount });
  return NextResponse.json({ success: true, data: result });
}
