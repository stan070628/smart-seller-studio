import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const { year_month, ad_spend } = body ?? {};

  // year_month 검증: YYYY-MM 형식
  if (!year_month || !YEAR_MONTH_RE.test(year_month)) {
    return NextResponse.json(
      { success: false, error: 'year_month must be in YYYY-MM format' },
      { status: 400 }
    );
  }

  // ad_spend 검증: 음이 아닌 정수
  if (typeof ad_spend !== 'number' || ad_spend < 0) {
    return NextResponse.json(
      { success: false, error: 'ad_spend must be a non-negative number' },
      { status: 400 }
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO product_ad_spend (user_id, product_id, year_month, ad_spend, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, product_id, year_month)
     DO UPDATE SET ad_spend = EXCLUDED.ad_spend, updated_at = now()
     RETURNING id, product_id, year_month, ad_spend`,
    [user.userId, id, year_month, ad_spend],
  );

  return NextResponse.json({ success: true, data: rows[0] });
}
