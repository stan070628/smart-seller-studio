// src/lib/erp/orders/adapters/coupang-wing.ts
// 쿠팡 판매자배송 — 발주서 조회(v4 ordersheets). 상태별로 부르고 nextToken을 끝까지 넘긴다.
// 🔴 orderer·receiver·parcelPrintMessage(구매자 정보)는 옮기지 않는다.
// 취소: 품목 canceled / 남은 수량 0 → canceled. 결제완료 취소처럼 목록에서 사라진 주문은 수집기가 cover 구간의 「사라짐」으로 취소 처리한다
// (absenceMeansCancel). 상태를 진행 순서대로 부르므로, 조회 중 상태가 앞으로 넘어간 주문도 뒤 상태 조회에서 잡힌다.
import type { CoupangClient, CoupangOrder } from '@/lib/listing/coupang-client';
import { assertExternalId, assertQty, rejectReasonOf, safeLineKey } from '../keys';
import { wingStatus } from '../status';
import type { OrderAdapter, OrderLine, RejectedLine } from '../types';
import { addDays, dayChunks, isoFromChannel, kstDay, kstDayStart } from '../window';

export const WING_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING'] as const;
const MAX_PAGES = 200;

export type WingClient = Pick<CoupangClient, 'getOrders'>;

/**
 * 발주서 한 건 → 라인들. 형식이 잘못된 품목(수량이 양의 정수가 아님 · id 형식 · 읽을 수 없는 시각)은 버리고 rejected로 돌려준다(I5).
 * shippingCount 0 품목은 예전처럼 조용히 건너뛴다(주문 수량이 없는 품목).
 */
export function normalizeWingOrder(o: CoupangOrder): { lines: OrderLine[]; rejected: RejectedLine[] } {
  const lines: OrderLine[] = [];
  const rejected: RejectedLine[] = [];
  const items = o.orderItems ?? [];
  const keyOf = (it: { vendorItemId: unknown }) => safeLineKey([o.shipmentBoxId, it.vendorItemId]);
  let head: { externalOrderId: string; orderedAt: string; paidAt: string };
  try {
    const orderedAt = isoFromChannel(o.orderedAt);
    // 발주서는 결제완료(ACCEPT)부터 보인다 — 결제 시각이 비어 있으면 주문 시각으로
    head = { externalOrderId: assertExternalId(String(o.orderId), '주문번호'), orderedAt, paidAt: o.paidAt ? isoFromChannel(o.paidAt) : orderedAt };
  } catch (e) {
    for (const it of items) rejected.push({ lineKey: keyOf(it), reason: rejectReasonOf(e) });
    return { lines, rejected };
  }
  for (const it of items) {
    try {
      if (Number(it.shippingCount) === 0) continue;
      const ordered = assertQty(it.shippingCount, '주문 수량');
      const cancel = Number(it.cancelCount ?? 0);
      if (!Number.isInteger(cancel) || cancel < 0) assertQty(-1, '취소 수량');
      const left = ordered - cancel;
      const qty = left > 0 ? left : ordered;
      lines.push({
        channel: 'coupang_wing',
        ...head,
        externalLineId: assertExternalId(`${o.shipmentBoxId}:${it.vendorItemId}`, '라인 키'),
        rawStatus: it.canceled ? `${o.status}/CANCELED` : o.status,
        status: wingStatus(o.status, { canceled: it.canceled, shippingCount: ordered, cancelCount: cancel }),
        productId: String(it.vendorItemId),
        optionKey: '',
        altProductId: it.sellerProductId ? String(it.sellerProductId) : null,
        productLabel: [it.sellerProductName, it.sellerProductItemName].filter(Boolean).join(' · '),
        qty,
        unitPrice: Number(it.salesPrice) || 0,
        // 발주서에는 품목 실매출이 없다 — 주문 금액을 남은 수량 비율로(설계 해석 #8)
        amount: Math.round(((Number(it.orderPrice) || 0) * qty) / ordered),
      });
    } catch (e) {
      rejected.push({ lineKey: keyOf(it), reason: rejectReasonOf(e) });
    }
  }
  return { lines, rejected };
}

export function createWingAdapter(client: WingClient): OrderAdapter {
  return {
    channel: 'coupang_wing',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      const rejected = new Map<string, RejectedLine>();
      for (const c of dayChunks(fromDay, toDay, 31)) {
        for (const status of WING_STATUSES) {
          let token: string | undefined;
          let pages = 0;
          do {
            const r = await client.getOrders({ createdAtFrom: c.from, createdAtTo: c.to, status, maxPerPage: 50, nextToken: token });
            for (const o of r.items) {
              const n = normalizeWingOrder(o);
              for (const l of n.lines) lines.set(l.externalLineId, l);
              for (const x of n.rejected) rejected.set(`${x.lineKey}|${x.reason}`, x);
            }
            token = r.nextToken ? r.nextToken : undefined;
            if (++pages >= MAX_PAGES && token) throw new Error(`쿠팡 발주서 ${status} ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
          } while (token);
        }
      }
      return {
        lines: [...lines.values()],
        rejected: [...rejected.values()],
        // 첫날은 사라짐 판정에서 뺀다(I2 — 설계 해석 #24): 커서 − 48h·꼬리일수로 잡힌 시작일은 날짜 단위 조회와 경계가 어긋날 수 있다
        cover: { field: 'ordered_at', from: kstDayStart(addDays(fromDay, 1)).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
