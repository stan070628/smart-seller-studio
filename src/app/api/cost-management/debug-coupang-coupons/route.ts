import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

/**
 * GET /api/cost-management/debug-coupang-coupons?sellerProductId=16182237839
 *
 * 쿠팡 쿠폰 API 응답 구조 확인용 디버그 엔드포인트.
 * 다운로드쿠폰 정책(할인율/최대/최소) 자동완성 가능 여부를 검증한다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const sellerProductId = request.nextUrl.searchParams.get('sellerProductId');

  const client = getCoupangClient();

  try {
    const data = await client.getVendorCoupons();
    const filtered = sellerProductId
      ? data.filter((c) => c.promotionName.toLowerCase().includes(sellerProductId.slice(0, 6)))
      : data;
    return NextResponse.json({ success: true, raw: filtered, total: data.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ success: false, error: msg, stack }, { status: 200 });
  }
}
