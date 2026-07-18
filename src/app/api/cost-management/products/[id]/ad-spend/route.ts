import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { body = null; }

  const { ad_date, ad_spend } = body ?? {};

  if (!ad_date || !DATE_RE.test(ad_date)) {
    return NextResponse.json(
      { success: false, error: 'ad_date must be in YYYY-MM-DD format' },
      { status: 400 },
    );
  }
  if (typeof ad_spend !== 'number' || ad_spend < 0) {
    return NextResponse.json(
      { success: false, error: 'ad_spend must be a non-negative number' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO product_ad_spend_daily (user_id, product_id, ad_date, ad_spend, updated_at)
     SELECT $1, $2, $3, $4, now()
     WHERE EXISTS (SELECT 1 FROM product_costs WHERE id = $2 AND user_id = $1)
     ON CONFLICT (user_id, product_id, ad_date)
     DO UPDATE SET ad_spend = EXCLUDED.ad_spend, updated_at = now()
     RETURNING id, product_id, to_char(ad_date, 'YYYY-MM-DD') AS ad_date, ad_spend`,
    [user.userId, id, ad_date, ad_spend],
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: rows[0] });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { success: false, error: 'from, to (YYYY-MM-DD) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT to_char(ad_date, 'YYYY-MM-DD') AS ad_date, ad_spend
       FROM product_ad_spend_daily
      WHERE user_id = $1 AND product_id = $2 AND ad_date BETWEEN $3 AND $4
      ORDER BY ad_date`,
    [user.userId, id, from, to],
  );

  const data = rows.map((r) => ({ ad_date: r.ad_date, ad_spend: Number(r.ad_spend) }));
  return NextResponse.json({ success: true, data });
}
