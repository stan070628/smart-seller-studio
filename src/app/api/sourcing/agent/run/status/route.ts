/**
 * GET /api/sourcing/agent/run/status?ids=12,13
 * 발굴 탭 폴링용 — 이번 실행분의 진행 상태와 결과를 돌려준다.
 *
 * POST /run이 응답에 담아준 requestId만 조회하므로 다른 실행과 섞이지 않는다.
 * 조회 전용이지만 결과에 소싱 후보가 담기므로 인증을 건다.
 */

import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/** 한 번에 조회할 수 있는 실행 수 — POST /run의 MAX_KEYWORDS와 같다 */
const MAX_IDS = 10;

export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return Response.json(
      { success: false, error: '조회할 실행 ID를 지정하세요.' },
      { status: 400 },
    );
  }

  try {
    const pool = getSourcingPool();

    const { rows: requests } = await pool.query(
      `SELECT id, keyword, status, error_message
         FROM keyword_sourcing_requests
        WHERE id = ANY($1::int[])`,
      [ids],
    );

    const { rows: results } = await pool.query(
      `SELECT * FROM keyword_sourcing_results
        WHERE request_id = ANY($1::int[])
        ORDER BY request_id, rank`,
      [ids],
    );

    const byRequest = new Map<number, unknown[]>();
    for (const r of results as { request_id: number }[]) {
      const list = byRequest.get(r.request_id) ?? [];
      list.push(r);
      byRequest.set(r.request_id, list);
    }

    return Response.json({
      success: true,
      data: {
        runs: (requests as { id: number; keyword: string; status: string; error_message: string | null }[]).map((q) => ({
          requestId: q.id,
          keyword: q.keyword,
          status: q.status,
          errorMessage: q.error_message,
          results: byRequest.get(q.id) ?? [],
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/sourcing/agent/run/status] 조회 실패:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
