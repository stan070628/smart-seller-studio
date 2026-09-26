// src/lib/erp/orders/adapters/coupang-rg.ts
// 쿠팡 RG — 로켓그로스 주문 조회(rg_open_api). paidDateTo는 배타 끝이라 「마지막 날 + 1」을 넘긴다(옛 rg-bulk-import 경계 버그 재발 금지).
// RG API는 취소를 플래그로 주지 않고 응답에서 뺀다 → absenceMeansCancel. 같은 주문의 같은 vid 품목은 합친다(옛 불러오기와 같다).
import type { CoupangClient } from '@/lib/listing/coupang-client';
import { assertExternalId } from '../keys';
import type { OrderAdapter, OrderLine } from '../types';
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

export function normalizeRgOrder(o: RgOrder): OrderLine[] {
  const paidAt = paidIso(o.paidAt);
  const byVid = new Map<number, { qty: number; amount: number; unit: number; name: string }>();
  for (const it of o.orderItems) {
    if (!(it.salesQuantity > 0)) continue;
    const cur = byVid.get(it.vendorItemId) ?? { qty: 0, amount: 0, unit: it.unitSalesPrice, name: it.productName };
    cur.qty += it.salesQuantity;
    cur.amount += it.unitSalesPrice * it.salesQuantity;
    byVid.set(it.vendorItemId, cur);
  }
  return [...byVid].map(([vid, v]) => ({
    channel: 'coupang_rg' as const,
    externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
    externalLineId: assertExternalId(`${o.orderId}:${vid}`, '라인 키'),
    orderedAt: paidAt,
    paidAt,
    rawStatus: 'PAID',
    status: 'paid' as const,
    productId: String(vid),
    optionKey: '',
    altProductId: null,
    productLabel: v.name,
    qty: v.qty,
    unitPrice: v.unit,
    amount: v.amount,
  }));
}

export function createRgAdapter(client: RgClient): OrderAdapter {
  return {
    channel: 'coupang_rg',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(fromDay, toDay, CHUNK_DAYS)) {
        let token: string | undefined;
        let pages = 0;
        do {
          const r = await client.getRocketGrowthOrders({ paidDateFrom: c.from, paidDateTo: addDays(c.to, 1), nextToken: token });
          for (const o of r.items) for (const l of normalizeRgOrder(o)) lines.set(l.externalLineId, l);
          token = r.nextToken ? r.nextToken : undefined;
          if (++pages >= MAX_PAGES && token) throw new Error(`RG 주문 ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (token);
      }
      return {
        lines: [...lines.values()],
        cover: { field: 'paid_at', from: kstDayStart(fromDay).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
