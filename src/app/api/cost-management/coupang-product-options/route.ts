import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// GET /api/cost-management/coupang-product-options?sellerProductId=12345678
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const sellerProductId = Number(request.nextUrl.searchParams.get('sellerProductId'));
  if (!sellerProductId || sellerProductId <= 0) {
    return NextResponse.json({ success: false, error: 'sellerProductId required' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const detail = await client.getProductDetail(sellerProductId) as Record<string, unknown>;
    const rawItems = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

    const items = rawItems
      .map((i) => ({
        vendorItemId: Number(i.vendorItemId ?? 0),
        itemName: String(i.itemName ?? i.vendorItemName ?? ''),
        salePrice: Number(i.salePrice ?? i.originalPrice ?? 0),
      }))
      .filter((i) => i.vendorItemId > 0);

    return NextResponse.json({ success: true, data: items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
