// src/__tests__/lib/erp/ledger/rg-arrive.test.ts
import { describe, it, expect } from 'vitest';
import { assertIdemKey } from '@/lib/erp/ledger/plan';
import { AdjustInputError } from '@/lib/erp/ledger/adjust';
import { InsufficientStockError } from '@/lib/erp/ledger/fifo';
import { postRgArrivals, rgArriveIdemKey, validateRgArriveItems } from '@/lib/erp/ledger/rg-arrive';
import type { Db } from '@/lib/erp/ledger/store';

const A = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const B = '4f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f61';

describe('validateRgArriveItems', () => {
  it('[{ skuId, qty, requestId }] — 요청 id는 소문자로 맞춘다', () => {
    expect(validateRgArriveItems([{ skuId: 7, qty: 2, requestId: A.toUpperCase() }])).toEqual([{ skuId: 7, qty: 2, requestId: A }]);
  });
  it.each([
    ['배열이 아님', {}],
    ['빈 배열', []],
    ['sku 0', [{ skuId: 0, qty: 1, requestId: A }]],
    ['수량 0', [{ skuId: 7, qty: 0, requestId: A }]],
    ['소수 수량', [{ skuId: 7, qty: 1.5, requestId: A }]],
    ['문자 수량', [{ skuId: 7, qty: '2', requestId: A }]],
    ['uuid 아님', [{ skuId: 7, qty: 1, requestId: 'x' }]],
    ['같은 SKU 두 번', [{ skuId: 7, qty: 1, requestId: A }, { skuId: 7, qty: 1, requestId: B }]],
    ['같은 요청 id 두 번', [{ skuId: 7, qty: 1, requestId: A }, { skuId: 8, qty: 1, requestId: A }]],
  ])('%s → AdjustInputError', (_l, raw) => {
    expect(() => validateRgArriveItems(raw)).toThrow(AdjustInputError);
  });
  it('멱등키 rgdone:<uuid>는 1-B 멱등키 규칙을 통과한다', () => {
    expect(rgArriveIdemKey(A)).toBe(`rgdone:${A}`);
    expect(() => assertIdemKey(rgArriveIdemKey(A))).not.toThrow();
  });
});

function fakeDb(o: { lots?: Record<number, { lot_id: number; qty: number }[]>; posted?: string[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 500;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) {
        const hit = (o.posted ?? []).includes(String(params[0]));
        return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
      }
      if (sql.startsWith('select coalesce(l.lot_id, l.id) as lot_id')) {
        const lots = params[1] === 'rg_inbound' ? (o.lots?.[Number(params[0])] ?? []) : [];
        return { rows: lots.map((l) => ({ ...l, unit_cost: 1000, lot_at: 1 })), rowCount: lots.length };
      }
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('postRgArrivals', () => {
  const AT = '2026-09-27T01:00:00.000Z';

  it('🔴 SKU 오름차순으로 먼저 모두 잠그고 rg_inbound → rg 이동(멱등키 rgdone:<uuid>)', async () => {
    const f = fakeDb({ lots: { 7: [{ lot_id: 1, qty: 3 }], 9: [{ lot_id: 2, qty: 5 }] } });
    const out = await postRgArrivals(f.db, [{ skuId: 9, qty: 2, requestId: B }, { skuId: 7, qty: 3, requestId: A }], AT);
    expect(out).toEqual([
      { skuId: 7, qty: 3, requestId: A, outcome: 'posted' },
      { skuId: 9, qty: 2, requestId: B, outcome: 'posted' },
    ]);
    const locks = f.calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock')).map((c) => c.params[1]);
    expect(locks.slice(0, 2)).toEqual([7, 9]);
    const firstInsert = f.calls.findIndex((c) => c.sql.startsWith('insert'));
    const secondLock = f.calls.findIndex((c, i) => c.sql.startsWith('select pg_advisory_xact_lock') && c.params[1] === 9 && i > 0);
    expect(secondLock).toBeLessThan(firstInsert);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger')).map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[6], c.params[7], c.params[8], c.params[10]]);
    expect(ins).toEqual([
      [7, 'rg_inbound', -3, 'transfer', AT, 'rg_arrive', A, `rgdone:${A}#0:out`],
      [7, 'rg', 3, 'transfer', AT, 'rg_arrive', A, `rgdone:${A}#0:in`],
      [9, 'rg_inbound', -2, 'transfer', AT, 'rg_arrive', B, `rgdone:${B}#0:out`],
      [9, 'rg', 2, 'transfer', AT, 'rg_arrive', B, `rgdone:${B}#0:in`],
    ]);
  });

  it('같은 요청 id 재전송은 duplicate(쓰지 않는다)', async () => {
    const f = fakeDb({ posted: [`rgdone:${A}`] });
    expect(await postRgArrivals(f.db, [{ skuId: 7, qty: 3, requestId: A }], AT)).toEqual([{ skuId: 7, qty: 3, requestId: A, outcome: 'duplicate' }]);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('입고중 재고가 모자라면 InsufficientStockError(몇 번째 SKU인지 함께)', async () => {
    const f = fakeDb({ lots: { 7: [{ lot_id: 1, qty: 1 }] } });
    await expect(postRgArrivals(f.db, [{ skuId: 7, qty: 3, requestId: A }], AT)).rejects.toSatisfy(
      (e: unknown) => (e as { inner?: unknown }).inner instanceof InsufficientStockError && (e as { skuId?: number }).skuId === 7,
    );
  });
});
