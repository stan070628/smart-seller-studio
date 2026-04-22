import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getKeywordStats, type KeywordStat } from '@/lib/naver-ad';

interface ApiSuccessResponse {
  success: true;
  data: { stats: KeywordStat[] };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult as never;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const keywords = (body as Record<string, unknown>).keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ success: false, error: 'keywords 배열이 필요합니다.' }, { status: 400 });
  }
  if (keywords.length > 50) {
    return NextResponse.json({ success: false, error: 'keywords는 50개 이하여야 합니다.' }, { status: 400 });
  }

  const validKeywords = keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);

  try {
    const stats = await getKeywordStats(validKeywords);
    return NextResponse.json({ success: true, data: { stats } });
  } catch (error) {
    console.error('[keyword-stats]', error);
    return NextResponse.json({ success: false, error: '키워드 통계 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
