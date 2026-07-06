import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// PATCH /api/cost-management/sales/[id]
// 특정 판매 내역의 날짜·수량·판매가를 부분 수정한다 (COALESCE 방식).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { sold_at, quantity, selling_price, shipping_fee, coupon_discount, channel } = body ?? {};

  // 제공된 필드만 개별 검증 (부분 업데이트 허용)
  if (sold_at !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(sold_at)) {
    return NextResponse.json(
      { success: false, error: 'sold_at must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    return NextResponse.json(
      { success: false, error: 'quantity must be positive integer' },
      { status: 400 },
    );
  }
  if (selling_price !== undefined && (!Number.isInteger(selling_price) || selling_price < 0)) {
    return NextResponse.json(
      { success: false, error: 'selling_price must be non-negative integer' },
      { status: 400 },
    );
  }
  if (shipping_fee !== undefined && (!Number.isInteger(shipping_fee) || shipping_fee < 0)) {
    return NextResponse.json(
      { success: false, error: 'shipping_fee must be non-negative integer' },
      { status: 400 },
    );
  }
  if (coupon_discount !== undefined && (!Number.isInteger(coupon_discount) || coupon_discount < 0)) {
    return NextResponse.json(
      { success: false, error: 'coupon_discount must be non-negative integer' },
      { status: 400 },
    );
  }
  const ALLOWED_CHANNELS = ['manual', 'coupang', 'rocket_growth', 'naver'];
  if (channel !== undefined && !ALLOWED_CHANNELS.includes(channel)) {
    return NextResponse.json(
      { success: false, error: 'invalid channel' },
      { status: 400 },
    );
  }
  // 최소 한 필드 이상 필요
  if (sold_at === undefined && quantity === undefined && selling_price === undefined && shipping_fee === undefined && coupon_discount === undefined && channel === undefined) {
    return NextResponse.json(
      { success: false, error: 'at least one field required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();

  try {
    // user_id 조건으로 타 유저 데이터 수정 차단, COALESCE로 미제공 필드는 기존 값 유지
    const { rows } = await pool.query(
      `UPDATE sale_records
       SET sold_at         = COALESCE($1, sold_at),
           quantity        = COALESCE($2, quantity),
           selling_price   = COALESCE($3, selling_price),
           shipping_fee    = COALESCE($4, shipping_fee),
           coupon_discount = COALESCE($5, coupon_discount),
           channel         = COALESCE($6, channel)
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [sold_at ?? null, quantity ?? null, selling_price ?? null, shipping_fee ?? null, coupon_discount ?? null, channel ?? null, id, user.userId],
    );

    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE /api/cost-management/sales/[id]
// 특정 판매 내역을 삭제한다.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    // user_id 조건으로 타 유저 데이터 삭제 차단
    const { rows } = await pool.query(
      `DELETE FROM sale_records WHERE id=$1 AND user_id=$2 RETURNING id`,
      [id, user.userId],
    );

    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
