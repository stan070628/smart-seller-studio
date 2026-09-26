// src/lib/erp/orders/adapters/toss.ts
// 토스 — 주문 v2(nextCursor를 끝까지). 상태가 명시되므로 사라짐 판정은 하지 않는다.
// 주문일로 거르는 API라 배송 후 반품 완료가 7일을 넘겨 온다 — 꼬리일수 30(설계 해석 #23, Task 2 리뷰 후속. #6의 7일을 대체).
// 🔴 orderer*·receiver*·address·detailAddress·zipCode·shippingNote는 옮기지 않는다.
// 결제 시각 칸이 없다 — 결제 상태면 주문 시각을 결제 시각으로(설계 해석 #10).
import type { TossOrder, TossShoppingClient } from '@/lib/listing/toss-shopping-client';
import { assertExternalId } from '../keys';
import { tossStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { dayChunks, isoFromChannel, kstDay } from '../window';

const MAX_PAGES = 200;
/** 설계 해석 #23 — 토스 꼬리일수 30일(#6의 7일을 대체) */
const TAIL_DAYS = 30;

export type TossClient = Pick<TossShoppingClient, 'getOrdersPage'>;

export function normalizeTossOrder(o: TossOrder): OrderLine {
  const status = tossStatus(o.orderProductStatus);
  const orderedAt = isoFromChannel(o.orderedAt);
  const qty = Number(o.quantity);
  const amount = Number(o.price) || 0;
  return {
    channel: 'toss',
    externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
    externalLineId: assertExternalId(String(o.orderProductId), '주문상품번호'),
    orderedAt,
    paidAt: status === 'unpaid' ? null : orderedAt,
    rawStatus: o.orderProductStatus,
    status,
    productId: o.productId ? String(o.productId) : '',
    optionKey: o.optionName ?? '',
    altProductId: o.stockId ? String(o.stockId) : null,
    productLabel: [o.productName, o.optionName].filter(Boolean).join(' · '),
    qty,
    // price = 판매가 × 주문 수량(공식 문서)
    unitPrice: qty > 0 ? Math.round(amount / qty) : 0,
    amount,
  };
}

export function createTossAdapter(client: TossClient): OrderAdapter {
  return {
    channel: 'toss',
    tailDays: TAIL_DAYS,
    async fetch(w) {
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(kstDay(w.from), kstDay(w.to), 30)) {
        let cursor: string | undefined;
        let pages = 0;
        do {
          const r = await client.getOrdersPage({ startDate: c.from, endDate: c.to, nextCursor: cursor });
          for (const o of r.results) {
            const l = normalizeTossOrder(o);
            lines.set(l.externalLineId, l);
          }
          cursor = r.nextCursor ?? undefined;
          if (++pages >= MAX_PAGES && cursor) throw new Error(`토스 주문 ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (cursor);
      }
      return { lines: [...lines.values()], cover: null, absenceMeansCancel: false };
    },
  };
}
