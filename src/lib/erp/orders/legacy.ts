// src/lib/erp/orders/legacy.ts
// 옛 장부(sale_records) — 수익·원가 화면이 버튼 없이 채워지게 수집 라인마다 한 행(키가 같으면 합산).
// product_cost 고르기(설계 해석 #13): 라인 SKU(미귀속이면 리스팅 SKU)의 legacy_product_cost_ids 중 리스팅과 맞는 것 → 첫 값
//   → SKU가 없으면 옛 불러오기의 직접 매칭 → 그래도 없으면 쓰지 않는다.
import type { ShippingSource } from '@/lib/cost-management/sale-shipping';
import { LEGACY_CHANNEL, SHIPPING_SOURCE } from './keys';
import type { Resolution } from './resolve';
import { SOLD, VOID, type OrderChannel, type OrderLine, type StdStatus } from './types';
import { kstDay } from './window';

export interface LegacyIndex {
  /** SKU → legacy_product_cost_ids(순서 유지) */
  skuLegacy: Map<number, string[]>;
  /** `${channel_type}:${external_id}` → product_cost_channels 행들(쿠팡 wing·rg) */
  pcc: Map<string, { productCostId: string; multiplier: number }[]>;
  /** product_costs.vendor_item_id → id(RG 옛 경로) */
  pcByVendorItem: Map<string, string>;
  /** product_costs.naver_channel_product_no → id */
  pcByNaverChannelNo: Map<string, string>;
}

export interface LegacyTarget {
  productCostId: string;
  /** sale_records.quantity(배수 적용) */
  qty: number;
}

function direct(l: OrderLine, idx: LegacyIndex): { productCostId: string; multiplier: number }[] {
  if (l.channel === 'coupang_wing' || l.channel === 'coupang_rg') {
    const rows = [...(idx.pcc.get(`${l.channel}:${l.productId}`) ?? [])];
    const byVid = l.channel === 'coupang_rg' ? idx.pcByVendorItem.get(l.productId) : undefined;
    if (byVid && !rows.some((r) => r.productCostId === byVid)) rows.push({ productCostId: byVid, multiplier: 1 });
    return rows;
  }
  if (l.channel === 'naver' && l.altProductId) {
    const pc = idx.pcByNaverChannelNo.get(l.altProductId);
    return pc ? [{ productCostId: pc, multiplier: 1 }] : [];
  }
  return [];
}

export function pickLegacy(l: OrderLine, r: Resolution, idx: LegacyIndex): LegacyTarget | null {
  const skuIds = (r.alloc.length > 0 ? r.alloc.map((a) => a.skuId) : r.listingSkus.map((s) => s.skuId)).sort((a, b) => a - b);
  const candidates = skuIds.flatMap((s) => idx.skuLegacy.get(s) ?? []);
  const matches = direct(l, idx);
  if (candidates.length > 0) {
    const hit = matches.find((m) => candidates.includes(m.productCostId));
    const qty = r.alloc.length > 0
      ? r.alloc.reduce((s, a) => s + a.qty, 0)
      : l.qty * Math.min(...r.listingSkus.map((s) => s.multiplier));
    return { productCostId: hit ? hit.productCostId : candidates[0], qty };
  }
  if (matches.length > 0) return { productCostId: matches[0].productCostId, qty: l.qty * Math.max(1, matches[0].multiplier) };
  return null;
}

export interface LegacyLine {
  legacyKey: string;
  channel: OrderChannel;
  status: StdStatus;
  orderQty: number;
  legacyQty: number | null;
  amount: number;
  paidAt: string | null;
  orderedAt: string;
  productCostId: string | null;
}

export interface LegacyRow {
  key: string;
  productCostId: string;
  /** sale_records.channel */
  channel: string;
  /** KST YYYY-MM-DD */
  soldAt: string;
  quantity: number;
  sellingPrice: number;
  saleAmount: number;
  shippingSource: ShippingSource;
}

/** 키별로 묶어 쓸 행·무효화할 키를 정한다. 살아 있는 라인 = 팔림 + 옛 상품 있음 + 수량 > 0 */
export function planLegacy(lines: LegacyLine[]): { upsert: LegacyRow[]; voidKeys: string[] } {
  const groups = new Map<string, LegacyLine[]>();
  for (const l of lines) {
    const g = groups.get(l.legacyKey) ?? [];
    g.push(l);
    groups.set(l.legacyKey, g);
  }
  const upsert: LegacyRow[] = [];
  const voidKeys: string[] = [];
  for (const [key, g] of groups) {
    const live = g.filter((l) => SOLD.has(l.status) && l.productCostId !== null && (l.legacyQty ?? 0) > 0);
    if (live.length === 0) {
      if (g.some((l) => VOID.has(l.status))) voidKeys.push(key);
      continue;
    }
    const saleAmount = live.reduce((s, l) => s + l.amount, 0);
    const orderQty = live.reduce((s, l) => s + l.orderQty, 0);
    const first = live[0];
    const soldAtIso = live.map((l) => l.paidAt ?? l.orderedAt).sort()[0];
    upsert.push({
      key,
      productCostId: first.productCostId as string,
      channel: LEGACY_CHANNEL[first.channel],
      soldAt: kstDay(soldAtIso),
      quantity: live.reduce((s, l) => s + (l.legacyQty ?? 0), 0),
      sellingPrice: orderQty > 0 ? Math.round(saleAmount / orderQty) : 0,
      saleAmount,
      shippingSource: SHIPPING_SOURCE[first.channel],
    });
  }
  return { upsert, voidKeys };
}
