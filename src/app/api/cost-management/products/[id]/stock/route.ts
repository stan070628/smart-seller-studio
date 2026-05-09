// src/app/api/cost-management/products/[id]/stock/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// ─────────────────────────────────────────
// PATCH /api/cost-management/products/[id]/stock
// 상품의 현재 재고 수량을 직접 수정한다.
// ─────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { current_stock } = body ?? {};

  // 0 이상의 정수여야 함
  if (typeof current_stock !== 'number' || !Number.isInteger(current_stock) || current_stock < 0) {
    return NextResponse.json(
      { success: false, error: 'current_stock must be a non-negative integer' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `UPDATE product_costs SET current_stock = $1 WHERE id = $2 AND user_id = $3 RETURNING id, current_stock`,
      [current_stock, id, user.userId],
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
