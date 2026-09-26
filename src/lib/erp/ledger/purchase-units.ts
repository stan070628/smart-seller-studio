// src/lib/erp/ledger/purchase-units.ts
// erp.purchase_units 첫 적재 계획(순수). costco_item_map(품번 → product_cost) → SKU(erp.skus.legacy_product_cost_ids).
// 품번 : SKU = 1 : N — 옵션이 여러 SKU로 나뉜 상품은 품번 하나가 SKU 여럿에 걸린다(영수증 확정 때 사람이 나눈다).
/** 1-A 검토에서 오매핑 의심으로 적은 품번(docs/erp/sku-review-2026-09-26.md). 사용자가 확인한 것만 넣는다 */
export const SUSPECT_CODES = ['693742', '888450'] as const;

export interface ItemMapRow {
  itemCode: string;
  itemLabel: string | null;
  productCostId: string;
  defaultDecision: string;
}

export interface SkuLink {
  id: number;
  key: string;
  legacyProductCostIds: string[];
}

export interface PurchaseUnitRow {
  supplierCode: string;
  label: string | null;
  skuId: number;
  skuKey: string;
}

export function planPurchaseUnits(
  maps: ItemMapRow[],
  skus: SkuLink[],
  include: Set<string>,
): { rows: PurchaseUnitRow[]; held: ItemMapRow[]; unlinked: ItemMapRow[]; skipped: ItemMapRow[] } {
  const rows: PurchaseUnitRow[] = [];
  const held: ItemMapRow[] = [];
  const unlinked: ItemMapRow[] = [];
  const skipped: ItemMapRow[] = [];
  const suspect: readonly string[] = SUSPECT_CODES;
  for (const m of maps) {
    if (m.defaultDecision === 'skip') { skipped.push(m); continue; }
    if (suspect.includes(m.itemCode) && !include.has(m.itemCode)) { held.push(m); continue; }
    const linked = skus.filter((s) => s.legacyProductCostIds.includes(m.productCostId));
    if (linked.length === 0) { unlinked.push(m); continue; }
    for (const s of linked) rows.push({ supplierCode: m.itemCode, label: m.itemLabel, skuId: s.id, skuKey: s.key });
  }
  rows.sort((a, b) => (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : a.skuId - b.skuId));
  return { rows, held, unlinked, skipped };
}
