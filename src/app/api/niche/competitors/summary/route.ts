/**
 * GET /api/niche/competitors/summary?keyword=XXX
 * 키워드별 경쟁 상품 최신 판매 데이터 요약 (뷰 기반)
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword');
  if (!keyword) {
    return Response.json(
      { success: false, error: 'keyword 쿼리 파라미터가 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const pool = getSourcingPool();
    const result = await pool.query(
      `SELECT
         competitor_id, keyword, platform,
         product_name, seller_name, product_url,
         is_rocket, is_ad,
         latest_date, price, review_count, rating,
         sales_count, review_delta, rank_position,
         prev_price, price_change, review_change
       FROM niche_competitor_summary_view
       WHERE keyword = $1
       ORDER BY sales_count DESC NULLS LAST, review_count DESC NULLS LAST`,
      [keyword],
    );

    const items = result.rows.map((r) => ({
      competitorId: r.competitor_id,
      keyword: r.keyword,
      platform: r.platform,
      productName: r.product_name,
      sellerName: r.seller_name,
      productUrl: r.product_url,
      isRocket: r.is_rocket,
      isAd: r.is_ad,
      latestDate: r.latest_date,
      price: r.price,
      reviewCount: r.review_count,
      rating: r.rating ? parseFloat(r.rating) : null,
      salesCount: r.sales_count,
      reviewDelta: r.review_delta,
      rankPosition: r.rank_position,
      prevPrice: r.prev_price,
      priceChange: r.price_change,
      reviewChange: r.review_change,
    }));

    // 시장 요약 통계
    const tracked = items.length;
    const totalSales = items.reduce((sum, i) => sum + (i.salesCount ?? 0), 0);
    const avgPrice = tracked > 0
      ? Math.round(items.reduce((sum, i) => sum + (i.price ?? 0), 0) / tracked)
      : 0;
    const rocketCount = items.filter((i) => i.isRocket).length;

    return Response.json({
      success: true,
      data: {
        items,
        total: tracked,
        summary: {
          trackedProducts: tracked,
          totalDailySales: totalSales,
          avgPrice,
          rocketCount,
          rocketRatio: tracked > 0 ? Math.round((rocketCount / tracked) * 100) : 0,
        },
      },
    });
  } catch (err) {
    console.error('[GET /api/niche/competitors/summary]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
