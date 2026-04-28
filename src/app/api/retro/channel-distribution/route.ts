import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET() {
  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT recorded_date, coupang_grocery_krw, coupang_general_krw, naver_krw, total_krw
     FROM channel_distribution
     WHERE recorded_date > current_date - INTERVAL '30 days'
     ORDER BY recorded_date ASC`,
  ).catch(() => ({ rows: [] }));

  const totals = rows.reduce(
    (acc, r) => ({
      grocery: acc.grocery + Number(r.coupang_grocery_krw),
      general: acc.general + Number(r.coupang_general_krw),
      naver: acc.naver + Number(r.naver_krw),
    }),
    { grocery: 0, general: 0, naver: 0 },
  );
  const sum = totals.grocery + totals.general + totals.naver || 1;
  const distribution = {
    coupang_grocery_pct: (totals.grocery / sum) * 100,
    coupang_general_pct: (totals.general / sum) * 100,
    naver_pct: (totals.naver / sum) * 100,
    target: { grocery: 50, general: 25, naver: 25 },
  };

  return NextResponse.json({ success: true, rows, distribution });
}
