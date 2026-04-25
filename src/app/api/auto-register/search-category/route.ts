/**
 * GET /api/auto-register/search-category?keyword=유리발수코팅제
 *
 * 쿠팡 카테고리 트리에서 keyword를 포함하는 카테고리를 검색합니다.
 * getCoupangClient().searchCategories() 사용 (전체 트리 5분 캐시).
 *
 * Response (200):
 *   { "categories": [{ displayCategoryCode, displayCategoryName, fullPath }] }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return NextResponse.json(
    { error: '인증이 필요합니다.' },
    { status: 401 },
  );

  const keyword = req.nextUrl.searchParams.get('keyword')?.trim() ?? '';
  if (!keyword) {
    return NextResponse.json({ error: 'keyword가 필요합니다.' }, { status: 400 });
  }

  try {
    const categories = await getCoupangClient().searchCategories(keyword);
    return NextResponse.json({ categories });
  } catch (err) {
    console.error('[search-category] 실패:', err);
    return NextResponse.json({ categories: [] });
  }
}
