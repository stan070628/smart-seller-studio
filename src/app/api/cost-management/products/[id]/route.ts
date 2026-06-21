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
  const { seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, channel_type, external_id, download_coupon_policy } = body ?? {};

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
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return NextResponse.json({ success: false, error: 'hidden must be a boolean' }, { status: 400 });
  }
  if (download_coupon_policy !== undefined && download_coupon_policy !== null) {
    const p = download_coupon_policy as Record<string, unknown>;
    if (
      typeof p.rate !== 'number' || p.rate <= 0 || p.rate > 1 ||
      typeof p.max_discount !== 'number' || p.max_discount <= 0 ||
      typeof p.min_price !== 'number' || p.min_price < 0
    ) {
      return NextResponse.json(
        { success: false, error: 'download_coupon_policy: {rate(0<r≤1), max_discount(>0), min_price(≥0)} 필요' },
        { status: 400 },
      );
    }
  }
  if (channel_type !== undefined) {
    const VALID_CHANNEL_TYPES = ['coupang_rg', 'coupang_wing', 'naver'];
    if (!VALID_CHANNEL_TYPES.includes(channel_type)) {
      return NextResponse.json(
        { success: false, error: `channel_type must be one of: ${VALID_CHANNEL_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    if (external_id !== undefined && (!Number.isInteger(external_id) || external_id <= 0)) {
      return NextResponse.json(
        { success: false, error: 'external_id must be a positive integer' },
        { status: 400 },
      );
    }
  }

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `UPDATE product_costs
       SET seller_product_id          = COALESCE($3, seller_product_id),
           vendor_item_id             = COALESCE($4, vendor_item_id),
           naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
           variants                   = COALESCE($6, variants),
           hidden                     = COALESCE($7, hidden),
           download_coupon_policy     = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE download_coupon_policy END
       WHERE id = $1 AND user_id = $2
       RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, download_coupon_policy`,
      [
        id, user.userId,
        seller_product_id ?? null,
        vendor_item_id ?? null,
        naver_channel_product_no ?? null,
        variants ? JSON.stringify(variants) : null,
        hidden === undefined ? null : hidden,
        download_coupon_policy !== undefined ? JSON.stringify(download_coupon_policy) : null,
      ],
    );
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    // channel_type + external_id 있으면 product_cost_channels upsert
    if (channel_type !== undefined && external_id !== undefined) {
      await pool.query(
        `INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
           SET product_cost_id = EXCLUDED.product_cost_id`,
        [user.userId, id, channel_type, external_id],
      );
    }

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
