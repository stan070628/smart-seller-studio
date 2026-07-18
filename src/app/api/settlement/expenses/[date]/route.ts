import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { date } = await params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const adSpend = toInt(body?.adSpend);
  const boxCost = toInt(body?.boxCost);
  const parcelCost = toInt(body?.parcelCost);
  const boxMemo = typeof body?.boxMemo === 'string' ? body.boxMemo : null;
  const memo = typeof body?.memo === 'string' ? body.memo : null;

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO daily_expenses
         (user_id, expense_date, ad_spend, box_cost, parcel_cost, box_memo, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, expense_date) DO UPDATE
         SET ad_spend = EXCLUDED.ad_spend,
             box_cost = EXCLUDED.box_cost,
             parcel_cost = EXCLUDED.parcel_cost,
             box_memo = EXCLUDED.box_memo,
             memo = EXCLUDED.memo
       RETURNING *`,
      [user.userId, date, adSpend, boxCost, parcelCost, boxMemo, memo],
    );
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
