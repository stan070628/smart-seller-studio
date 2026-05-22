import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { ENTRY_CHANNEL } from '@/lib/cost-management/fifo';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.unit_rg_shipping_fee,
              ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel } = body ?? {};

  if (
    !received_at ||
    quantity == null || typeof quantity !== 'number' || quantity <= 0 ||
    unit_cost == null || !Number.isInteger(unit_cost) || unit_cost < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'received_at, quantity(>0), unit_cost(>=0) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();

  try {
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { rows } = await pool.query(
      `INSERT INTO cost_entries
         (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user.userId, id, received_at, quantity, unit_cost, unit_shipping_fee ?? 0, unit_rg_shipping_fee ?? 0, channel ?? ENTRY_CHANNEL.WING],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
