import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// PATCH /api/cost-management/products/[id]
// seller_product_id, vendor_item_id 수정 (채널 연결)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { seller_product_id, vendor_item_id, naver_channel_product_no, variants } = body ?? {};

  if (seller_product_id !== undefined && seller_product_id !== null) {
    if (!Number.isInteger(seller_product_id) || seller_product_id <= 0) {
      return NextResponse.json({ success: false, error: 'seller_product_id must be a positive integer' }, { status: 400 });
    }
  }
  if (vendor_item_id !== undefined && vendor_item_id !== null) {
    if (!Number.isInteger(vendor_item_id) || vendor_item_id <= 0) {
      return NextResponse.json({ success: false, error: 'vendor_item_id must be a positive integer' }, { status: 400 });
    }
  }
  if (naver_channel_product_no !== undefined && naver_channel_product_no !== null) {
    if (!Number.isInteger(naver_channel_product_no) || naver_channel_product_no <= 0) {
      return NextResponse.json({ success: false, error: 'naver_channel_product_no must be a positive integer' }, { status: 400 });
    }
  }

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `UPDATE product_costs
       SET seller_product_id          = COALESCE($3, seller_product_id),
           vendor_item_id             = COALESCE($4, vendor_item_id),
           naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
           variants                   = COALESCE($6, variants)
       WHERE id = $1 AND user_id = $2
       RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants`,
      [id, user.userId, seller_product_id ?? null, vendor_item_id ?? null, naver_channel_product_no ?? null, variants ? JSON.stringify(variants) : null],
    );
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/cost-management/products/[id]
// 상품과 연결된 cost_entries를 CASCADE 삭제한다.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );

    if (rowCount === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
