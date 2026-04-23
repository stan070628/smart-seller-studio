/**
 * GET /api/sourcing/cron/trend-seeds
 * 매일 Gemini grounding으로 트렌드 키워드를 수집해 trend_seeds 테이블에 저장하는 크론 엔드포인트
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 처리:
 *   1. discoverTrendSeeds() — Gemini 2.0 Flash + Google Search grounding
 *   2. trend_seeds 테이블에 seed_date/keyword 기준 중복 제외 upsert
 */

import { NextRequest } from 'next/server';
import { discoverTrendSeeds } from '@/lib/sourcing/trend-discovery';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ success: false, error: '서버 설정 오류' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (token !== cronSecret) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }

  // Gemini grounding으로 트렌드 씨드 수집
  const seeds = await discoverTrendSeeds();
  if (seeds.length === 0) {
    return Response.json({ success: true, data: { saved: 0, total: 0, seedDate: '' } });
  }

  const pool = getSourcingPool();
  // KST 기준 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const seedDate = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  let saved = 0;
  for (const seed of seeds) {
    try {
      const result = await pool.query(
        `INSERT INTO trend_seeds (seed_date, keyword, source, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (seed_date, keyword) DO NOTHING`,
        [seedDate, seed.keyword, seed.source, seed.reason],
      );
      if ((result.rowCount ?? 0) > 0) saved++;
    } catch (err) {
      console.error('[cron/trend-seeds] 저장 실패:', seed.keyword, err);
    }
  }

  console.info(`[cron/trend-seeds] ${seedDate}: ${saved}/${seeds.length}개 저장`);
  return Response.json({ success: true, data: { saved, total: seeds.length, seedDate } });
}
