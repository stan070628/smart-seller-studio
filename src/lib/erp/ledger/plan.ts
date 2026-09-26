// src/lib/erp/ledger/plan.ts
// 전표 계획. 무엇을 기록할지만 정하고 DB는 모른다(store.ts가 기록한다).
import { allocateFifo, assertQty, type Location, type LotBalance } from './fifo';

export type LedgerKind = 'opening' | 'receipt' | 'transfer' | 'sale' | 'return' | 'adjust' | 'reversal';

export interface LedgerRow {
  skuId: number;
  location: Location;
  qty: number;
  kind: LedgerKind;
  /** null = 이 전표가 lot을 만든다 */
  lotId: number | null;
  /** lot을 만드는 전표에만 있다 */
  unitCost: number | null;
  occurredAt: string;
  refType: string | null;
  refId: string | null;
  reversesId: number | null;
  idemKey: string;
  note: string | null;
}

export interface StoredRow extends LedgerRow {
  id: number;
}

export interface RefInput {
  refType?: string;
  refId?: string;
  note?: string;
}

export interface LotCreateInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  unitCost: number;
  kind: 'opening' | 'receipt' | 'adjust';
  occurredAt: string;
  idemKey: string;
}

export interface ConsumeInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  kind: 'sale' | 'adjust';
  occurredAt: string;
  idemKey: string;
}

export interface TransferInput extends RefInput {
  skuId: number;
  from: Location;
  to: Location;
  qty: number;
  occurredAt: string;
  idemKey: string;
}

/** 호출자 멱등키. '#'는 전표 순번 구분자, 'rev:'는 역전표 접두라 쓸 수 없다 — 쓰면 다른 전표와 키가 겹쳐 조용히 누락된다. */
export function assertIdemKey(k: string): void {
  if (!k || k.includes('#') || k.startsWith('rev:')) throw new RangeError(`멱등키에 '#'·'rev:' 접두는 쓸 수 없다: ${k}`);
}

const refOf = (p: RefInput) => ({ refType: p.refType ?? null, refId: p.refId ?? null, note: p.note ?? null });

export function planLotCreate(p: LotCreateInput): LedgerRow[] {
  assertIdemKey(p.idemKey);
  assertQty(p.qty);
  if (!Number.isInteger(p.unitCost) || p.unitCost < 0) throw new RangeError(`단가는 0 이상의 정수여야 한다: ${p.unitCost}`);
  return [{
    skuId: p.skuId, location: p.location, qty: p.qty, kind: p.kind, lotId: null, unitCost: p.unitCost,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: p.idemKey,
  }];
}

/** FIFO로 lot을 골라 lot마다 음수 전표 하나. 멱등키는 `${idemKey}#${순번}` */
export function planConsume(p: ConsumeInput, lots: LotBalance[]): LedgerRow[] {
  assertIdemKey(p.idemKey);
  return allocateFifo(lots, p.qty).map((t, i) => ({
    skuId: p.skuId, location: p.location, qty: -t.qty, kind: p.kind, lotId: t.lotId, unitCost: null,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: `${p.idemKey}#${i}`,
  }));
}

/** 출발지 lot을 FIFO로 골라 lot마다 (출발지 −, 도착지 +) 한 쌍. lot 번호와 단가는 그대로 따라간다. */
export function planTransfer(p: TransferInput, fromLots: LotBalance[]): LedgerRow[] {
  assertIdemKey(p.idemKey);
  if (p.from === p.to) throw new RangeError(`출발지와 도착지가 같다: ${p.from}`);
  return allocateFifo(fromLots, p.qty).flatMap((t, i) => {
    const common = { skuId: p.skuId, kind: 'transfer' as const, lotId: t.lotId, unitCost: null, occurredAt: p.occurredAt, ...refOf(p), reversesId: null };
    return [
      { ...common, location: p.from, qty: -t.qty, idemKey: `${p.idemKey}#${i}:out` },
      { ...common, location: p.to, qty: t.qty, idemKey: `${p.idemKey}#${i}:in` },
    ];
  });
}

/** 전표 하나를 상쇄한다. lot을 만든 전표를 되돌리면 그 전표 자신을 lot으로 가리킨다. */
export function planReversal(orig: StoredRow, p: { occurredAt: string; idemKey: string; note?: string }): LedgerRow {
  if (orig.kind === 'reversal') throw new RangeError('역전표는 되돌리지 않는다 — 원 전표를 다시 기록한다');
  return {
    skuId: orig.skuId, location: orig.location, qty: -orig.qty, kind: 'reversal', lotId: orig.lotId ?? orig.id, unitCost: null,
    occurredAt: p.occurredAt, refType: orig.refType, refId: orig.refId, reversesId: orig.id, idemKey: p.idemKey, note: p.note ?? null,
  };
}
