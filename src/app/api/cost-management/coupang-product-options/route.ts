import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

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
    const productName = String(detail.sellerProductName ?? '');
    const rawItems = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

    const options = rawItems
      .map((i) => ({
        vendorItemId: Number(i.vendorItemId ?? 0),
        itemName: String(i.itemName ?? i.vendorItemName ?? ''),
        salePrice: Number(i.salePrice ?? i.originalPrice ?? 0),
      }))
      .filter((i) => i.vendorItemId > 0);

    // 현재 유저의 등록된 vendor_item_id 목록 조회 → alreadyAdded 마킹
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `SELECT vendor_item_id FROM product_costs WHERE user_id = $1`,
      [user.userId],
    );
    const existingIds = new Set(rows.map((r: Record<string, unknown>) => String(r.vendor_item_id)));

    const data = options.map((opt) => ({
      ...opt,
      alreadyAdded: existingIds.has(String(opt.vendorItemId)),
    }));

    return NextResponse.json({ success: true, productName, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
