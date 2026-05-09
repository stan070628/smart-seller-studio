import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// PATCH /api/cost-management/sales/[id]
// 특정 판매 내역의 날짜·수량·판매가를 수정한다.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { sold_at, quantity, selling_price } = body ?? {};

  // 입력값 유효성 검증: sold_at 필수, quantity 양의 정수, selling_price 0 이상 정수
  if (
    !sold_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    selling_price == null || !Number.isInteger(selling_price) || selling_price < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'sold_at, quantity(>0), selling_price(>=0) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();

  // user_id 조건으로 타 유저 데이터 수정 차단
  const { rows } = await pool.query(
    `UPDATE sale_records SET sold_at=$1, quantity=$2, selling_price=$3
     WHERE id=$4 AND user_id=$5
     RETURNING *`,
    [sold_at, quantity, selling_price, id, user.userId],
  );

  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, data: rows[0] });
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

  // user_id 조건으로 타 유저 데이터 삭제 차단
  const { rows } = await pool.query(
    `DELETE FROM sale_records WHERE id=$1 AND user_id=$2 RETURNING id`,
    [id, user.userId],
  );

  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
