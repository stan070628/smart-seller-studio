/**
 * GET /api/sourcing/cron
 * CRON 스케줄러에서 호출하는 전체 수집 파이프라인 엔드포인트
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 파이프라인:
 *   1. collection_logs 시작 기록 (status='running')
 *   2. runFetchAndSnapshot — getItemList (v4.1) 전체 수집 + 재고 스냅샷 동시 저장
 *   3. collection_logs 완료 업데이트 (success / partial / failed)
 *
 * v4.1부터 qty.inventory가 목록에 포함되므로 별도 getItemView 배치 호출 없이
 * 단일 API 순회로 상품 정보와 재고 스냅샷을 모두 처리한다.
 */

import { NextRequest } from 'next/server';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { DomeggookListItem } from '@/types/sourcing';
import { runSyncLegalCheck } from '@/lib/sourcing/legal';

// ─────────────────────────────────────────
// 내부 헬퍼: 상품 수집 + 재고 스냅샷 통합 처리
// ─────────────────────────────────────────

interface FetchAndSnapshotResult {
  totalFetched: number;
  newItems: number;
  updatedItems: number;
  snapshotsSaved: number;
  snapshotDate: string;
  failedItems: { itemNo: number; error: string }[];
}

async function runFetchAndSnapshot(): Promise<FetchAndSnapshotResult> {
  const client = getDomeggookClient();
  const pool = getSourcingPool();

  // KST 기준 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const snapshotDate = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // 다중 키워드 순회 수집 (중복 제거)
  const KEYWORDS = [
    '생활용품', '주방용품', '뷰티', '화장품',
    '건강', '디지털', '가전', '유아', '아동',
    '반려동물', '패션잡화', '식품',
    '스포츠', '수영', '레저', '캠핑',
  ];
  const allItems: DomeggookListItem[] = [];
  const seenNos = new Set<number>();

  for (const kw of KEYWORDS) {
    try {
      const items = await client.getAllItems({ keyword: kw });
      for (const item of items) {
        if (!seenNos.has(item.no)) {
          seenNos.add(item.no);
          allItems.push(item);
        }
      }
      console.info(`[sourcing-cron] 키워드 "${kw}" 수집 완료 (누적 ${allItems.length}건)`);
    } catch (err) {
      console.warn(`[sourcing-cron] 키워드 "${kw}" 수집 실패:`, err);
    }
  }

  if (allItems.length === 0) {
    return {
      totalFetched: 0,
      newItems: 0,
      updatedItems: 0,
      snapshotsSaved: 0,
      snapshotDate,
      failedItems: [],
    };
  }

  const now = new Date();
  const THRESHOLD_MS = 5000; // 5초 이내 생성이면 신규로 간주
  let newItems = 0;
  let updatedItems = 0;
  let snapshotsSaved = 0;
  const failedItems: { itemNo: number; error: string }[] = [];

  for (const item of allItems) {
    try {
      // sourcing_items upsert
      const upsertResult = await pool.query<{ id: string; created_at: string }>(
        `INSERT INTO sourcing_items
           (item_no, title, status, category_name, seller_id, seller_nick, image_url, dome_url, is_tracking)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (item_no) DO UPDATE SET
           title       = EXCLUDED.title,
           seller_id   = EXCLUDED.seller_id,
           seller_nick = EXCLUDED.seller_nick,
           image_url   = EXCLUDED.image_url,
           dome_url    = EXCLUDED.dome_url,
           is_tracking = EXCLUDED.is_tracking,
           updated_at  = now()
         RETURNING id, created_at`,
        [
          item.no,
          item.title,
          null,             // getItemList v4.1에는 status 미포함
          null,             // 목록 응답에는 카테고리명 미포함
          item.id ?? null,
          item.nick ?? null,
          item.thumb ?? null,
          item.url ?? null,
          true,
        ],
      );

      const returned = upsertResult.rows[0];
      if (!returned) continue;

      const createdAt = new Date(returned.created_at);
      if (now.getTime() - createdAt.getTime() < THRESHOLD_MS) {
        newItems++;
      } else {
        updatedItems++;
      }

      // Layer 1+2 법적 검토 (동기 — 수집 흐름에서 즉시 실행)
      const { status: legalStatus, issues: legalIssues } = runSyncLegalCheck(item.title);
      await pool.query(
        `UPDATE sourcing_items
         SET legal_status = $1, legal_issues = $2, legal_checked_at = now()
         WHERE id = $3`,
        [legalStatus, JSON.stringify(legalIssues), returned.id],
      );

      // v4.1 목록에 재고(qty.inventory)가 있으면 스냅샷 즉시 저장
      const inventory = item.qty?.inventory;
      if (inventory !== undefined) {
        const snapshotResult = await pool.query(
          `INSERT INTO inventory_snapshots
             (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (item_no, snapshot_date) DO NOTHING`,
          [
            returned.id,
            item.no,
            snapshotDate,
            inventory,
            item.price ?? null,   // getItemList의 price는 판매가 (dome)
            null,                 // supply 가격은 getItemView에서만 제공
          ],
        );
        if ((snapshotResult.rowCount ?? 0) > 0) {
          snapshotsSaved++;
        }
      }
    } catch (err) {
      failedItems.push({
        itemNo: item.no,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    totalFetched: allItems.length,
    newItems,
    updatedItems,
    snapshotsSaved,
    snapshotDate,
    failedItems,
  };
}

// ─────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET 환경변수가 설정되지 않았습니다.');
    return Response.json({ success: false, error: '서버 설정 오류' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token !== cronSecret) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // collection_logs 시작 기록
  let logId: string;
  try {
    const logResult = await pool.query<{ id: string }>(
      `INSERT INTO collection_logs (status, items_fetched, snapshots_saved, trigger_type)
       VALUES ('running', 0, 0, 'cron')
       RETURNING id`,
    );

    const logRow = logResult.rows[0];
    if (!logRow) {
      throw new Error('로그 INSERT 결과 없음');
    }
    logId = logRow.id;
  } catch (logErr) {
    console.error('[cron] collection_logs 생성 실패:', logErr);
    return Response.json(
      { success: false, error: '수집 로그 생성 실패' },
      { status: 500 },
    );
  }

  try {
    // getItemList v4.1 — 상품 수집 + 재고 스냅샷 통합 처리
    console.info('[cron] fetch-and-snapshot 시작');
    const result = await runFetchAndSnapshot();
    console.info('[cron] fetch-and-snapshot 완료:', result);

    // 실패 항목 유무에 따라 상태 결정
    const finalStatus = result.failedItems.length > 0 ? 'partial' : 'success';

    // collection_logs 완료 업데이트
    await pool.query(
      `UPDATE collection_logs
       SET status          = $1,
           finished_at     = now(),
           items_fetched   = $2,
           snapshots_saved = $3,
           errors          = $4
       WHERE id = $5`,
      [
        finalStatus,
        result.totalFetched,
        result.snapshotsSaved,
        result.failedItems.length > 0 ? JSON.stringify(result.failedItems) : null,
        logId,
      ],
    );

    // 30일 이전 데이터 정리
    const cleanupResults = await Promise.allSettled([
      pool.query(`DELETE FROM inventory_snapshots WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'`),
      pool.query(`DELETE FROM collection_logs WHERE started_at < NOW() - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_score_history WHERE snapshot_date < CURRENT_DATE - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_analyses WHERE created_at < NOW() - INTERVAL '30 days'`),
      pool.query(`DELETE FROM niche_cron_logs WHERE created_at < NOW() - INTERVAL '30 days'`),
    ]);
    const cleaned = cleanupResults
      .filter((r) => r.status === 'fulfilled')
      .reduce((sum, r) => sum + ((r as PromiseFulfilledResult<{ rowCount: number | null }>).value.rowCount ?? 0), 0);
    if (cleaned > 0) {
      console.info(`[cron] 30일 이전 데이터 ${cleaned}건 삭제`);
    }

    return Response.json({
      success: true,
      data: {
        logId,
        status: finalStatus,
        snapshotDate: result.snapshotDate,
        totalFetched: result.totalFetched,
        newItems: result.newItems,
        updatedItems: result.updatedItems,
        snapshotsSaved: result.snapshotsSaved,
        failedItems: result.failedItems,
        cleaned,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[cron] 파이프라인 오류:', message);

    // 실패 상태로 logs 업데이트 — 이 UPDATE가 실패해도 원래 오류를 반환
    await pool
      .query(
        `UPDATE collection_logs
         SET status      = 'failed',
             finished_at = now(),
             errors      = $1
         WHERE id = $2`,
        [JSON.stringify([{ error: message }]), logId],
      )
      .catch((updateErr) => {
        console.error('[cron] 실패 로그 업데이트 오류:', updateErr);
      });

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
