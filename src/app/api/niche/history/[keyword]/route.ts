/**
 * GET /api/niche/history/[keyword] — 키워드 점수 변동 이력 조회
 *
 * 파라미터: keyword (URL 인코딩된 키워드 문자열)
 * 쿼리스트링: days (기본 30, 최소 1, 최대 365)
 * - niche_score_history에서 해당 keyword의 최근 N일 데이터를 ASC 정렬로 반환
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { NicheScoreSnapshot } from '@/types/niche';

// days 쿼리 파라미터 허용 범위
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const DAYS_DEFAULT = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> },
) {
  const { keyword: encodedKeyword } = await params;

  // URL 디코딩
  let keyword: string;
  try {
    keyword = decodeURIComponent(encodedKeyword).trim();
  } catch {
    return Response.json(
      { success: false, error: '유효하지 않은 키워드 인코딩입니다.' },
      { status: 400 },
    );
  }

  if (!keyword) {
    return Response.json(
      { success: false, error: '키워드가 비어 있습니다.' },
      { status: 400 },
    );
  }

  // days 파라미터 파싱 및 범위 보정
  const rawDays = request.nextUrl.searchParams.get('days');
  const parsedDays = rawDays !== null ? parseInt(rawDays, 10) : DAYS_DEFAULT;
  const days = Number.isFinite(parsedDays)
    ? Math.min(Math.max(parsedDays, DAYS_MIN), DAYS_MAX)
    : DAYS_DEFAULT;

  const pool = getSourcingPool();

  try {
    const result = await pool.query<{
      snapshot_date: string;
      total_score: number;
      grade: string;
      raw_total_products: number | null;
      raw_avg_price: number | null;
    }>(
      `SELECT
         snapshot_date,
         total_score,
         grade,
         raw_total_products,
         raw_avg_price
       FROM niche_score_history
       WHERE keyword = $1
         AND snapshot_date >= CURRENT_DATE - ($2::int - 1)
       ORDER BY snapshot_date ASC`,
      [keyword, days],
    );

    const history: NicheScoreSnapshot[] = result.rows.map((row) => ({
      snapshotDate: row.snapshot_date,
      totalScore: row.total_score,
      grade: row.grade,
      rawTotalProducts: row.raw_total_products,
      rawAvgPrice: row.raw_avg_price,
    }));

    return Response.json({
      success: true,
      data: { keyword, history },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error(`[niche/history GET] 오류 (keyword=${keyword}):`, message);
    return Response.json({ success: false, error: '이력 조회 실패' }, { status: 500 });
  }
}
