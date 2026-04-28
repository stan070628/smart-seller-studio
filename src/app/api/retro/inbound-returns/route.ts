import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { shouldWarnReorder } from '@/lib/retro/inbound-return-warning';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { skuCode, sellerName, reason, returnCostKrw, detail } = body ?? {};

  if (!skuCode || !reason) {
    return NextResponse.json(
      { success: false, error: 'skuCode and reason required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  await pool.query(
    `INSERT INTO inbound_returns (sku_code, seller_name, reason, return_cost_krw, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [skuCode, sellerName, reason, returnCostKrw, detail],
  ).catch(() => {});

  if (sellerName) {
    const { rows: past } = await pool.query<{ sellerName: string; reason: string; occurredAt: string }>(
      `SELECT seller_name AS "sellerName", reason, occurred_at AS "occurredAt"
       FROM inbound_returns WHERE seller_name = $1`,
      [sellerName],
    ).catch(() => ({ rows: [] }));

    const warn = shouldWarnReorder({
      sellerName,
      pastReturns: past.map((p) => ({ ...p, occurredAt: new Date(p.occurredAt) })),
    });

    if (warn.warn) {
      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail)
         VALUES ('inbound_return_warning', 'high', $1, $2, $3)`,
        [skuCode,
         `같은 셀러 ${sellerName} 회송 ${warn.count}회 누적 — 다음 발주 시 변경 권장`,
         JSON.stringify({ sellerName, count: warn.count, reasons: warn.reasons })],
      ).catch(() => {});
    }
  }

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const sku = request.nextUrl.searchParams.get('sku');
  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, sku_code, seller_name, reason, return_cost_krw, detail, occurred_at
       FROM inbound_returns
       ${sku ? 'WHERE sku_code = $1' : ''}
       ORDER BY occurred_at DESC LIMIT 100`,
      sku ? [sku] : [],
    );
    return NextResponse.json({ success: true, rows });
  } catch {
    return NextResponse.json({ success: true, rows: [] });
  }
}
