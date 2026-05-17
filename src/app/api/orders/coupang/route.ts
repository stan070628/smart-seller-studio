/**
 * GET /api/orders/coupang
 * 쿠팡 주문 목록 조회
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
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

    if (status) {
      // 특정 status 단일 조회
      const result = await client.getOrders({ createdAtFrom: from, createdAtTo: to, status, nextToken, maxPerPage: 50 });
      return Response.json({ success: true, data: result });
    }

    // status 미지정 → 2개씩 chunk로 조회 (429 방지)
    const CHUNK_SIZE = 2;
    const results: PromiseSettledResult<Awaited<ReturnType<typeof client.getOrders>>>[] = [];
    for (let i = 0; i < ALL_STATUSES.length; i += CHUNK_SIZE) {
      const chunk = ALL_STATUSES.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.allSettled(
        chunk.map((s) => client.getOrders({ createdAtFrom: from, createdAtTo: to, status: s, maxPerPage: 50 }))
      );
      results.push(...chunkResults);
    }

    const failedStatuses: string[] = [];
    const items = results.flatMap((r, i) => {
      if (r.status === 'rejected') {
        failedStatuses.push(ALL_STATUSES[i]);
        console.warn(`[GET /api/orders/coupang] status=${ALL_STATUSES[i]} 조회 실패:`, r.reason instanceof Error ? r.reason.message : r.reason);
        return [];
      }
      return r.value.items;
    });

    if (failedStatuses.length === ALL_STATUSES.length) {
      console.error(`[GET /api/orders/coupang] 전체 status 조회 실패 (${from}~${to}). 첫 번째 오류:`, (results[0] as PromiseRejectedResult).reason);
      return Response.json({ success: false, error: '쿠팡 주문 조회에 실패했습니다. 서버 로그를 확인하세요.' }, { status: 502 });
    }

    if (failedStatuses.length > 0) {
      console.warn(`[GET /api/orders/coupang] 일부 status 조회 실패: [${failedStatuses.join(', ')}] — 나머지 데이터로 집계`);
    }

    // 주문일시 내림차순 정렬
    items.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    return Response.json({ success: true, data: { items, nextToken: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
