/**
 * 쿠팡 윙 위너 점유율 수집
 *
 * 1차 구현은 placeholder. 실제 스크래핑은 coupang-report-agent 패턴 따라
 * 추후 보강. 현재는 DB에 등록된 SKU를 읽어 sourcing_items의 위너 정보를 활용.
 *
 * spec 2026-04-28 §5.1 — coupang-report-agent 활용
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import type { WinnerSnapshot, WinnerChannel } from './types';

export async function fetchWinnerSnapshots(): Promise<WinnerSnapshot[]> {
  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query<{
      item_no: number;
      title: string;
      is_winner: boolean | null;
      winner_occupancy: number | null;
    }>(
      `SELECT item_no, title, is_winner, winner_occupancy
       FROM sourcing_items
       WHERE is_tracking = true
         AND item_no IS NOT NULL
       LIMIT 100`,
    );

    return rows.map((row) => ({
      skuCode: String(row.item_no),
      productName: row.title,
      channel: 'coupang' as WinnerChannel,
      occupancyPct: row.winner_occupancy ?? 0,
      isWinner: row.is_winner ?? false,
      searchRank: null,
      snapshotAt: new Date(),
    }));
  } catch {
    // sourcing_items에 winner 컬럼 미존재 시 빈 배열 반환
    return [];
  }
}
