/**
 * GET /api/orders/toss
 * 토스쇼핑 주문 목록 조회
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getTossShoppingClient } from '@/lib/listing/toss-shopping-client';
import { getOrdersCache, setOrdersCache } from '@/lib/dashboard/orders-cache';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  // 2026-09-26 탐색: 로그인 없이 구매자 정보를 돌려주고 있었다(ERP 1-C1 보안 선행)
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const from = sp.get('from') ?? toDateStr(defaultFrom);
  const to   = sp.get('to')   ?? toDateStr(today);

  try {
    const cacheKey = `orders:toss:${from}:${to}`;
    const cached = await getOrdersCache<unknown[]>(cacheKey);
    if (cached) {
      return Response.json({ success: true, data: { items: cached } });
    }

    const client = getTossShoppingClient();
    const orders = await client.getOrders({ startDate: from, endDate: to });

    // 주문일시 내림차순 정렬
    orders.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    if (orders.length > 0) {
      setOrdersCache(cacheKey, orders).catch(() => {});
    }

    console.info(`[GET /api/orders/toss] 조회 완료: ${orders.length}건 (${from} ~ ${to})`);
    return Response.json({ success: true, data: { items: orders } });
  } catch (err) {
    console.error('[GET /api/orders/toss]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
