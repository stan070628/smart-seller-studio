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

    // status 미지정 → 전체 status 병렬 조회 후 합산
    const results = await Promise.allSettled(
      ALL_STATUSES.map((s) => client.getOrders({ createdAtFrom: from, createdAtTo: to, status: s, maxPerPage: 50 }))
    );

    const items = results.flatMap((r) => r.status === 'fulfilled' ? r.value.items : []);
    // 주문일시 내림차순 정렬
    items.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    return Response.json({ success: true, data: { items, nextToken: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
