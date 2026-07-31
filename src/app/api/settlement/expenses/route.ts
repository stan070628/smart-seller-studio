import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT to_char(expense_date, 'YYYY-MM-DD') AS expense_date,
              ad_spend, box_cost, parcel_cost, box_memo, memo
         FROM daily_expenses
        WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3
        ORDER BY expense_date DESC`,
      [user.userId, from, to],
    );
    const items = rows.map((r) => ({
      date: r.expense_date,
      adSpend: Number(r.ad_spend ?? 0),
      boxCost: Number(r.box_cost ?? 0),
      parcelCost: Number(r.parcel_cost ?? 0),
      boxMemo: r.box_memo ?? '',
      memo: r.memo ?? '',
    }));
    return NextResponse.json({ success: true, items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
