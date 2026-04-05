/**
 * POST /api/sourcing/fetch-items
 * 도매꾹 getItemList (v4.1) 호출 → sourcing_items upsert + inventory_snapshots INSERT
 *
 * v4.1부터 list[].qty.inventory가 포함되므로,
 * 목록 수집과 재고 스냅샷 저장을 단일 요청으로 처리한다.
 *
 * 요청: { keyword?: string; category?: string }
 * 응답: { success: true, data: { totalFetched, newItems, updatedItems, snapshotsSaved } }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { DomeggookListItem } from '@/types/sourcing';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const requestSchema = z.object({
  /** 검색 키워드 (기본: '생활용품') */
  keyword: z.string().optional(),
  /** 여러 키워드를 순회하며 수집 */
  keywords: z.array(z.string()).optional(),
  /** 카테고리 코드 — 지정 시 keyword 대신 ca 파라미터로 전달 */
  category: z.string().optional(),
  /** 페이지당 수 (기본 200, 최대 200) */
  pageSize: z.number().min(1).max(200).optional(),
  /** 수집할 최대 페이지 수 (기본 1, 전체=0) */
  maxPages: z.number().min(0).optional(),
});

// ─────────────────────────────────────────
// 도매꾹 v4.1 list 항목 → sourcing_items 행 변환
// ─────────────────────────────────────────

interface SourcingItemRow {
  item_no: number;
  title: string;
  status: string | null;
  category_name: string | null;
  seller_id: string | null;
  seller_nick: string | null;
  image_url: string | null;
  dome_url: string | null;
  is_tracking: boolean;
  unit_qty: number | null;
  price_dome: number | null;
  deli_who: string | null;
  deli_fee: number | null;
}

/** 문자열/숫자 → 정수 변환 (실패 시 null) */
function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function toSourcingItemRow(item: DomeggookListItem): SourcingItemRow {
  return {
    item_no: toInt(item.no) ?? 0,
    title: String(item.title ?? ''),
    status: null,
    category_name: null,
    seller_id: item.id ? String(item.id) : null,
    seller_nick: item.nick ? String(item.nick) : null,
    image_url: item.thumb ? String(item.thumb) : null,
    dome_url: item.url ? String(item.url) : null,
    is_tracking: true,
    unit_qty: toInt(item.unitQty),
    price_dome: toInt(item.price),
    deli_who: item.deli?.who ? String(item.deli.who) : null,
    deli_fee: toInt(item.deli?.fee),
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

    const { keyword, keywords, category, pageSize = 200, maxPages = 1 } = parsed.data;

    // keywords 배열이 있으면 사용, 없으면 keyword 단일값 사용
    const keywordList = keywords && keywords.length > 0
      ? keywords
      : [keyword ?? '생활용품'];

    // KST 기준 오늘 날짜 (스냅샷 저장용)
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const snapshotDate = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // 도매꾹 API 호출 — 키워드별 순회
    const client = getDomeggookClient();
    const allItems: import('@/types/sourcing').DomeggookListItem[] = [];
    const seenNos = new Set<number>(); // 중복 제거

    for (const kw of keywordList) {
      try {
        if (maxPages === 0) {
          const items = await client.getAllItems({ keyword: kw, category, pageSize });
          for (const item of items) {
            if (!seenNos.has(item.no)) { seenNos.add(item.no); allItems.push(item); }
          }
        } else {
          for (let pg = 1; pg <= maxPages; pg++) {
            const page = await client.getItemList({ keyword: kw, category, pageSize, page: pg });
            for (const item of page.list) {
              if (!seenNos.has(item.no)) { seenNos.add(item.no); allItems.push(item); }
            }
            if (pg >= page.header.numberOfPages) break;
          }
        }
        console.info(`[fetch-items] 키워드 "${kw}" 수집 완료 (누적 ${allItems.length}건)`);
      } catch (err) {
        console.warn(`[fetch-items] 키워드 "${kw}" 수집 실패:`, err);
      }
    }

    if (allItems.length === 0) {
      return Response.json({
        success: true,
        data: { totalFetched: 0, newItems: 0, updatedItems: 0, snapshotsSaved: 0 },
      });
    }

    const pool = getSourcingPool();
    const now = new Date();
    const THRESHOLD_MS = 5000; // 5초 이내 생성이면 신규로 간주

    let newItems = 0;
    let updatedItems = 0;
    let snapshotsSaved = 0;

    for (const item of allItems) {
      const row = toSourcingItemRow(item);

      // sourcing_items upsert — image_url, dome_url 및 배송/묶음 정보 갱신
      const upsertResult = await pool.query<{ id: string; created_at: string }>(
        `INSERT INTO sourcing_items
           (item_no, title, status, category_name, seller_id, seller_nick,
            image_url, dome_url, is_tracking,
            unit_qty, price_dome, deli_who, deli_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (item_no) DO UPDATE SET
           title         = EXCLUDED.title,
           seller_id     = EXCLUDED.seller_id,
           seller_nick   = EXCLUDED.seller_nick,
           image_url     = EXCLUDED.image_url,
           dome_url      = EXCLUDED.dome_url,
           is_tracking   = EXCLUDED.is_tracking,
           unit_qty      = EXCLUDED.unit_qty,
           price_dome    = COALESCE(EXCLUDED.price_dome, sourcing_items.price_dome),
           deli_who      = COALESCE(EXCLUDED.deli_who, sourcing_items.deli_who),
           deli_fee      = COALESCE(EXCLUDED.deli_fee, sourcing_items.deli_fee),
           updated_at    = now()
         RETURNING id, created_at`,
        [
          row.item_no,
          row.title,
          row.status,
          row.category_name,
          row.seller_id,
          row.seller_nick,
          row.image_url,
          row.dome_url,
          row.is_tracking,
          row.unit_qty,
          row.price_dome,
          row.deli_who,
          row.deli_fee,
        ],
      );

      const returned = upsertResult.rows[0];
      if (returned) {
        const createdAt = new Date(returned.created_at);
        if (now.getTime() - createdAt.getTime() < THRESHOLD_MS) {
          newItems++;
        } else {
          updatedItems++;
        }

        // v4.1 목록에 재고(qty.inventory)가 있으면 스냅샷도 즉시 저장
        const inventory = item.qty?.inventory;
        if (inventory !== undefined) {
          const snapshotResult = await pool.query(
            `INSERT INTO inventory_snapshots
               (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (item_no, snapshot_date) DO NOTHING`,
            [
              returned.id,
              row.item_no,
              snapshotDate,
              inventory,
              item.price ?? null,   // getItemList의 price는 판매가
              null,                 // supply 가격은 getItemView에서만 제공
            ],
          );
          if ((snapshotResult.rowCount ?? 0) > 0) {
            snapshotsSaved++;
          }
        }
      }
    }

    console.info(
      `[fetch-items] 완료: 총 ${allItems.length}건 수집, 신규 ${newItems}건, ` +
        `업데이트 ${updatedItems}건, 스냅샷 ${snapshotsSaved}건 저장 (날짜: ${snapshotDate})`,
    );

    return Response.json({
      success: true,
      data: {
        totalFetched: allItems.length,
        newItems,
        updatedItems,
        snapshotsSaved,
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/fetch-items] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
