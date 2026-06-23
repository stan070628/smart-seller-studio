/**
 * GET /api/orders/coupang
 * 쿠팡 주문 목록 조회
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getOrdersCache, setOrdersCache } from '@/lib/dashboard/orders-cache';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 쿠팡 API 최대 조회 범위는 32일 — 초과 시 32일 단위 청크로 분할
function splitDateRange(from: string, to: string, maxDays = 31): Array<{ from: string; to: string }> {
  const start = new Date(from);
  const end = new Date(to);
  const chunks: Array<{ from: string; to: string }> = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ from: toDateStr(cursor), to: toDateStr(chunkEnd) });
    cursor = new Date(chunkEnd);
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
  const status = sp.get('status') ?? undefined;
  const nextToken = sp.get('nextToken') ?? undefined;

  const ALL_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'CANCEL_DONE'];

  try {
    const client = getCoupangClient();

    // 쿠팡 API 32일 제한 — 초과 시 분할
    const dateChunks = splitDateRange(from, to);

    if (status) {
      // 특정 status 단일 조회 — 캐시 미적용 (호출 빈도 낮음)
      const chunkResults = await Promise.all(
        dateChunks.map((chunk) =>
          client.getOrders({ createdAtFrom: chunk.from, createdAtTo: chunk.to, status, nextToken, maxPerPage: 50 })
        )
      );
      const items = chunkResults.flatMap((r) => r.items);
      return Response.json({ success: true, data: { items, nextToken: null } });
    }

    // 캐시 확인
    const cacheKey = `orders:coupang:${from}:${to}`;
    const cached = await getOrdersCache<unknown[]>(cacheKey);
    if (cached) {
      return Response.json({ success: true, data: { items: cached, nextToken: null } });
    }

    // 캐시 미스 → status × dateChunk 조합을 2개씩 청킹 (429 방지)
    const CHUNK_SIZE = 2;
    const allCombinations = ALL_STATUSES.flatMap((s) => dateChunks.map((dc) => ({ status: s, ...dc })));
    const results: PromiseSettledResult<Awaited<ReturnType<typeof client.getOrders>>>[] = [];
    for (let i = 0; i < allCombinations.length; i += CHUNK_SIZE) {
      const batch = allCombinations.slice(i, i + CHUNK_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((combo) => client.getOrders({ createdAtFrom: combo.from, createdAtTo: combo.to, status: combo.status, maxPerPage: 50 }))
      );
      results.push(...batchResults);
    }

    const failedKeys: string[] = [];
    const items = results.flatMap((r, i) => {
      if (r.status === 'rejected') {
        const combo = allCombinations[i];
        failedKeys.push(`${combo.status}(${combo.from}~${combo.to})`);
        console.warn(`[GET /api/orders/coupang] ${combo.status} ${combo.from}~${combo.to} 조회 실패:`, r.reason instanceof Error ? r.reason.message : r.reason);
        return [];
      }
      return r.value.items;
    });

    if (failedKeys.length === allCombinations.length) {
      console.error(`[GET /api/orders/coupang] 전체 조회 실패 (${from}~${to}). 첫 번째 오류:`, (results[0] as PromiseRejectedResult).reason);
      return Response.json({ success: false, error: '쿠팡 주문 조회에 실패했습니다. 서버 로그를 확인하세요.' }, { status: 502 });
    }

    if (failedKeys.length > 0) {
      console.warn(`[GET /api/orders/coupang] 일부 조회 실패: [${failedKeys.join(', ')}] — 나머지 데이터로 집계`);
    }

    // 주문일시 내림차순 정렬
    items.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    if (items.length > 0) {
      setOrdersCache(cacheKey, items).catch(() => {});
    }

    return Response.json({ success: true, data: { items, nextToken: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
