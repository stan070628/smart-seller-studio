import { describe, it, expect } from 'vitest';
import { RgShipInputError, RgShipStockError, postRgShipTransfers, validateRgShipItems } from '@/lib/erp/ledger/rg-ship';
import type { Db } from '@/lib/erp/ledger/store';

const EVENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const AT = '2026-09-27T01:00:00.000Z';

function fakeDb(skus: { id: number; status: string; has_ledger: boolean }[], lots: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select s.id, s.status')) return { rows: skus, rowCount: skus.length };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: lots, rowCount: lots.length };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('validateRgShipItems', () => {
  it('없으면 빈 배열(옛 화면 호환)', () => {
    expect(validateRgShipItems(undefined)).toEqual([]);
    expect(validateRgShipItems(null)).toEqual([]);
  });
  it('sku_id·quantity를 읽는다', () => {
    expect(validateRgShipItems([{ sku_id: 7, quantity: 3 }])).toEqual([{ skuId: 7, qty: 3 }]);
  });
  it.each([
    ['배열 아님', { sku_id: 7 }],
    ['수량 0', [{ sku_id: 7, quantity: 0 }]],
    ['소수', [{ sku_id: 7, quantity: 1.5 }]],
    ['같은 SKU 두 번', [{ sku_id: 7, quantity: 1 }, { sku_id: 7, quantity: 2 }]],
  ])('%s → RgShipInputError', (_, raw) => {
    expect(() => validateRgShipItems(raw)).toThrow(RgShipInputError);
  });
});

describe('postRgShipTransfers', () => {
  it('SKU 오름차순으로 self → rg_inbound 이동(rgship:<이벤트>:<SKU>), 원장 전표 없는 SKU는 건너뛴다', async () => {
    const f = fakeDb(
      [{ id: 9, status: 'active', has_ledger: true }, { id: 3, status: 'active', has_ledger: false }, { id: 5, status: 'active', has_ledger: true }],
      [{ lot_id: 1, qty: 50, unit_cost: 1000, lot_at: 1 }],
    );
    const r = await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: 'RG 보내기 2026-09-27', items: [{ skuId: 9, qty: 2 }, { skuId: 3, qty: 1 }, { skuId: 5, qty: 4 }] });
    expect(r.posted).toEqual([{ skuId: 5, qty: 4 }, { skuId: 9, qty: 2 }]);
    expect(r.skipped).toEqual([{ skuId: 3, qty: 1, reason: 'no_ledger' }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[10], c.params[7], c.params[8]])).toEqual([
      [5, 'self', -4, 'transfer', `rgship:${EVENT}:5#0:out`, 'rg_shipment', EVENT],
      [5, 'rg_inbound', 4, 'transfer', `rgship:${EVENT}:5#0:in`, 'rg_shipment', EVENT],
      [9, 'self', -2, 'transfer', `rgship:${EVENT}:9#0:out`, 'rg_shipment', EVENT],
      [9, 'rg_inbound', 2, 'transfer', `rgship:${EVENT}:9#0:in`, 'rg_shipment', EVENT],
    ]);
  });

  it('활성이 아니거나 없는 SKU는 RgShipInputError', async () => {
    const f = fakeDb([{ id: 5, status: 'archived', has_ledger: true }]);
    await expect(postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 1 }, { skuId: 6, qty: 1 }] }))
      .rejects.toBeInstanceOf(RgShipInputError);
  });

  it('집 원장 재고가 모자라면 SKU를 밝힌 RgShipStockError', async () => {
    const f = fakeDb([{ id: 5, status: 'active', has_ledger: true }], [{ lot_id: 1, qty: 1, unit_cost: 1000, lot_at: 1 }]);
    await expect(postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 3 }] }))
      .rejects.toThrow(/SKU 5: 집 원장 재고 1개 < 보낼 3개/);
  });

  it('보낼 SKU가 없으면 DB를 부르지 않는다', async () => {
    const f = fakeDb([]);
    expect(await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [] })).toEqual({ posted: [], skipped: [] });
    expect(f.calls).toHaveLength(0);
  });
});
