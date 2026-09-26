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
    // 직접 매칭으로 고른 옛 상품은 옛 불러오기와 같은 단위로 센다: 쿠팡 pcc = 주문 수량 × unit_multiplier,
    // RG vendor_item_id·네이버 채널상품번호 = 주문 수량 그대로(direct()가 배수 1로 준다). SKU 배수와 옛 상품 단위는 다를 수 있다.
    if (hit) return { productCostId: hit.productCostId, qty: l.qty * Math.max(1, hit.multiplier) };
    const qty = r.alloc.length > 0
      ? r.alloc.reduce((s, a) => s + a.qty, 0)
      : l.qty * Math.min(...r.listingSkus.map((s) => s.multiplier));
    return { productCostId: candidates[0], qty };
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

export interface LegacyWarning {
  key: string;
  /** 팔림 라인이 있는데 옛 상품을 하나도 못 골랐다 — 기존 행은 그대로 둔다(쓰지도 무효화하지도 않는다) */
  reason: 'sold_without_product_cost';
}

/**
 * 키별로 묶어 쓸 행·무효화할 키를 정한다. 살아 있는 라인 = 팔림 + 옛 상품 있음 + 수량 > 0.
 * 합산 단위: 같은 키 = 같은 주문·같은 상품 키(분리배송 박스)라 라인들은 같은 리스팅·같은 옛 상품을 고른다 — legacyQty를 그냥 더한다.
 *   라인마다 옛 상품이 다르게 골라지면(연결 변경 직후 등) 첫 라인의 옛 상품에 다른 단위(bundle 구성·배수)의 수량이 섞일 수 있다.
 *   지금 bundle 리스팅은 0건(2026-09-26 실측)이라 이 경우를 따로 가르지 않는다.
 */
export function planLegacy(lines: LegacyLine[]): { upsert: LegacyRow[]; voidKeys: string[]; warnings: LegacyWarning[] } {
  const groups = new Map<string, LegacyLine[]>();
  for (const l of lines) {
    const g = groups.get(l.legacyKey) ?? [];
    g.push(l);
    groups.set(l.legacyKey, g);
  }
  const upsert: LegacyRow[] = [];
  const voidKeys: string[] = [];
  const warnings: LegacyWarning[] = [];
  for (const [key, g] of groups) {
    const live = g.filter((l) => SOLD.has(l.status) && l.productCostId !== null && (l.legacyQty ?? 0) > 0);
    if (live.length === 0) {
      // 팔림인데 옛 상품이 사라졌다(연결 해제 등) — 판매는 유효하므로 무효화하지 않고 알린다
      if (g.some((l) => SOLD.has(l.status) && l.productCostId === null)) warnings.push({ key, reason: 'sold_without_product_cost' });
      else if (g.some((l) => VOID.has(l.status))) voidKeys.push(key);
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
  return { upsert, voidKeys, warnings };
}
