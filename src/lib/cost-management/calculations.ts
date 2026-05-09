// src/lib/cost-management/calculations.ts
export interface CostEntryRow {
  id: string;
  product_cost_id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee?: number;
  shipping_group_id: string | null;
}

export interface ProductMetrics {
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  total_quantity: number;
  total_purchase_amount: number;
}

export function calculateWeightedAvg(
  entries: Pick<CostEntryRow, 'quantity' | 'unit_cost' | 'unit_shipping_fee'>[],
  field: 'unit_cost' | 'unit_shipping_fee',
): number {
  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return 0;
  return Math.round(entries.reduce((s, e) => s + e[field] * e.quantity, 0) / totalQty);
}

export function calculateProductMetrics(entries: CostEntryRow[]): ProductMetrics {
  if (entries.length === 0) {
    return { weighted_avg_cost: 0, weighted_avg_shipping: 0, total_quantity: 0, total_purchase_amount: 0 };
  }

  const weighted_avg_cost = calculateWeightedAvg(entries, 'unit_cost');
  const weighted_avg_shipping = calculateWeightedAvg(entries, 'unit_shipping_fee');
  const total_quantity = entries.reduce((s, e) => s + e.quantity, 0);
  const total_purchase_amount = entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);

  return { weighted_avg_cost, weighted_avg_shipping, total_quantity, total_purchase_amount };
}

export function distributeShippingFee(
  entries: { id: string; quantity: number }[],
  totalShippingFee: number,
): Map<string, number> {
  if (entries.length === 0) return new Map();
  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return new Map();

  const result = new Map<string, number>();
  let remaining = totalShippingFee;
  for (let i = 1; i < entries.length; i++) {
    const fee = Math.round((totalShippingFee * entries[i].quantity) / totalQty);
    result.set(entries[i].id, fee);
    remaining -= fee;
  }
  result.set(entries[0].id, remaining);
  return result;
}
