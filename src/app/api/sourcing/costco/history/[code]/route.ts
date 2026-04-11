/**
 * GET /api/sourcing/costco/history/[code]
 * 상품의 90일 가격 이력 + 시장가 이력 조회
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!code) {
    return NextResponse.json({ error: '상품 코드가 필요합니다.' }, { status: 400 });
  }

  const pool = getSourcingPool();

  try {
    const [productRes, priceLogsRes, marketLogsRes] = await Promise.all([
      pool.query(
        `SELECT id, product_code, title, price, target_sell_price,
                market_lowest_price, market_price_source, market_price_updated_at,
                sourcing_score, demand_score, price_opp_score, urgency_score,
                seasonal_score, margin_score
         FROM public.costco_products
         WHERE product_code = $1`,
        [code],
      ),
      // 90일 코스트코 가격 이력
      pool.query(
        `SELECT logged_at, price
         FROM public.costco_price_logs
         WHERE product_code = $1
           AND logged_at >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY logged_at ASC`,
        [code],
      ),
      // 90일 시장가 이력
      pool.query(
        `SELECT logged_at, market_price, source
         FROM public.costco_market_prices
         WHERE product_code = $1
           AND logged_at >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY logged_at ASC`,
        [code],
      ),
    ]);

    if (!productRes.rows[0]) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({
      product: productRes.rows[0],
      priceLogs: priceLogsRes.rows,
      marketLogs: marketLogsRes.rows,
    });
  } catch (err) {
    console.error('[costco/history] 오류:', err);
    return NextResponse.json({ error: '가격 이력 조회 실패' }, { status: 500 });
  }
}
