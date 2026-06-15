import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { evaluateKeyword } from './utils';
import type { EvaluateResult } from './utils';

// 테스트 및 외부에서 헬퍼를 라우트 모듈을 통해 참조할 수 있도록 재노출 (정의는 ./utils 단일)
export { evaluateKeyword } from './utils';

interface ApiSuccessResponse {
  success: true;
  data: EvaluateResult;
}

interface ApiErrorResponse {
  success: false;
  error: string;
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
