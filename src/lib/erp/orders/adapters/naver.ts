// src/lib/erp/orders/adapters/naver.ts
// 네이버 — 변경 상품주문(24시간 조각 · more를 끝까지) → 상품주문 상세(300건씩). 변경 시각으로 거르므로 꼬리일수 0(48시간 겹침이면 된다).
// 🔴 order.ordererName·ordererTel·shippingAddress는 옮기지 않는다. 리스팅 연결은 원상품번호 + 옵션 코드.
import type { NaverCommerceClient, NaverOrderRawItem } from '@/lib/listing/naver-commerce-client';
import { assertExternalId, assertQty, rejectReasonOf, safeLineKey } from '../keys';
import { naverStatus } from '../status';
import type { OrderAdapter, OrderLine, RejectedLine } from '../types';
import { hourChunks, isoFromChannel, kstIso } from '../window';

const MAX_PAGES = 200;
const DETAIL_BATCH = 300;

export type NaverClient = Pick<NaverCommerceClient, 'getLastChangedStatuses' | 'queryProductOrders'>;

/** 입력형 옵션 대신 남기는 라벨 */
export const REDACTED_OPTION = '(입력형 옵션 생략)';

/**
 * (M2) 옵션 라벨. 구매자가 직접 적는 입력형 옵션(「이름: 값」 — 각인 문구·요청 사항)은 개인 문구일 수 있어 남기지 않는다.
 * 「:」가 있거나 50자를 넘으면 가린다. 선택형 조합 옵션도 「색상: 블루」처럼 「:」를 쓰면 같이 가려진다 — 라벨은 진단용이고
 * 리스팅 연결은 옵션 조합 id(itemNo)로 하므로 잃는 것이 없다.
 */
export function optionLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.includes(':') || v.length > 50 ? REDACTED_OPTION : v;
}

/**
 * 상품주문 한 건 → 라인. 형식이 잘못되면 LineRejectError(어댑터가 rejected로 옮긴다 — I5).
 * (I4) 부분 취소: 수량 = remainQuantity ?? quantity. remainQuantity = 0이면 상품주문 상태와 상관없이 취소(수량 칸은 > 0이라 처음 수량을 둔다).
 * 금액 = totalPaymentAmount × 남은 수량 ÷ initialQuantity(initialQuantity > 0이고 남은 수량이 있을 때). totalPaymentAmount가 처음 수량 기준이라고 보고
 * 비례로 나눈다 — 실측 전(설계 해석 #24). 게이트 ①에서 부분 취소 건의 금액을 한 번 본다.
 */
export function normalizeNaverItem(raw: NaverOrderRawItem): OrderLine {
  const { order, productOrder: po } = raw;
  const claimStatus = po.claimStatus ?? raw.claim?.claimStatus ?? null;
  const remain = po.remainQuantity === undefined || po.remainQuantity === null ? null : Number(po.remainQuantity);
  const initial = Number(po.initialQuantity ?? po.quantity);
  const allCanceled = remain === 0;
  const qty = allCanceled ? assertQty(po.initialQuantity ?? po.quantity, '처음 수량') : assertQty(remain ?? po.quantity, '수량');
  const total = Number(po.totalPaymentAmount) || 0;
  const amount = !allCanceled && remain !== null && initial > 0 ? Math.round((total * qty) / initial) : total;
  return {
    channel: 'naver',
    externalOrderId: assertExternalId(String(order.orderId), '주문번호'),
    externalLineId: assertExternalId(String(po.productOrderId), '상품주문번호'),
    orderedAt: isoFromChannel(order.orderDate),
    paidAt: order.paymentDate ? isoFromChannel(order.paymentDate) : null,
    rawStatus: claimStatus ? `${po.productOrderStatus}/${claimStatus}` : po.productOrderStatus,
    status: allCanceled ? 'canceled' : naverStatus(po.productOrderStatus, po.claimType ?? null, claimStatus),
    productId: po.originalProductId ? String(po.originalProductId) : '',
    optionKey: po.itemNo ? String(po.itemNo) : '',
    altProductId: po.productId ? String(po.productId) : null,
    productLabel: [po.productName, optionLabel(po.productOption)].filter(Boolean).join(' · '),
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
      const rejected: RejectedLine[] = [];
      for (let i = 0; i < all.length; i += DETAIL_BATCH) {
        await pause();
        const raw = await client.queryProductOrders(all.slice(i, i + DETAIL_BATCH));
        for (const item of raw) {
          try {
            lines.push(normalizeNaverItem(item));
          } catch (e) {
            rejected.push({ lineKey: safeLineKey([item?.productOrder?.productOrderId]), reason: rejectReasonOf(e) });
          }
        }
      }
      return { lines, rejected, cover: null, absenceMeansCancel: false };
    },
  };
}
