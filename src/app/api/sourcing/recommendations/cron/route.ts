import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { generateRecommendation } from '@/lib/sourcing/recommend-batch';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const pool = getSourcingPool();

  const { rows } = await pool.query(`
    SELECT item_no::text AS sku_code, title AS product_name,
           COALESCE(margin_wholesale_krw, 0) AS wholesale,
           COALESCE(margin_buy_krw, 0) AS buy,
           COALESCE(monthly_sales_qty, 0) AS qty,
           COALESCE(buy_capital_needed_krw, 500000) AS capital
    FROM sourcing_items
    WHERE is_tracking = true
      AND COALESCE(monthly_sales_qty, 0) >= 30
    LIMIT 100
  `).catch(() => ({ rows: [] }));

  let created = 0, strongCount = 0;
  for (const row of rows) {
    const r = generateRecommendation({
      skuCode: row.sku_code,
      productName: row.product_name,
      wholesaleMarginPerUnitKrw: Number(row.wholesale),
      buyMarginPerUnitKrw: Number(row.buy),
      monthlySalesQty: Number(row.qty),
      buyCapitalNeededKrw: Number(row.capital),
    });

    await pool.query(
      `INSERT INTO sourcing_recommendations
         (sku_code, product_name, recommendation, wholesale_margin_per_unit_krw,
          buy_margin_per_unit_krw, monthly_diff_krw, payback_months, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.skuCode, r.productName, r.recommendation,
       Number(row.wholesale), Number(row.buy),
       r.monthlyDiffKrw, r.paybackMonths, r.reason],
    ).catch(() => {});
    created++;
    if (r.recommendation === 'buy_strong') strongCount++;
  }

  if (strongCount > 0) {
    await pool.query(
      `INSERT INTO alerts (type, severity, message, detail)
       VALUES ('sourcing_recommendation', 'high', $1, $2)`,
      [`사입 강력 권장 SKU ${strongCount}건 발견`,
       JSON.stringify({ strongCount, total: rows.length })],
    ).catch(() => {});
  }

  return NextResponse.json({ success: true, created, strongCount });
}
