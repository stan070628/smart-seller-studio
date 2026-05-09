// src/app/api/cost-management/products/[id]/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// ─────────────────────────────────────────
// GET /api/cost-management/products/[id]/entries
// 특정 상품의 입고 건 목록을 반환한다.
// ─────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    // 해당 상품이 현재 유저 소유인지 먼저 확인 (RLS 대체)
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // 입고 건 목록 조회 — 배송비 그룹명을 LEFT JOIN으로 함께 반환
    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.selling_price, ce.shipping_group_id, sg.name as shipping_group_name,
              ce.created_at
       FROM cost_entries ce
       LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
       WHERE ce.product_cost_id = $1
       ORDER BY ce.received_at DESC, ce.created_at DESC`,
      [id],
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────
// POST /api/cost-management/products/[id]/entries
// 특정 상품에 입고 건을 추가한다.
// ─────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, selling_price } = body ?? {};

  // 필수 필드 검증 — 타입·범위까지 엄격하게 확인
  if (
    !received_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    unit_cost == null || unit_cost < 0 ||
    selling_price == null || !Number.isInteger(selling_price) || selling_price <= 0
  ) {
    return NextResponse.json(
      { success: false, error: 'received_at, quantity, unit_cost, selling_price required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    // 해당 상품이 현재 유저 소유인지 확인
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `INSERT INTO cost_entries
         (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, selling_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user.userId, id, received_at, quantity, unit_cost, unit_shipping_fee ?? 0, selling_price],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
