// src/lib/erp/orders/adapters/naver.ts
// 네이버 — 변경 상품주문(24시간 조각 · more를 끝까지) → 상품주문 상세(300건씩). 변경 시각으로 거르므로 꼬리일수 0(48시간 겹침이면 된다).
// 🔴 order.ordererName·ordererTel·shippingAddress는 옮기지 않는다. 리스팅 연결은 원상품번호 + 옵션 코드.
import type { NaverCommerceClient, NaverOrderRawItem } from '@/lib/listing/naver-commerce-client';
import { assertExternalId } from '../keys';
import { naverStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { hourChunks, isoFromChannel, kstIso } from '../window';

const MAX_PAGES = 200;
const DETAIL_BATCH = 300;

export type NaverClient = Pick<NaverCommerceClient, 'getLastChangedStatuses' | 'queryProductOrders'>;

export function normalizeNaverItem(raw: NaverOrderRawItem): OrderLine {
  const { order, productOrder: po } = raw;
  const claimStatus = po.claimStatus ?? raw.claim?.claimStatus ?? null;
  const qty = Number(po.quantity);
  const amount = Number(po.totalPaymentAmount) || 0;
  return {
    channel: 'naver',
    externalOrderId: assertExternalId(String(order.orderId), '주문번호'),
    externalLineId: assertExternalId(String(po.productOrderId), '상품주문번호'),
    orderedAt: isoFromChannel(order.orderDate),
    paidAt: order.paymentDate ? isoFromChannel(order.paymentDate) : null,
    rawStatus: claimStatus ? `${po.productOrderStatus}/${claimStatus}` : po.productOrderStatus,
    status: naverStatus(po.productOrderStatus, po.claimType ?? null, claimStatus),
    productId: po.originalProductId ? String(po.originalProductId) : '',
    optionKey: po.optionCode ? String(po.optionCode) : '',
    altProductId: po.productId ? String(po.productId) : null,
    productLabel: [po.productName, po.productOption].filter(Boolean).join(' · '),
    qty,
    unitPrice: po.unitPrice ?? (qty > 0 ? Math.round(amount / qty) : 0),
    amount,
  };
}

export function createNaverAdapter(client: NaverClient, opts: { sleepMs?: number } = {}): OrderAdapter {
  // 연속 호출 429 방지(옛 getOrders와 같은 500ms)
  const pause = () => new Promise<void>((r) => setTimeout(r, opts.sleepMs ?? 500));
  return {
    channel: 'naver',
    tailDays: 0,
    async fetch(w) {
      const ids = new Set<string>();
      for (const c of hourChunks(w)) {
        let from = kstIso(c.from);
        const to = kstIso(c.to);
        let seq: string | undefined;
        let pages = 0;
        do {
          await pause();
          const r = await client.getLastChangedStatuses({ from, to, moreSequence: seq });
          for (const s of r.statuses) ids.add(String(s.productOrderId));
          if (r.more && r.more.moreSequence) {
            from = r.more.moreFrom;
            seq = r.more.moreSequence;
          } else {
            seq = undefined;
          }
          if (++pages >= MAX_PAGES && seq) throw new Error(`네이버 변경 조회 ${to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (seq);
      }
      const all = [...ids];
      const lines: OrderLine[] = [];
      for (let i = 0; i < all.length; i += DETAIL_BATCH) {
        await pause();
        const raw = await client.queryProductOrders(all.slice(i, i + DETAIL_BATCH));
        lines.push(...raw.map(normalizeNaverItem));
      }
      return { lines, cover: null, absenceMeansCancel: false };
    },
  };
}
