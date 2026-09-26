// src/components/orders/rg-sku-split.ts
// RG 보내기 모달: 옛 원가 상품(product_cost) 보낼 수량 → 원장 SKU 수량(서버가 SKU별 self → rg_inbound 이동을 기록한다).
// 연결은 erp.skus.legacy_product_cost_ids. SKU가 하나면 보낼 수량 전부, 여럿(옵션)이면 사람이 나눈다.
export interface SkuOption {
  skuId: number;
  key: string;
  name: string;
  option: string;
  /** 집 원장 재고 */
  self: number;
  /** self 위치에 원장 전표가 있다 — false면 서버가 이 SKU의 이동을 건너뛴다(rg-ship.ts no_self_ledger) */
  hasSelfLedger: boolean;
  legacyProductCostIds: string[];
}

export function skusForProduct(productId: string, skus: SkuOption[]): SkuOption[] {
  return skus.filter((s) => s.legacyProductCostIds.includes(productId));
}

export function buildSkuItems(
  products: { id: string; qty: number }[],
  skus: SkuOption[],
  skuQty: Record<number, string>,
): { items: { sku_id: number; quantity: number }[]; mismatched: { productId: string; productQty: number; skuSum: number }[] } {
  const bySku = new Map<number, number>();
  const mismatched: { productId: string; productQty: number; skuSum: number }[] = [];
  for (const p of products) {
    if (p.qty <= 0) continue;
    const linked = skusForProduct(p.id, skus);
    if (linked.length === 0) continue;
    if (linked.length === 1) {
      bySku.set(linked[0].skuId, (bySku.get(linked[0].skuId) ?? 0) + p.qty);
      continue;
    }
    let sum = 0;
    for (const s of linked) {
      const q = Math.max(0, parseInt(skuQty[s.skuId] ?? '0', 10) || 0);
      if (q > 0) bySku.set(s.skuId, (bySku.get(s.skuId) ?? 0) + q);
      sum += q;
    }
    if (sum !== p.qty) mismatched.push({ productId: p.id, productQty: p.qty, skuSum: sum });
  }
  return { items: [...bySku].sort((a, b) => a[0] - b[0]).map(([sku_id, quantity]) => ({ sku_id, quantity })), mismatched };
}
