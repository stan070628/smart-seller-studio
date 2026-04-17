/**
 * GET /api/sourcing/cron/snapshot
 * 스냅샷 전용 엔드포인트 — 전체 상품 수집 없이 재고 스냅샷만 수집
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 대상: 이미 스냅샷이 존재하는 아이템 중 오늘 스냅샷이 없는 것
 * 처리: getItemView 병렬(동시성 20) → inventory_snapshots INSERT
 */

import { NextRequest } from 'next/server';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { DomeggookItemDetail } from '@/types/sourcing';

const SNAPSHOT_BATCH_LIMIT = 5000;
const SNAPSHOT_CONCURRENCY = 20;

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
  const client = getDomeggookClient();

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const snapshotDate = kstNow.toISOString().slice(0, 10);

  try {
    // 기존 스냅샷 있고 오늘 스냅샷 없는 아이템 조회
    const targetResult = await pool.query<{ id: string; item_no: number }>(
      `SELECT si.id, si.item_no
       FROM sourcing_items si
       WHERE EXISTS (
         SELECT 1 FROM inventory_snapshots s WHERE s.item_no = si.item_no
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_snapshots s WHERE s.item_no = si.item_no AND s.snapshot_date = $1
       )
       ORDER BY si.item_no
       LIMIT $2`,
      [snapshotDate, SNAPSHOT_BATCH_LIMIT],
    );

    const targets = targetResult.rows;
    if (targets.length === 0) {
      return Response.json({
        success: true,
        data: { snapshotDate, attempted: 0, snapshotsSaved: 0, failedItems: [] },
      });
    }

    const itemIdMap = new Map<number, string>(targets.map((r) => [r.item_no, r.id]));
    const itemNos = Array.from(itemIdMap.keys());

    console.info(`[cron/snapshot] ${itemNos.length}건 병렬 수집 시작 (동시성: ${SNAPSHOT_CONCURRENCY})`);

    const batchResult = await client.getItemViewBatch(
      itemNos,
      (current, total) => {
        if (current % 500 === 0) console.info(`[cron/snapshot] 진행: ${current}/${total}`);
      },
      SNAPSHOT_CONCURRENCY,
    );

    let snapshotsSaved = 0;
    for (const detail of batchResult.success as DomeggookItemDetail[]) {
      const itemId = itemIdMap.get(detail.basis.no);
      if (!itemId) continue;

      const inventory = detail.qty?.inventory ?? 0;
      const priceDome = parseInt(String(detail.price?.dome ?? '0'), 10) || null;
      const priceSupply = parseInt(String(detail.price?.supply ?? '0'), 10) || null;

      const result = await pool.query(
        `INSERT INTO inventory_snapshots
           (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (item_no, snapshot_date) DO UPDATE SET
           inventory    = EXCLUDED.inventory,
           price_dome   = COALESCE(EXCLUDED.price_dome, inventory_snapshots.price_dome),
           price_supply = COALESCE(EXCLUDED.price_supply, inventory_snapshots.price_supply)`,
        [itemId, detail.basis.no, snapshotDate, inventory, priceDome, priceSupply],
      );
      if ((result.rowCount ?? 0) > 0) snapshotsSaved++;
    }

    console.info(`[cron/snapshot] 완료: ${snapshotsSaved}건 저장, 실패 ${batchResult.failed.length}건`);

    return Response.json({
      success: true,
      data: {
        snapshotDate,
        attempted: itemNos.length,
        snapshotsSaved,
        failedItems: batchResult.failed,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[cron/snapshot] 오류:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
