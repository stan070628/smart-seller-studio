import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  // 소유권 확인
  const { rows: owns } = await pool.query(
    `SELECT 1 FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (owns.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  // 사이즈별 입고 합산
  const { rows: entryRows } = await pool.query(
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM cost_entries
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL
     GROUP BY variant_name`,
    [id],
  );

  // 사이즈별 판매 합산
  const { rows: saleRows } = await pool.query(
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM sale_records
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL AND voided_at IS NULL
     GROUP BY variant_name`,
    [id],
  );

  const stock: Record<string, number> = {};
  for (const row of entryRows) {
    stock[row.variant_name] = (stock[row.variant_name] ?? 0) + Number(row.total);
  }
  for (const row of saleRows) {
    stock[row.variant_name] = (stock[row.variant_name] ?? 0) - Number(row.total);
  }

  return NextResponse.json({ success: true, data: stock });
}
