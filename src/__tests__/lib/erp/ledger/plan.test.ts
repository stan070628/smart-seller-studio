import { describe, it, expect } from 'vitest';
import { assertIdemKey, planLotCreate, planConsume, planTransfer, planReversal, type StoredRow } from '@/lib/erp/ledger/plan';
import type { LotBalance } from '@/lib/erp/ledger/fifo';

const AT = '2026-09-26T01:00:00.000Z';
const lots: LotBalance[] = [
  { lotId: 10, qty: 10, unitCost: 1000, lotAt: 1000 },
  { lotId: 20, qty: 5, unitCost: 1200, lotAt: 2000 },
];

describe('planLotCreate', () => {
  it('lot_id 없이 단가를 가진 양수 전표 하나', () => {
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 4, unitCost: 500, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:self', refType: 'opening', refId: 'x.csv' }))
      .toEqual([{ skuId: 1, location: 'self', qty: 4, kind: 'opening', lotId: null, unitCost: 500, occurredAt: AT, refType: 'opening', refId: 'x.csv', reversesId: null, idemKey: 'opening:1:self', note: null, reason: null }]);
  });

  it.each([-1, 1.5])('단가 %s는 RangeError', (u) => {
    expect(() => planLotCreate({ skuId: 1, location: 'self', qty: 1, unitCost: u, kind: 'receipt', occurredAt: AT, idemKey: 'k' })).toThrow(RangeError);
  });
});

describe('planConsume', () => {
  it('lot별 음수 전표, 멱등키에 순번', () => {
    const rows = planConsume({ skuId: 1, location: 'self', qty: 12, kind: 'sale', occurredAt: AT, idemKey: 'sale:A' }, lots);
    expect(rows.map((r) => [r.lotId, r.qty, r.unitCost, r.idemKey])).toEqual([
      [10, -10, null, 'sale:A#0'],
      [20, -2, null, 'sale:A#1'],
    ]);
    expect(rows.every((r) => r.kind === 'sale' && r.location === 'self')).toBe(true);
  });
});

describe('planTransfer', () => {
  it('lot마다 출발지 음수·도착지 양수 쌍, lot 번호 유지', () => {
    const rows = planTransfer({ skuId: 1, from: 'self', to: 'rg_inbound', qty: 11, occurredAt: AT, idemKey: 'tr:1' }, lots);
    expect(rows.map((r) => [r.location, r.lotId, r.qty, r.idemKey])).toEqual([
      ['self', 10, -10, 'tr:1#0:out'],
      ['rg_inbound', 10, 10, 'tr:1#0:in'],
      ['self', 20, -1, 'tr:1#1:out'],
      ['rg_inbound', 20, 1, 'tr:1#1:in'],
    ]);
    expect(rows.every((r) => r.kind === 'transfer' && r.unitCost === null)).toBe(true);
  });

  it('출발지와 도착지가 같으면 RangeError', () => {
    expect(() => planTransfer({ skuId: 1, from: 'rg', to: 'rg', qty: 1, occurredAt: AT, idemKey: 'k' }, lots)).toThrow(RangeError);
  });
});

describe('planReversal', () => {
  const base: StoredRow = { id: 55, skuId: 1, location: 'self', qty: -3, kind: 'sale', lotId: 10, unitCost: null, occurredAt: AT, refType: 'order', refId: 'O1', reversesId: null, idemKey: 'sale:A#0', note: null };

  it('차감 전표는 같은 lot으로 부호만 뒤집는다', () => {
    expect(planReversal(base, { occurredAt: AT, idemKey: 'rev:sale:A#0' })).toMatchObject({
      skuId: 1, location: 'self', qty: 3, kind: 'reversal', lotId: 10, unitCost: null, reversesId: 55, idemKey: 'rev:sale:A#0', refType: 'order', refId: 'O1',
    });
  });

  it('lot 생성 전표를 되돌리면 자기 id를 lot으로 가리킨다', () => {
    const lot: StoredRow = { ...base, id: 10, qty: 10, kind: 'receipt', lotId: null, unitCost: 1000 };
    expect(planReversal(lot, { occurredAt: AT, idemKey: 'rev:r' })).toMatchObject({ qty: -10, lotId: 10, unitCost: null, reversesId: 10 });
  });

  it('역전표는 되돌리지 않는다', () => {
    expect(() => planReversal({ ...base, kind: 'reversal', reversesId: 1 }, { occurredAt: AT, idemKey: 'x' })).toThrow(RangeError);
  });
});

describe('assertIdemKey', () => {
  it.each(['sale:A#1', 'rev:x', ''])('%j는 RangeError', (k) => {
    expect(() => assertIdemKey(k)).toThrow(RangeError);
  });

  it('버전 키는 받는다', () => {
    expect(() => assertIdemKey('sale:A@2')).not.toThrow();
  });

  it('계획 함수 셋이 모두 검사한다', () => {
    expect(() => planLotCreate({ skuId: 1, location: 'self', qty: 1, unitCost: 1, kind: 'receipt', occurredAt: AT, idemKey: 'r#1' })).toThrow(RangeError);
    expect(() => planConsume({ skuId: 1, location: 'self', qty: 1, kind: 'sale', occurredAt: AT, idemKey: 'rev:s' }, lots)).toThrow(RangeError);
    expect(() => planTransfer({ skuId: 1, from: 'self', to: 'rg', qty: 1, occurredAt: AT, idemKey: 't#0' }, lots)).toThrow(RangeError);
  });
});

describe('사유(reason)', () => {
  it('lot 생성·차감 전표는 사유를 싣고, 이동·역전표는 비운다', () => {
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 1, unitCost: 1, kind: 'adjust', reason: 'return_in', occurredAt: AT, idemKey: 'adj:x' })[0].reason).toBe('return_in');
    expect(planConsume({ skuId: 1, location: 'self', qty: 1, kind: 'adjust', reason: 'damage', occurredAt: AT, idemKey: 'adj:y' }, lots)[0].reason).toBe('damage');
    expect(planTransfer({ skuId: 1, from: 'self', to: 'rg_inbound', qty: 1, occurredAt: AT, idemKey: 't' }, lots)[0].reason).toBeNull();
    const stored: StoredRow = { id: 5, skuId: 1, location: 'self', qty: -1, kind: 'adjust', lotId: 10, unitCost: null, occurredAt: AT, refType: 'adjust', refId: 'r', reversesId: null, idemKey: 'adj:y#0', note: null, reason: 'damage' };
    expect(planReversal(stored, { occurredAt: AT, idemKey: 'rev:adj:y#0' }).reason).toBeNull();
  });
});
