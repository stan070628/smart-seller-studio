import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// POST /api/cost-management/products/group
// vendorItemIds 목록의 상품들을 sellerProductId로 그룹핑
// Body: { sellerProductId: number, vendorItemIds: number[] }
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { sellerProductId, vendorItemIds } = body ?? {};

  if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) {
    return NextResponse.json({ success: false, error: 'sellerProductId must be a positive integer' }, { status: 400 });
  }
  if (!Array.isArray(vendorItemIds) || vendorItemIds.length === 0) {
    return NextResponse.json({ success: false, error: 'vendorItemIds must be a non-empty array' }, { status: 400 });
  }
  if (!vendorItemIds.every((id) => Number.isInteger(id) && id > 0)) {
    return NextResponse.json({ success: false, error: 'All vendorItemIds must be positive integers' }, { status: 400 });
  }

  const pool = getSourcingPool();
  try {
    const placeholders = vendorItemIds.map((_, i) => `$${i + 3}`).join(', ');
    const { rowCount, rows } = await pool.query(
      `UPDATE product_costs
       SET seller_product_id = $1
       WHERE user_id = $2 AND vendor_item_id IN (${placeholders})
       RETURNING id, product_name, vendor_item_id, seller_product_id`,
      [sellerProductId, user.userId, ...vendorItemIds],
    );

    return NextResponse.json({
      success: true,
      data: { updated: rowCount ?? 0, products: rows },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
