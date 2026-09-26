import { describe, it, expect } from 'vitest';
import { RgShipInputError, RgShipStockError, postRgShipTransfers, validateRgShipItems } from '@/lib/erp/ledger/rg-ship';
import type { Db } from '@/lib/erp/ledger/store';

const EVENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const AT = '2026-09-27T01:00:00.000Z';

/**
 * selfLedger: skuId → self 위치에 원장 전표가 있는지. 없는 키는 false(전표 없음)로 취급한다.
 * lots: self 위치 잔여 lot(loadLots가 돌려줄 값) — postTransfer가 self→rg_inbound로 소진할 때 쓴다.
 */
function fakeDb(
  skus: { id: number; status: string }[],
  selfLedger: Record<number, boolean> = {},
  lots: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[] = [],
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select s.id, s.status')) return { rows: skus, rowCount: skus.length };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select s.id, exists')) {
        const ids = params[0] as number[];
        return { rows: ids.map((id) => ({ id, has_self_ledger: selfLedger[id] ?? false })), rowCount: ids.length };
      }
      if (sql.startsWith('select 1 from erp.stock_ledger where idem_key')) return { rows: [], rowCount: 0 };
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
  it('SKU 오름차순으로 self → rg_inbound 이동(rgship:<이벤트>:<SKU>), self 원장 없는 SKU는 건너뛴다', async () => {
    const f = fakeDb(
      [{ id: 9, status: 'active' }, { id: 3, status: 'active' }, { id: 5, status: 'active' }],
      { 9: true, 3: false, 5: true },
      [{ lot_id: 1, qty: 50, unit_cost: 1000, lot_at: 1 }],
    );
    const r = await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: 'RG 보내기 2026-09-27', items: [{ skuId: 9, qty: 2 }, { skuId: 3, qty: 1 }, { skuId: 5, qty: 4 }] });
    expect(r.posted).toEqual([{ skuId: 5, qty: 4 }, { skuId: 9, qty: 2 }]);
    expect(r.skipped).toEqual([{ skuId: 3, qty: 1, reason: 'no_self_ledger' }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[10], c.params[7], c.params[8]])).toEqual([
      [5, 'self', -4, 'transfer', `rgship:${EVENT}:5#0:out`, 'rg_shipment', EVENT],
      [5, 'rg_inbound', 4, 'transfer', `rgship:${EVENT}:5#0:in`, 'rg_shipment', EVENT],
      [9, 'self', -2, 'transfer', `rgship:${EVENT}:9#0:out`, 'rg_shipment', EVENT],
      [9, 'rg_inbound', 2, 'transfer', `rgship:${EVENT}:9#0:in`, 'rg_shipment', EVENT],
    ]);
  });

  it('rg 위치에만 전표가 있고 self 전표는 없는 SKU → 건너뛴다, 409(재고부족)로 던지지 않는다', async () => {
    // has_self_ledger는 self 위치로 스코프된 exists이므로 rg 전표 존재는 반영하지 않는다(fakeDb가 이미 그렇게 흉내낸다).
    const f = fakeDb([{ id: 5, status: 'active' }], { 5: false });
    const r = await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 3 }] });
    expect(r.posted).toEqual([]);
    expect(r.skipped).toEqual([{ skuId: 5, qty: 3, reason: 'no_self_ledger' }]);
    // postTransfer(따라서 loadLots·insert)가 전혀 불리지 않았다 — 재고 부족 검사 자체가 안 돈다
    expect(f.calls.some((c) => c.sql.startsWith('select coalesce(l.lot_id'))).toBe(false);
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.stock_ledger'))).toBe(false);
  });

  it('self 원장 존재 확인은 SKU 잠금을 전부 잡은 뒤에 한다', async () => {
    const f = fakeDb([{ id: 3, status: 'active' }, { id: 5, status: 'active' }], { 3: true, 5: true }, [{ lot_id: 1, qty: 50, unit_cost: 1000, lot_at: 1 }]);
    await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 1 }, { skuId: 3, qty: 1 }] });
    // 잠금 2건(오름차순 SKU 3·5) 다음에 self 원장 확인 select가 온다. 그 뒤로는 실제 이동(postTransfer)이
    // 다시 잠금·전표를 쓰므로 처음 3건만 본다.
    const kinds = f.calls.map((c) => (c.sql.startsWith('select pg_advisory_xact_lock') ? 'lock' : c.sql.startsWith('select s.id, exists') ? 'self_ledger_check' : null)).filter(Boolean);
    expect(kinds.slice(0, 3)).toEqual(['lock', 'lock', 'self_ledger_check']);
  });

  it('활성이 아니거나 없는 SKU는 RgShipInputError', async () => {
    const f = fakeDb([{ id: 5, status: 'archived' }]);
    await expect(postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 1 }, { skuId: 6, qty: 1 }] }))
      .rejects.toBeInstanceOf(RgShipInputError);
  });

  it('집 원장 재고가 모자라면 SKU를 밝힌 RgShipStockError', async () => {
    const f = fakeDb([{ id: 5, status: 'active' }], { 5: true }, [{ lot_id: 1, qty: 1, unit_cost: 1000, lot_at: 1 }]);
    const promise = postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 3 }] });
    await expect(promise).rejects.toBeInstanceOf(RgShipStockError);
    await expect(promise).rejects.toThrow(/SKU 5: 집 원장 재고 1개 < 보낼 3개/);
  });

  it('보낼 SKU가 없으면 DB를 부르지 않는다', async () => {
    const f = fakeDb([]);
    expect(await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [] })).toEqual({ posted: [], skipped: [] });
    expect(f.calls).toHaveLength(0);
  });
});
