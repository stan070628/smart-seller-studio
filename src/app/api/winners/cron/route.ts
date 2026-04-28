/**
 * GET /api/winners/cron
 * 일별 위너 점유율 스냅샷 + 빼앗김 감지 → alerts 생성
 * spec 2026-04-28 §6.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchWinnerSnapshots } from '@/lib/winner/scrape-coupang';
import { getSourcingPool } from '@/lib/sourcing/db';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const snapshots = await fetchWinnerSnapshots();
  const pool = getSourcingPool();
  let inserted = 0;
  let lostCount = 0;

  for (const snap of snapshots) {
    const { rows: prevRows } = await pool.query(
      `SELECT is_winner, occupancy_pct FROM winner_history
       WHERE sku_code = $1 AND channel = $2
       ORDER BY snapshot_at DESC LIMIT 1`,
      [snap.skuCode, snap.channel],
    );

    const wasWinner = prevRows[0]?.is_winner ?? false;
    const lostWinner = wasWinner && !snap.isWinner;

    await pool.query(
      `INSERT INTO winner_history
         (sku_code, product_name, channel, occupancy_pct, is_winner, search_rank)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [snap.skuCode, snap.productName, snap.channel, snap.occupancyPct, snap.isWinner, snap.searchRank],
    );
    inserted++;

    if (lostWinner) {
      lostCount++;
      await pool.query(
        `INSERT INTO alerts
           (type, severity, sku_code, message, detail)
         VALUES ('winner_lost', 'high', $1, $2, $3)`,
        [
          snap.skuCode,
          `위너 빼앗김: ${snap.productName} (${snap.channel})`,
          JSON.stringify({
            previousOccupancy: prevRows[0]?.occupancy_pct,
            currentOccupancy: snap.occupancyPct,
            recommendedActions: [
              '옵션 분리 (색상/사이즈 변형)',
              '카탈로그 매칭 차단',
              '신규 옵션 ID 등록',
            ],
          }),
        ],
      ).catch(() => {
        // alerts 테이블 미존재 시 silent skip (Plan 1 미구현)
      });
    }
  }

  return NextResponse.json({
    success: true,
    inserted,
    lostCount,
  });
}
