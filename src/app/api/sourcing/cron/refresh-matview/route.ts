/**
 * GET /api/sourcing/cron/refresh-matview
 * sales_analysis_view (MATERIALIZED VIEW) 갱신 전용 cron
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 동작: REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_analysis_view
 *
 * 분리 이유: snapshot cron(~4분) + REFRESH(~5분) 합산이 단일 함수 maxDuration(300s)을
 *           초과하므로 별도 cron으로 분리. (migration 034에서 matview로 전환)
 *           snapshot cron(15:00 UTC) 종료 후 충분한 간격을 두고 15:30 UTC에 실행.
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

// REFRESH 1회 약 297초 소요 (2026-04 기준, 약 7만 행). Pro 플랜 기본 한도 300s에 맞춤.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ success: false, error: '서버 설정 오류' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (token !== cronSecret) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }

  const pool = getSourcingPool();
  const startedAt = Date.now();

  try {
    await pool.query(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_analysis_view',
    );
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[cron/refresh-matview] 완료: ${(elapsedMs / 1000).toFixed(1)}초`,
    );
    return Response.json({
      success: true,
      data: { elapsedMs },
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error(
      `[cron/refresh-matview] 실패 (${(elapsedMs / 1000).toFixed(1)}초): ${message}`,
    );
    return Response.json(
      { success: false, error: message, elapsedMs },
      { status: 500 },
    );
  }
}
