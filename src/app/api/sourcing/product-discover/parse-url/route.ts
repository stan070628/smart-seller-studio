/**
 * POST /api/sourcing/product-discover/parse-url
 * 도매꾹 URL → ProductInfo (이름, 이미지, 가격)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseDomeggookUrl } from '@/lib/sourcing/domeggook-url-parser';

const requestSchema = z.object({
  url: z.string().url(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'URL이 올바르지 않습니다' }, { status: 400 });
  }

  const productInfo = await parseDomeggookUrl(parsed.data.url);
  if (!productInfo) {
    return NextResponse.json(
      { success: false, error: '지원하지 않는 URL이거나 도매꾹에서 상품 정보를 가져올 수 없습니다' },
      { status: 422 },
    );
  }

  return NextResponse.json({ success: true, data: productInfo });
}
