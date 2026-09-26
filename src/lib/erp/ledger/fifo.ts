// src/lib/erp/ledger/fifo.ts
// 재고 원장 위치와 FIFO 배분. DB 없는 순수 함수.

/** self = 자체보관 · rg_inbound = RG로 보냈으나 판매 가능 수량에 아직 안 잡힘 · rg = RG 판매 가능 */
export type Location = 'self' | 'rg_inbound' | 'rg';

export interface LotBalance {
  lotId: number;
  qty: number;
  unitCost: number;
  /** lot을 만든 전표의 발생 시각(epoch ms). FIFO 순서의 기준 */
  lotAt: number;
}

export interface Take {
  lotId: number;
  qty: number;
  unitCost: number;
}

export class InsufficientStockError extends Error {
  constructor(public readonly need: number, public readonly have: number) {
    super(`재고 부족 — 필요 ${need}, 가용 ${have}`);
    this.name = 'InsufficientStockError';
  }
}

export function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError(`수량은 양의 정수여야 한다: ${qty}`);
}

/** 오래된 lot부터(같은 시각이면 lot 번호 순) qty만큼 떼어낸다. 모자라면 아무것도 떼지 않고 던진다. */
export function allocateFifo(lots: LotBalance[], qty: number): Take[] {
  assertQty(qty);
  const open = lots
    .filter((l) => l.qty > 0)
    .sort((a, b) => a.lotAt - b.lotAt || a.lotId - b.lotId);
  const have = open.reduce((s, l) => s + l.qty, 0);
  if (have < qty) throw new InsufficientStockError(qty, have);
  const takes: Take[] = [];
  let left = qty;
  for (const l of open) {
    if (left === 0) break;
    const q = Math.min(left, l.qty);
    takes.push({ lotId: l.lotId, qty: q, unitCost: l.unitCost });
    left -= q;
  }
  return takes;
}
