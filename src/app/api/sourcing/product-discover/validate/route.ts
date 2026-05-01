/**
 * POST /api/sourcing/product-discover/validate
 * 키워드 셋 → 검색량/CTR/경쟁상품수 검증
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { validateKeywords } from '@/lib/sourcing/product-discovery-pipeline';

const requestSchema = z.object({
  keywords: z.array(z.string().min(1).max(40)).min(1).max(15),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '키워드 1~15개가 필요합니다' }, { status: 400 });
  }

  const hasNaverAdKeys = !!(
    process.env.NAVER_AD_API_KEY &&
    process.env.NAVER_AD_SECRET_KEY &&
    process.env.NAVER_AD_CUSTOMER_ID
  );
  if (!hasNaverAdKeys) {
    return NextResponse.json(
      { success: false, error: 'Naver Ad API 키가 서버에 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    const results = await validateKeywords({ keywords: parsed.data.keywords });
    return NextResponse.json({ success: true, data: { results } });
  } catch (err) {
    console.error('[POST /validate]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
}
