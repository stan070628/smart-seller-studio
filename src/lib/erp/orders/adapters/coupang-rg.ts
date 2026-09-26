// src/lib/erp/orders/adapters/coupang-rg.ts
// 쿠팡 RG — 로켓그로스 주문 조회(rg_open_api). paidDateTo는 배타 끝이라 「마지막 날 + 1」을 넘긴다(옛 rg-bulk-import 경계 버그 재발 금지).
// RG API는 취소를 플래그로 주지 않고 응답에서 뺀다 → absenceMeansCancel. 같은 주문의 같은 vid 품목은 합친다(옛 불러오기와 같다).
import type { CoupangClient } from '@/lib/listing/coupang-client';
import { assertExternalId, assertQty, rejectReasonOf, safeLineKey } from '../keys';
import type { OrderAdapter, OrderLine, RejectedLine } from '../types';
import { addDays, dayChunks, isoFromChannel, kstDay, kstDayStart } from '../window';

const MAX_PAGES = 200;
/** 한 번에 29일(시작·끝 포함). 배타 끝을 더해도 조회 폭이 30일을 넘지 않는다 */
const CHUNK_DAYS = 29;

export type RgClient = Pick<CoupangClient, 'getRocketGrowthOrders'>;
type RgOrder = Awaited<ReturnType<CoupangClient['getRocketGrowthOrders']>>['items'][number];

function paidIso(v: string): string {
  if (/^\d+$/.test(v)) return new Date(Number(v)).toISOString();
  return isoFromChannel(v);
}

/**
 * RG 주문 한 건 → 라인들(같은 vid 합산). 수량 0 품목은 예전처럼 건너뛴다. 수량이 정수가 아니거나 음수인 품목 · id 형식 ·
 * 읽을 수 없는 결제 시각은 버리고 rejected로 돌려준다(I5). 잘못된 품목이 있는 vid는 합산에서도 뺀다.
 */
export function normalizeRgOrder(o: RgOrder): { lines: OrderLine[]; rejected: RejectedLine[] } {
  const rejected = new Map<string, RejectedLine>();
  const reject = (vid: unknown, e: unknown) => {
    const k = safeLineKey([o.orderId, vid]);
    rejected.set(k, { lineKey: k, reason: rejectReasonOf(e) });
  };
  let paidAt: string;
  let orderId: string;
  try {
    paidAt = paidIso(o.paidAt);
    orderId = assertExternalId(String(o.orderId), '주문번호');
  } catch (e) {
    for (const it of o.orderItems) reject(it.vendorItemId, e);
    return { lines: [], rejected: [...rejected.values()] };
  }
  const byVid = new Map<string, { qty: number; amount: number; unit: number; name: string }>();
  const bad = new Set<string>();
  for (const it of o.orderItems) {
    const vid = String(it.vendorItemId);
    try {
      if (Number(it.salesQuantity) === 0) continue;
      const q = assertQty(it.salesQuantity, '판매 수량');
      assertExternalId(`${orderId}:${vid}`, '라인 키');
      const cur = byVid.get(vid) ?? { qty: 0, amount: 0, unit: it.unitSalesPrice, name: it.productName };
      cur.qty += q;
      cur.amount += it.unitSalesPrice * q;
      byVid.set(vid, cur);
    } catch (e) {
      bad.add(vid);
      reject(it.vendorItemId, e);
    }
  }
  const lines = [...byVid].filter(([vid]) => !bad.has(vid)).map(([vid, v]) => ({
    channel: 'coupang_rg' as const,
    externalOrderId: orderId,
    externalLineId: `${orderId}:${vid}`,
    orderedAt: paidAt,
    paidAt,
    rawStatus: 'PAID',
    status: 'paid' as const,
    productId: vid,
    optionKey: '',
    altProductId: null,
    productLabel: v.name,
    qty: v.qty,
    unitPrice: v.unit,
    amount: v.amount,
  }));
  return { lines, rejected: [...rejected.values()] };
}

export function createRgAdapter(client: RgClient): OrderAdapter {
  return {
    channel: 'coupang_rg',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      const rejected = new Map<string, RejectedLine>();
      for (const c of dayChunks(fromDay, toDay, CHUNK_DAYS)) {
        let token: string | undefined;
        let pages = 0;
        do {
          const r = await client.getRocketGrowthOrders({ paidDateFrom: c.from, paidDateTo: addDays(c.to, 1), nextToken: token });
          for (const o of r.items) {
            const n = normalizeRgOrder(o);
            for (const l of n.lines) lines.set(l.externalLineId, l);
            for (const x of n.rejected) rejected.set(`${x.lineKey}|${x.reason}`, x);
          }
          token = r.nextToken ? r.nextToken : undefined;
          if (++pages >= MAX_PAGES && token) throw new Error(`RG 주문 ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (token);
      }
      return {
        lines: [...lines.values()],
        rejected: [...rejected.values()],
        // 첫날은 사라짐 판정에서 뺀다(I2 — 설계 해석 #24)
        cover: { field: 'paid_at', from: kstDayStart(addDays(fromDay, 1)).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
