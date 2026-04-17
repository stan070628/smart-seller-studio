/**
 * GET /api/orders/naver
 * 네이버 스마트스토어 주문 목록 조회
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const from = sp.get('from') ?? toDateStr(defaultFrom);
  const to   = sp.get('to')   ?? toDateStr(today);

  try {
    const client = getNaverCommerceClient();

    const result = await client.getOrders({ fromDate: from, toDate: to });

    // 네이버 주문을 프론트엔드 공통 포맷으로 변환
    const CANCELLED_STATUSES = new Set(['CANCELED', 'RETURNED', 'EXCHANGED']);

    const items = (result.contents ?? []).map((o) => {
      // 네이버 API는 버전에 따라 필드명이 다를 수 있음 — 두 가지 모두 대응
      const qty = o.productQuantity ?? o.quantity ?? 1;
      const amount = o.productPayAmount ?? o.totalPaymentAmount ?? 0;

      return {
        orderId: o.orderId,
        productOrderId: o.productOrderId,
        status: o.productOrderStatus,
        claimStatus: o.claimStatus,
        orderedAt: o.orderDate,
        receiverName: o.shippingAddress?.name ?? null,
        orderItems: [
          {
            sellerProductName: o.productName,
            sellerProductItemName: '',
            shippingCount: qty,
            orderPrice: amount,
            salesPrice: qty > 0 ? Math.round(amount / qty) : amount,
            canceled: CANCELLED_STATUSES.has(o.productOrderStatus),
          },
        ],
      };
    });

    // 주문일시 내림차순 정렬
    items.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    console.info(`[GET /api/orders/naver] 조회 완료: ${items.length}건 (${from} ~ ${to})`);
    return Response.json({ success: true, data: { items } });
  } catch (err) {
    console.error('[GET /api/orders/naver]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
