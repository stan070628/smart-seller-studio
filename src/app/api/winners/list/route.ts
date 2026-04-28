import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET() {
  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (sku_code, channel)
         sku_code, product_name, channel, occupancy_pct, is_winner, search_rank, snapshot_at
       FROM winner_history
       ORDER BY sku_code, channel, snapshot_at DESC
       LIMIT 200`,
    );

    return NextResponse.json({
      success: true,
      rows: rows.map((r) => ({
        skuCode: r.sku_code,
        productName: r.product_name,
        channel: r.channel,
        occupancyPct: Number(r.occupancy_pct),
        isWinner: r.is_winner,
        searchRank: r.search_rank,
        snapshotAt: r.snapshot_at,
        trend: 'flat' as const,
      })),
    });
  } catch {
    return NextResponse.json({ success: true, rows: [] });
  }
}
