import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { getKeywordStats } from '@/lib/naver-ad';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
}

interface ApiSuccessResponse {
  success: true;
  data: { keywords: SuggestedKeyword[] };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─── 응답 파서 (export — 테스트용) ───────────────────────────────────────────

export function parseKeywordSuggestResponse(raw: string): { keyword: string; reason: string }[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter(
      (k: unknown): k is { keyword: string; reason: string } =>
        typeof k === 'object' &&
        k !== null &&
        typeof (k as Record<string, unknown>).keyword === 'string' &&
        typeof (k as Record<string, unknown>).reason === 'string',
    );
  } catch {
    return [];
  }
}

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰(네이버 스마트스토어, 쿠팡) 상품 키워드 전문가입니다.

셀러 전략 기준:
- 월 검색량: 3,000 ~ 30,000 (너무 크면 레드오션, 너무 작으면 수요 없음)
- 경쟁 상품 수: 500개 미만 (틈새시장)
- 상위 상품 리뷰 수: 50개 미만 (신규 진입 가능)
- 가격대: 8,000원 ~ 50,000원
- 소형 상품, 연중 수요 안정, 브랜드 로열티 낮은 카테고리

키워드 작성 원칙:
- 2~3단어 조합 키워드 (예: "방수 백팩", "캠핑 의자 경량")
- 4단어 이상의 지나치게 구체적인 조합은 검색량이 너무 낮으므로 지양
- 대형 브랜드 의존도 낮은 카테고리
- 실제 네이버/쿠팡 검색창에 입력할 법한 표현

반드시 JSON만 응답하세요. 다른 텍스트 없이:
{"keywords": [{"keyword": "키워드", "reason": "추천 이유 1~2문장"}]}`;

function buildUserPrompt(hint?: string): string {
  const hintLine = hint ? `카테고리/시즌 힌트: ${hint}\n\n` : '';
  return `${hintLine}위 전략 기준에 맞는 한국 온라인 쇼핑몰 상품 키워드 15개를 추천해주세요.`;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'keyword-suggest'), RATE_LIMITS.AI_API);
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
    body = {};
  }

  const hint =
    typeof (body as Record<string, unknown>).hint === 'string'
      ? ((body as Record<string, unknown>).hint as string).trim().slice(0, 100) || undefined
      : undefined;

  // 1단계: Claude 키워드 생성
  const client = getAnthropicClient();
  let rawText: string;
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(hint) }],
    });
    rawText = response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (error) {
    console.error('[keyword-suggest] Claude API error', error);
    return NextResponse.json(
      { success: false, error: '키워드 추천 중 오류가 발생했습니다.' },
      { status: 502 },
    );
  }

  const baseKeywords = parseKeywordSuggestResponse(rawText);
  if (baseKeywords.length === 0) {
    return NextResponse.json(
      { success: false, error: 'AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.' },
      { status: 502 },
    );
  }

  // 2단계: 네이버 API로 실데이터 조회 (실패해도 graceful degradation)
  const statsMap = new Map<string, { searchVolume: number | null; competitorCount: number | null }>();
  try {
    const stats = await getKeywordStats(baseKeywords.map((k) => k.keyword));
    for (const s of stats) {
      statsMap.set(s.keyword, { searchVolume: s.searchVolume, competitorCount: s.competitorCount });
    }
  } catch {
    // graceful degradation: 수치 없이 키워드만 반환
  }

  const keywords: SuggestedKeyword[] = baseKeywords.map((k) => {
    const stats = statsMap.get(k.keyword);
    return {
      keyword: k.keyword,
      reason: k.reason,
      searchVolume: stats?.searchVolume ?? null,
      competitorCount: stats?.competitorCount ?? null,
    };
  });

  return NextResponse.json({ success: true, data: { keywords } });
}
