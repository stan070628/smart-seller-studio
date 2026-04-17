/**
 * GET /api/orders/naver/debug
 * 네이버 주문 API 원본 응답 확인용 디버그 엔드포인트
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { proxyFetch } from '@/lib/proxy-fetch';

const API_HOST = 'https://api.commerce.naver.com';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  try {
    const client = getNaverCommerceClient();
    // @ts-expect-error private 접근
    const token: string = await client.getToken();

    const call = async (method: string, path: string, body?: unknown) => {
      const res = await proxyFetch(`${API_HOST}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let json: unknown;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, ok: res.ok, body: json };
    };

    // mode=query: productOrderId 직접 조회
    const productOrderId = sp.get('productOrderId');
    if (productOrderId) {
      const result = await call(
        'POST',
        '/external/v1/pay-order/seller/product-orders/query',
        { productOrderIds: [productOrderId] },
      );
      return Response.json({ mode: 'query', productOrderId, ...result });
    }

    // mode=statuses: 날짜+상태별 productOrderId 목록 조회
    const from = sp.get('from') ?? '2026-04-16';
    const type = sp.get('type') ?? 'PAYED';
    const VALID_STATUSES = ['PAYED', 'DISPATCHED', 'PURCHASE_DECIDED', 'EXCHANGED', 'CANCELED', 'RETURNED'];
    const statuses = type === 'ALL' ? VALID_STATUSES : [type];

    const statusResults: Record<string, unknown> = {};
    for (const s of statuses) {
      await sleep(150);
      const q = new URLSearchParams({
        lastChangedFrom: `${from}T00:00:00.000+09:00`,
        lastChangedTo:   `${from}T23:59:59.000+09:00`,
        lastChangedType: s,
      });
      const r = await call('GET', `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${q}`);
      statusResults[s] = r;
    }

    return Response.json({ mode: 'statuses', from, statusResults });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
