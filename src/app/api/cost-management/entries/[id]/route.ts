// src/app/api/cost-management/entries/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// ─────────────────────────────────────────
// PATCH /api/cost-management/entries/[id]
// 입고 건을 부분 수정한다. 전달된 필드만 갱신하고 나머지는 기존 값을 유지한다.
// ─────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, selling_price } = body ?? {};

  // 빈 body 방어: 최소 하나의 필드가 있어야 PATCH를 허용
  const hasField = [received_at, quantity, unit_cost, unit_shipping_fee, selling_price]
    .some((v) => v !== undefined);
  if (!hasField) {
    return NextResponse.json(
      { success: false, error: 'At least one field must be provided' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    // 해당 입고 건이 현재 유저 소유인지 확인 (RLS 대체)
    const { rows: check } = await pool.query(
      `SELECT id FROM cost_entries WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // COALESCE를 사용하여 null 전달 시 기존 값을 유지
    const { rows } = await pool.query(
      `UPDATE cost_entries SET
         received_at       = COALESCE($1, received_at),
         quantity          = COALESCE($2, quantity),
         unit_cost         = COALESCE($3, unit_cost),
         unit_shipping_fee = COALESCE($4, unit_shipping_fee),
         selling_price     = COALESCE($5, selling_price)
       WHERE id = $6
       RETURNING id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, selling_price, shipping_group_id, created_at`,
      [received_at ?? null, quantity ?? null, unit_cost ?? null, unit_shipping_fee ?? null, selling_price ?? null, id],
    );

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────
// DELETE /api/cost-management/entries/[id]
// 입고 건을 삭제한다.
// ─────────────────────────────────────────
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
      `DELETE FROM cost_entries WHERE id = $1 AND user_id = $2`,
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
