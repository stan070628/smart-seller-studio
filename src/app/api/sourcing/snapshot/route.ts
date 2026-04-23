/**
 * POST /api/sourcing/snapshot
 * getItemView (ver=4.5) 배치 호출 → inventory_snapshots INSERT
 *
 * fetch-items가 이미 qty.inventory를 저장하므로,
 * 이 엔드포인트는 price.dome / price.supply 등 상세 데이터가 필요한 경우에만 사용한다.
 *
 * 요청: { itemNos?: number[] }  (생략 시 is_tracking=true 전체 대상)
 * 응답: { success: true, data: { snapshotDate, totalProcessed, successCount, failedItems } }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { DomeggookItemDetail } from '@/types/sourcing';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const requestSchema = z.object({
  itemNos: z.array(z.number().int().positive()).optional(),
});

// ─────────────────────────────────────────
// "1+11750|10+10580|100+9400" 형식 파싱 유틸
//   수량+단가 쌍이 | 로 구분되어 있음
//   parseQty: 첫 번째 수량(+ 앞) 추출 → MOQ용
//   parsePrice: 첫 번째 단가(+ 뒤) 추출 → 가격용
//   parseIntSafe: 일반 정수 파싱 (형식 무관)
// ─────────────────────────────────────────

function parseIntSafe(raw: unknown): number | null {
  if (raw == null) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

function parseQty(raw: unknown): number | null {
  if (raw == null) return null;
  const first = String(raw).split('|')[0];
  const qty = parseInt(first.split('+')[0], 10);
  return Number.isFinite(qty) ? qty : null;
}

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  // "1+11750|10+10580" → + 가 있으면 뒤(단가), 없으면 그대로 숫자
  const first = s.split('|')[0];
  const parts = first.split('+');
  const price = parseInt(parts.length > 1 ? parts[1] : parts[0], 10);
  return Number.isFinite(price) ? price : null;
}

/** "1+11750|10+10580|100+9400" → [{ minQty: 1, unitPrice: 11750 }, ...] */
function parseAllTiers(raw: unknown): { minQty: number; unitPrice: number }[] {
  if (raw == null) return [];
  const s = String(raw);
  const tiers: { minQty: number; unitPrice: number }[] = [];
  for (const segment of s.split('|')) {
    const parts = segment.split('+');
    if (parts.length === 2) {
      const minQty = parseInt(parts[0], 10);
      const unitPrice = parseInt(parts[1], 10);
      if (Number.isFinite(minQty) && Number.isFinite(unitPrice)) {
        tiers.push({ minQty, unitPrice });
      }
    } else if (parts.length === 1) {
      // 단일 숫자 (티어 없음)
      const price = parseInt(parts[0], 10);
      if (Number.isFinite(price)) {
        tiers.push({ minQty: 1, unitPrice: price });
      }
    }
  }
  return tiers;
}

// ─────────────────────────────────────────
// 도매꾹 상세 응답 → inventory_snapshots 행 변환
// ─────────────────────────────────────────

interface SnapshotRow {
  item_id: string;
  item_no: number;
  snapshot_date: string; // 'YYYY-MM-DD'
  inventory: number;
  price_dome: number | null;
  price_supply: number | null;
}

function toSnapshotRow(
  detail: DomeggookItemDetail,
  itemId: string,
  snapshotDate: string,
): SnapshotRow {
  return {
    item_id: itemId,
    item_no: detail.basis.no,
    snapshot_date: snapshotDate,
    inventory: detail.qty?.inventory ?? 0,
    price_dome: parsePrice(detail.price?.dome),
    price_supply: parsePrice(detail.price?.supply),
  };
}

// ─────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 요청 바디 파싱
    let body: unknown = {};
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
          { status: 400 },
        );
      }
    }

    // Zod 검증
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '입력값 검증 실패';
      return Response.json({ success: false, error: message }, { status: 400 });
    }

    const pool = getSourcingPool();

    // KST 기준 오늘 날짜
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const snapshotDate = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // 추적 대상 상품 조회
    let trackingResult;
    if (parsed.data.itemNos && parsed.data.itemNos.length > 0) {
      // itemNos 지정 시 IN 절로 필터링 — ANY로 배열 전달
      trackingResult = await pool.query<{ id: string; item_no: number }>(
        `SELECT id, item_no FROM sourcing_items
         WHERE is_tracking = true AND item_no = ANY($1::int[])`,
        [parsed.data.itemNos],
      );
    } else {
      trackingResult = await pool.query<{ id: string; item_no: number }>(
        `SELECT id, item_no FROM sourcing_items WHERE is_tracking = true`,
      );
    }

    const trackingItems = trackingResult.rows;

    if (trackingItems.length === 0) {
      return Response.json({
        success: true,
        data: {
          snapshotDate,
          totalProcessed: 0,
          successCount: 0,
          failedItems: [],
        },
      });
    }

    // item_no → item_id 맵 생성
    const itemIdMap = new Map<number, string>(
      trackingItems.map((row) => [row.item_no, row.id]),
    );
    const itemNos = Array.from(itemIdMap.keys());

    // 도매꾹 getItemView (ver=4.5) 배치 호출
    const domeggookClient = getDomeggookClient();
    const batchResult = await domeggookClient.getItemViewBatch(itemNos, (current, total) => {
      console.info(`[snapshot] 배치 진행: ${current}/${total}`);
    });

    // inventory_snapshots INSERT — ON CONFLICT (item_no, snapshot_date) DO UPDATE
    // 같은 날 스냅샷이 이미 있으면 상세 가격 정보로 갱신
    // sourcing_items의 MOQ / 추천판매가도 함께 갱신
    let successCount = 0;
    for (const detail of batchResult.success as DomeggookItemDetail[]) {
      const itemId = itemIdMap.get(detail.basis.no);
      if (!itemId) continue;

      const row = toSnapshotRow(detail, itemId, snapshotDate);

      // inventory_snapshots 업데이트
      const result = await pool.query(
        `INSERT INTO inventory_snapshots
           (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (item_no, snapshot_date) DO UPDATE SET
           inventory    = EXCLUDED.inventory,
           price_dome   = EXCLUDED.price_dome,
           price_supply = EXCLUDED.price_supply`,
        [
          row.item_id,
          row.item_no,
          row.snapshot_date,
          row.inventory,
          row.price_dome,
          row.price_supply,
        ],
      );
      if ((result.rowCount ?? 0) > 0) {
        successCount++;
      }

      // sourcing_items 에 MOQ / 추천판매가 / 정확한 도매가 / 카테고리 갱신
      const moq = parseQty(detail.qty?.domeMoq);
      const priceResaleRecommend = parsePrice(detail.price?.resale?.Recommand);
      const priceDome = parsePrice(detail.price?.dome);
      const categoryName = detail.category?.current?.name ?? null;
      if (moq !== null || priceResaleRecommend !== null || priceDome !== null || categoryName !== null) {
        await pool.query(
          `UPDATE sourcing_items SET
             moq                    = COALESCE($1, moq),
             price_resale_recommend = COALESCE($2, price_resale_recommend),
             price_dome             = COALESCE($3, price_dome),
             category_name          = COALESCE($4, category_name),
             updated_at             = now()
           WHERE id = $5`,
          [moq, priceResaleRecommend, priceDome, categoryName, itemId],
        );
      }

      // price_tiers — 수량별 가격 티어 전체 저장
      const domeTiers = parseAllTiers(detail.price?.dome);
      const supplyTiers = parseAllTiers(detail.price?.supply);
      const resaleTiers = parseAllTiers(detail.price?.resale?.Recommand);

      const allTiers: { type: string; minQty: number; unitPrice: number }[] = [
        ...domeTiers.map((t) => ({ type: 'dome', ...t })),
        ...supplyTiers.map((t) => ({ type: 'supply', ...t })),
        ...resaleTiers.map((t) => ({ type: 'resale', ...t })),
      ];

      if (allTiers.length > 0) {
        // 기존 티어 삭제 후 재삽입 (간결하고 정확)
        await pool.query(
          `DELETE FROM price_tiers WHERE item_id = $1`,
          [itemId],
        );
        for (const tier of allTiers) {
          await pool.query(
            `INSERT INTO price_tiers (item_id, price_type, min_qty, unit_price)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (item_id, price_type, min_qty) DO UPDATE SET
               unit_price = EXCLUDED.unit_price`,
            [itemId, tier.type, tier.minQty, tier.unitPrice],
          );
        }
      }
    }

    console.info(
      `[snapshot] 완료: 총 ${itemNos.length}건 처리, 성공 ${successCount}건, ` +
        `실패 ${batchResult.failed.length}건 (날짜: ${snapshotDate})`,
    );

    // MATERIALIZED VIEW 비동기 갱신 (CONCURRENTLY — 읽기 차단 없음, await 하지 않음)
    pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.sales_analysis_view')
      .catch((e) => console.error('[snapshot] matview refresh 실패:', e));

    return Response.json({
      success: true,
      data: {
        snapshotDate,
        totalProcessed: itemNos.length,
        successCount,
        failedItems: batchResult.failed,
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/snapshot] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
