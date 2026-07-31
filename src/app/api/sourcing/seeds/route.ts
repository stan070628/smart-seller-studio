/**
 * GET /api/sourcing/seeds
 * 트렌드 시드 목록 조회.
 *
 * 크론이 조용히 죽는 것을 막기 위해 마지막 수집 시각을 함께 반환한다.
 * (크론 4개가 405로 3개월간 실패했는데 아무도 몰랐던 전례가 있다)
 */

import { getSourcingPool } from '@/lib/sourcing/db';

const LIMIT = 30;

export async function GET() {
  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `SELECT id, keyword, source, reason, seed_date, created_at
         FROM trend_seeds
        ORDER BY created_at DESC
        LIMIT $1`,
      [LIMIT],
    );

    return Response.json({
      success: true,
      data: {
        seeds: rows,
        lastCollectedAt: rows.length > 0 ? rows[0].created_at : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/sourcing/seeds] 조회 실패:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
