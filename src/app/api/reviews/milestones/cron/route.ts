import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { detectMilestones } from '@/lib/reviews/milestone-detector';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const pool = getSourcingPool();

  const { rows } = await pool.query(`
    SELECT item_no::text AS sku_code, title AS product_name,
           'coupang' AS channel,
           COALESCE(review_count, 0) AS current_count
    FROM sourcing_items
    WHERE is_tracking = true LIMIT 100
  `).catch(() => ({ rows: [] }));

  let alertsCreated = 0;
  for (const row of rows) {
    const { rows: prev } = await pool.query(
      `SELECT review_count, reached_50, reached_100
       FROM review_milestones
       WHERE sku_code = $1 AND channel = $2`,
      [row.sku_code, row.channel],
    ).catch(() => ({ rows: [] }));

    const previousCount = prev[0]?.review_count ?? 0;
    const previousReached50 = prev[0]?.reached_50 ?? false;
    const previousReached100 = prev[0]?.reached_100 ?? false;

    const detect = detectMilestones({
      previousCount,
      currentCount: Number(row.current_count),
      previousReached50,
      previousReached100,
    });

    await pool.query(
      `INSERT INTO review_milestones
         (sku_code, product_name, channel, review_count,
          reached_50, reached_100, reached_50_at, reached_100_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sku_code, channel) DO UPDATE SET
         review_count = EXCLUDED.review_count,
         reached_50 = review_milestones.reached_50 OR EXCLUDED.reached_50,
         reached_100 = review_milestones.reached_100 OR EXCLUDED.reached_100,
         reached_50_at = COALESCE(review_milestones.reached_50_at, EXCLUDED.reached_50_at),
         reached_100_at = COALESCE(review_milestones.reached_100_at, EXCLUDED.reached_100_at),
         recorded_at = now()`,
      [
        row.sku_code, row.product_name, row.channel, Number(row.current_count),
        previousReached50 || detect.justReached50,
        previousReached100 || detect.justReached100,
        detect.justReached50 ? new Date() : null,
        detect.justReached100 ? new Date() : null,
      ],
    ).catch(() => {});

    if (detect.justReached50 || detect.justReached100) {
      const milestone = detect.justReached100 ? 100 : 50;
      const incentiveSuggestion =
        milestone === 100
          ? '리뷰 100+ 도달 — 적립금 이벤트 종료 + 베스트 리뷰 SKU 자동 노출 활용'
          : '리뷰 50+ 도달 — 적립금 3,000원으로 증액 + 다음 50개 가속';

      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail)
         VALUES ('review_milestone', 'medium', $1, $2, $3)`,
        [
          row.sku_code,
          `리뷰 ${milestone}+ 도달: ${row.product_name} — ${incentiveSuggestion}`,
          JSON.stringify({ milestone, productName: row.product_name }),
        ],
      ).catch(() => {});
      alertsCreated++;
    }
  }

  return NextResponse.json({ success: true, alertsCreated });
}
