export interface BatchOp {
  type: 'update' | 'split';
  batchId: string;
  take: number;
  remainder: number;
  unitRgFee: number;
}

export interface ShipmentItem {
  id: string;
  qty: number;
}

/**
 * FIFO 배치 소진 오퍼레이션 계산.
 * DB 접근 없이 순수하게 어떤 배치를 얼마나 소진할지 결정한다.
 */
export function computeFifoBatchOps(
  batches: Array<{ id: string; quantity: number }>,
  rgQty: number,
  unitRgFee: number,
): BatchOp[] {
  const ops: BatchOp[] = [];
  let remaining = rgQty;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);

    if (take === batch.quantity) {
      ops.push({ type: 'update', batchId: batch.id, take, remainder: 0, unitRgFee });
    } else {
      ops.push({ type: 'split', batchId: batch.id, take, remainder: batch.quantity - take, unitRgFee });
    }

    remaining -= take;
  }

  return ops;
}

/**
 * 총 배송비를 수량 비례로 상품별 unit 배송비로 배분.
 * 첫 번째 상품이 반올림 나머지를 흡수한다.
 * totalFee === 0 또는 items가 빈 배열이면 빈 Map을 반환한다.
 */
export function distributeRgFee(items: ShipmentItem[], totalFee: number): Map<string, number> {
  const result = new Map<string, number>();
  if (totalFee === 0 || items.length === 0) return result;

  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  if (totalQty === 0) return result;

  // Step 1: 마지막 상품부터 수량 비례 합계 배분, 첫 번째 상품이 나머지 흡수
  let remainingFee = totalFee;
  const productTotals = new Map<string, number>();
  for (let i = items.length - 1; i >= 1; i--) {
    const t = Math.round((totalFee * items[i].qty) / totalQty);
    productTotals.set(items[i].id, t);
    remainingFee -= t;
  }
  productTotals.set(items[0].id, remainingFee);

  // Step 2: 합계 → 단위 배송비
  for (const item of items) {
    const total = productTotals.get(item.id) ?? 0;
    result.set(item.id, item.qty > 0 ? Math.round(total / item.qty) : 0);
  }

  return result;
}
