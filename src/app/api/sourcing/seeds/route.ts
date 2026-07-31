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
    // trend_seeds의 UNIQUE는 (seed_date, keyword)라 같은 키워드가 날짜별로 다시 쌓인다.
    // 발굴 탭은 "오늘 뭘 파고들지" 고르는 화면이므로 같은 키워드가 여러 줄 보이면
    // 그만큼 볼 수 있는 후보가 줄어든다. 키워드별 최신 1건만 남긴다.
    //
    // DISTINCT ON은 선행 ORDER BY 표현식이 DISTINCT ON 대상과 일치해야 하므로
    // (keyword, created_at DESC)로 정렬해 안쪽에서 최신 1건을 고르고,
    // 바깥에서 다시 최신순으로 되돌린다.
    //
    // LIMIT이 중복 제거 뒤에 걸리므로 사용자는 "30줄"이 아니라
    // "서로 다른 키워드 30개"까지 보게 된다. 이것이 의도한 개선이다.
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (keyword) id, keyword, source, reason, seed_date, created_at
           FROM trend_seeds
          ORDER BY keyword, created_at DESC
       ) t
        ORDER BY created_at DESC
        LIMIT $1`,
      [LIMIT],
    );

    return Response.json({
      success: true,
      data: {
        seeds: rows,
        // 전체 최신 행은 자기 키워드 그룹에서도 최신이라 중복 제거 후에도 살아남는다.
        // 따라서 rows[0]은 여전히 전체 최신 행이고 마지막 수집 시각으로 쓸 수 있다.
        lastCollectedAt: rows.length > 0 ? rows[0].created_at : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/sourcing/seeds] 조회 실패:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
