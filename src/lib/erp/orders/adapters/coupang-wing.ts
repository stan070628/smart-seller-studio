// src/lib/erp/orders/adapters/coupang-wing.ts
// 쿠팡 판매자배송 — 발주서 조회(v4 ordersheets). 상태별로 부르고 nextToken을 끝까지 넘긴다.
// 🔴 orderer·receiver·parcelPrintMessage(구매자 정보)는 옮기지 않는다.
// 취소: 품목 canceled / 남은 수량 0 → canceled. 결제완료 취소처럼 목록에서 사라진 주문은 수집기가 cover 구간의 「사라짐」으로 취소 처리한다
// (absenceMeansCancel). 상태를 진행 순서대로 부르므로, 조회 중 상태가 앞으로 넘어간 주문도 뒤 상태 조회에서 잡힌다.
import type { CoupangClient, CoupangOrder } from '@/lib/listing/coupang-client';
import { assertExternalId } from '../keys';
import { wingStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { addDays, dayChunks, isoFromChannel, kstDay, kstDayStart } from '../window';

export const WING_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING'] as const;
const MAX_PAGES = 200;

export type WingClient = Pick<CoupangClient, 'getOrders'>;

export function normalizeWingOrder(o: CoupangOrder): OrderLine[] {
  const orderedAt = isoFromChannel(o.orderedAt);
  // 발주서는 결제완료(ACCEPT)부터 보인다 — 결제 시각이 비어 있으면 주문 시각으로
  const paidAt = o.paidAt ? isoFromChannel(o.paidAt) : orderedAt;
  const out: OrderLine[] = [];
  for (const it of o.orderItems ?? []) {
    const ordered = Number(it.shippingCount) || 0;
    if (ordered <= 0) continue;
    const left = ordered - (Number(it.cancelCount) || 0);
    const qty = left > 0 ? left : ordered;
    out.push({
      channel: 'coupang_wing',
      externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
      externalLineId: assertExternalId(`${o.shipmentBoxId}:${it.vendorItemId}`, '라인 키'),
      orderedAt,
      paidAt,
      rawStatus: it.canceled ? `${o.status}/CANCELED` : o.status,
      status: wingStatus(o.status, { canceled: it.canceled, shippingCount: ordered, cancelCount: Number(it.cancelCount) || 0 }),
      productId: String(it.vendorItemId),
      optionKey: '',
      altProductId: it.sellerProductId ? String(it.sellerProductId) : null,
      productLabel: [it.sellerProductName, it.sellerProductItemName].filter(Boolean).join(' · '),
      qty,
      unitPrice: Number(it.salesPrice) || 0,
      // 발주서에는 품목 실매출이 없다 — 주문 금액을 남은 수량 비율로(설계 해석 #8)
      amount: Math.round(((Number(it.orderPrice) || 0) * qty) / ordered),
    });
  }
  return out;
}

export function createWingAdapter(client: WingClient): OrderAdapter {
  return {
    channel: 'coupang_wing',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(fromDay, toDay, 31)) {
        for (const status of WING_STATUSES) {
          let token: string | undefined;
          let pages = 0;
          do {
            const r = await client.getOrders({ createdAtFrom: c.from, createdAtTo: c.to, status, maxPerPage: 50, nextToken: token });
            for (const o of r.items) for (const l of normalizeWingOrder(o)) lines.set(l.externalLineId, l);
            token = r.nextToken ? r.nextToken : undefined;
            if (++pages >= MAX_PAGES && token) throw new Error(`쿠팡 발주서 ${status} ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
          } while (token);
        }
      }
      return {
        lines: [...lines.values()],
        cover: { field: 'ordered_at', from: kstDayStart(fromDay).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
