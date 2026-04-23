import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expandKeywords } from '@/lib/naver-ad';
import { evaluateKeyword } from '@/app/api/ai/keyword-evaluate/route';

// 씨드가 없을 때 사용하는 폴백 씨드 목록
const FALLBACK_SEEDS = ['주방용품', '생활용품', '청소용품', '반려동물', '캠핑용품'];

// 필터 기준값
const MIN_SEARCH_VOLUME = 2_000;
const MAX_SEARCH_VOLUME = 50_000;
const MAX_COMPETITOR_COUNT = 500;
const MAX_EVALUATE = 30;

export interface DiscoveredKeyword {
  keyword: string;
  searchVolume: number;
  competitorCount: number;
  pass: boolean | null;
  reasoning: string | null;
}

interface ApiSuccessResponse {
  success: true;
  data: { keywords: DiscoveredKeyword[]; seedCount: number };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse> | Response> {
  // 1. 인증 검증
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  // 2. Rate Limit 검사
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, 'keyword-discover'),
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

  // 3. 오늘(KST) 씨드 조회
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = kstNow.toISOString().slice(0, 10);

  let seeds: string[];
  try {
    const pool = getSourcingPool();
    const result = await pool.query<{ keyword: string }>(
      `SELECT keyword FROM trend_seeds WHERE seed_date = $1 ORDER BY id`,
      [today],
    );
    seeds = result.rows.map((r) => r.keyword);
  } catch {
    seeds = [];
  }

  // 씨드가 없으면 폴백 씨드 사용
  if (seeds.length === 0) {
    seeds = FALLBACK_SEEDS;
  }

  // 4. 씨드 기반 키워드 확장
  let expanded: Awaited<ReturnType<typeof expandKeywords>>;
  try {
    expanded = await expandKeywords(seeds);
  } catch {
    expanded = [];
  }

  // 5. 검색량·경쟁상품수 필터 + 검색량 내림차순 정렬 + 상위 30개 추출
  const filtered = expanded
    .filter(
      (k) =>
        k.searchVolume !== null &&
        k.competitorCount !== null &&
        k.searchVolume >= MIN_SEARCH_VOLUME &&
        k.searchVolume <= MAX_SEARCH_VOLUME &&
        k.competitorCount < MAX_COMPETITOR_COUNT,
    )
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, MAX_EVALUATE);

  // 6. AI 신규 셀러 진입 가능성 평가
  const evaluated = await Promise.all(
    filtered.map(async (k): Promise<DiscoveredKeyword> => {
      try {
        const result = await evaluateKeyword({
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
        });
        return {
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
          pass: result.pass,
          reasoning: result.reasoning,
        };
      } catch {
        return {
          keyword: k.keyword,
          searchVolume: k.searchVolume!,
          competitorCount: k.competitorCount!,
          pass: null,
          reasoning: null,
        };
      }
    }),
  );

  return NextResponse.json({
    success: true,
    data: { keywords: evaluated, seedCount: seeds.length },
  });
}
