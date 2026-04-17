/**
 * GET /api/orders/naver/debug
 * 네이버 주문 API 원본 응답 확인용 디버그 엔드포인트
 * 실제 운영에서는 제거하거나 인증 추가 필요
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { proxyFetch } from '@/lib/proxy-fetch';

const API_HOST = 'https://api.commerce.naver.com';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get('from') ?? '2026-04-01';
  const to   = sp.get('to')   ?? '2026-04-17';
  const type = sp.get('type') ?? 'PAYED';

  try {
    // 1. 토큰 발급 확인
    const client = getNaverCommerceClient();
    const isValid = await client.validateCredentials();
    if (!isValid) {
      return Response.json({ step: 'auth', error: '토큰 발급 실패 — API 키 확인 필요' }, { status: 500 });
    }

    // 2. 주문 API 원본 응답 확인 (단일 상태, 토큰 직접 사용)
    // @ts-expect-error private 접근
    const token: string = await client.getToken();

    const query = new URLSearchParams({
      lastChangedFrom: `${from}T00:00:00.000+09:00`,
      lastChangedTo:   `${to}T23:59:59.000+09:00`,
      lastChangedType: type,
      limitCount: '10',
    });

    const url = `${API_HOST}/external/v1/pay-order/seller/orders?${query.toString()}`;
    const res = await proxyFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    const rawText = await res.text();
    let rawJson: unknown;
    try { rawJson = JSON.parse(rawText); } catch { rawJson = rawText; }

    return Response.json({
      step: 'orders',
      url,
      statusCode: res.status,
      statusOk: res.ok,
      rawResponse: rawJson,
    });
  } catch (err) {
    return Response.json({
      step: 'exception',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
