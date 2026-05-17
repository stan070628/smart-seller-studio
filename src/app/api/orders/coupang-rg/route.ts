/**
 * GET /api/orders/coupang-rg?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 로켓그로스 주문 목록 조회 (rg_open_api 기반)
 *
 * 쿠팡 API 제약:
 *  - 최대 30일 조회 (초과 시 30일 단위로 chunk)
 *  - Rate limit 분당 50회 (coupang-client의 429 자동 재시도가 흡수)
 *  - 출고일 이후 주문만 반환
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60 * 1000;

type RgOrder = {
  orderId: string;
  saleDate: string;
  recognitionDate: string;
  items: Array<{
    sellerProductId: number;  // 새 API에서는 미제공 → 0
    vendorItemId: number;
    vendorItemName: string;
    quantity: number;
    salePrice: number;
    saleAmount: number;
  }>;
};

const cache = new Map<string, { data: RgOrder[]; expiresAt: number }>();

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "1746093162000" (ms 타임스탬프 문자열) → "2026-05-01" (YYYY-MM-DD) */
function timestampToDateStr(tsMs: string): string {
  const n = Number(tsMs);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n).toISOString().slice(0, 10);
}

/** [from, to] 기간을 최대 30일짜리 [start, end] chunk 배열로 분할 */
function splitInto30DayChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const fromDate = new Date(from);
  const toDate = new Date(to);
  let cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 29); // 30일 (포함)
    if (end > toDate) end.setTime(toDate.getTime());
    chunks.push({ from: toDateStr(cursor), to: toDateStr(end) });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const from = sp.get('from') ?? toDateStr(defaultFrom);
  const to = sp.get('to') ?? toDateStr(today);

  if (to < from) {
    return Response.json({ success: true, data: { items: [] } });
  }

  const cacheKey = `${from}:${to}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: { items: cached.data } });
  }

  try {
    const client = getCoupangClient();
    const allOrders: RgOrder[] = [];
    const chunks = splitInto30DayChunks(from, to);

    for (const chunk of chunks) {
      let nextToken = '';
      const MAX_PAGES = 50;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await client.getRocketGrowthOrders({
          paidDateFrom: chunk.from,
          paidDateTo: chunk.to,
          nextToken: nextToken || undefined,
        });

        for (const order of result.items) {
          const saleDate = timestampToDateStr(order.paidAt);
          allOrders.push({
            orderId: order.orderId,
            saleDate,
            recognitionDate: saleDate,
            items: order.orderItems.map((i) => ({
              sellerProductId: 0,
              vendorItemId: i.vendorItemId,
              vendorItemName: i.productName,
              quantity: i.salesQuantity,
              salePrice: i.unitSalesPrice,
              saleAmount: i.salesQuantity * i.unitSalesPrice,
            })),
          });
        }

        console.log(`[coupang-rg] chunk=${chunk.from}~${chunk.to} page=${page + 1} items=${result.items.length} nextToken=${result.nextToken ? 'yes' : 'none'}`);

        if (!result.nextToken) break;
        nextToken = result.nextToken;
      }
    }

    console.log(`[coupang-rg] 총 수집 ${allOrders.length}건 (${from}~${to}, ${chunks.length} chunk)`);

    // 판매일 내림차순 정렬
    allOrders.sort((a, b) => b.saleDate.localeCompare(a.saleDate));

    // 빈 결과는 캐시하지 않음
    if (allOrders.length > 0) {
      cache.set(cacheKey, { data: allOrders, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return Response.json({ success: true, data: { items: allOrders } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
