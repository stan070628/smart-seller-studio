/**
 * GET /api/orders/coupang-rg?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 로켓그로스 판매 내역 조회 (revenue-history API 기반)
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
  const rawTo = sp.get('to') ?? toDateStr(today);

  // revenue-history API 제약: recognitionDateTo는 어제까지만 허용
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const to = rawTo > toDateStr(yesterday) ? toDateStr(yesterday) : rawTo;

  if (to < from) {
    return Response.json({ success: true, data: { items: [] } });
  }

  try {
    const client = getCoupangClient();
    const allOrders: Array<{
      orderId: string;
      saleDate: string;
      recognitionDate: string;
      items: Array<{
        sellerProductId: number;
        vendorItemId: number;
        vendorItemName: string;
        quantity: number;
        salePrice: number;
        saleAmount: number;
      }>;
    }> = [];

    let token = '';
    const MAX_PAGES = 30;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getRevenueHistory({
        recognitionDateFrom: from,
        recognitionDateTo: to,
        maxPerPage: 50,
        token,
      });

      for (const order of result.items) {
        if (order.saleType !== 'ROCKET_GROWTH') continue;
        allOrders.push({
          orderId: order.orderId,
          saleDate: order.saleDate || order.recognitionDate,
          recognitionDate: order.recognitionDate,
          items: order.items.map((i) => ({
            sellerProductId: i.sellerProductId,
            vendorItemId: i.vendorItemId,
            vendorItemName: i.vendorItemName,
            quantity: i.quantity,
            salePrice: i.salePrice,
            saleAmount: i.saleAmount,
          })),
        });
      }

      if (!result.nextToken) break;
      token = result.nextToken;
    }

    // 판매일 내림차순 정렬
    allOrders.sort((a, b) => b.saleDate.localeCompare(a.saleDate));

    return Response.json({ success: true, data: { items: allOrders } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
