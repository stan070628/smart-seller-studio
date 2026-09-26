import { describe, it, expect, beforeEach } from 'vitest';
import { postConsume, postLotCreate, postTransfer, reverse, type Db } from '@/lib/erp/ledger/store';

const AT = '2026-09-26T01:00:00.000Z';

/** SQL 앞부분으로 분기하는 가짜 DB. 기록된 질의를 calls에 남긴다. */
function fakeDb(opts: { posted?: boolean; lots?: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[]; stored?: Record<string, unknown>[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: opts.posted ? [{}] : [], rowCount: opts.posted ? 1 : 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: opts.lots ?? [], rowCount: (opts.lots ?? []).length };
      if (sql.startsWith('select id, sku_id')) return { rows: opts.stored ?? [], rowCount: (opts.stored ?? []).length };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('store', () => {
  let f: ReturnType<typeof fakeDb>;
  beforeEach(() => { f = fakeDb(); });

  it('잠금 → 멱등 확인 → 기록 순서', async () => {
    const r = await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 3, unitCost: 900, kind: 'opening', occurredAt: AT, idemKey: 'opening:7:self' });
    expect(r).toEqual({ posted: true, ids: [100] });
    expect(f.calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(f.calls[0].params).toEqual([7101, 7]);
    expect(f.calls[1].sql).toMatch(/^select 1 from erp\.stock_ledger/);
    expect(f.calls[1].params).toEqual(['opening:7:self', 'opening:7:self#%']);
    expect(f.calls[2].params).toEqual([7, 'self', 3, 'opening', null, 900, AT, null, null, null, 'opening:7:self', null, null]);
  });

  it('이미 기록된 멱등키면 쓰지 않는다', async () => {
    f = fakeDb({ posted: true });
    const r = await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 3, unitCost: 900, kind: 'opening', occurredAt: AT, idemKey: 'k' });
    expect(r).toEqual({ posted: false, ids: [] });
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
    expect(f.calls.some((c) => c.sql.startsWith('set constraints'))).toBe(false);
  });

  it('기록 직후 음수 검사를 즉시 돌리고 다시 지연으로 돌려놓는다', async () => {
    f = fakeDb({ lots: [{ lot_id: 10, qty: 5, unit_cost: 1000, lot_at: 1000 }] });
    await postConsume(f.db, { skuId: 7, location: 'self', qty: 2, kind: 'sale', occurredAt: AT, idemKey: 'sale:Y' });
    const sqls = f.calls.map((c) => c.sql);
    const lastInsert = sqls.map((q) => q.startsWith('insert')).lastIndexOf(true);
    expect(sqls.slice(lastInsert + 1)).toEqual([
      'set constraints erp.stock_ledger_balance immediate',
      'set constraints erp.stock_ledger_balance deferred',
    ]);
  });

  it('멱등키의 LIKE 특수문자를 이스케이프한다', async () => {
    await postLotCreate(f.db, { skuId: 1, location: 'rg_inbound', qty: 1, unitCost: 0, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:rg_inbound' });
    expect(f.calls[1].params[1]).toBe('opening:1:rg\\_inbound#%');
  });

  it('차감은 해당 위치의 lot을 FIFO로 소진한다', async () => {
    f = fakeDb({ lots: [{ lot_id: 20, qty: 5, unit_cost: 1200, lot_at: 2000 }, { lot_id: 10, qty: 2, unit_cost: 1000, lot_at: 1000 }] });
    await postConsume(f.db, { skuId: 7, location: 'rg', qty: 3, kind: 'sale', occurredAt: AT, idemKey: 'sale:X' });
    const lotQuery = f.calls.find((c) => c.sql.startsWith('select coalesce(l.lot_id'))!;
    expect(lotQuery.params).toEqual([7, 'rg']);
    const inserts = f.calls.filter((c) => c.sql.startsWith('insert'));
    expect(inserts.map((c) => [c.params[4], c.params[2], c.params[10]])).toEqual([[10, -2, 'sale:X#0'], [20, -1, 'sale:X#1']]);
  });

  it('이동은 출발지 lot을 읽는다', async () => {
    f = fakeDb({ lots: [{ lot_id: 10, qty: 5, unit_cost: 1000, lot_at: 1000 }] });
    await postTransfer(f.db, { skuId: 7, from: 'self', to: 'rg_inbound', qty: 2, occurredAt: AT, idemKey: 'tr:1' });
    expect(f.calls.find((c) => c.sql.startsWith('select coalesce(l.lot_id'))!.params).toEqual([7, 'self']);
    expect(f.calls.filter((c) => c.sql.startsWith('insert')).map((c) => [c.params[1], c.params[2]])).toEqual([['self', -2], ['rg_inbound', 2]]);
  });

  it('reverse는 원 멱등키의 전표 전부를 rev: 키로 상쇄한다', async () => {
    f = fakeDb({ stored: [
      { id: 55, sku_id: 7, location: 'self', qty: -2, kind: 'sale', lot_id: 10, unit_cost: null, occurred_at: AT, ref_type: 'order', ref_id: 'O1', reverses_id: null, idem_key: 'sale:X#0', note: null },
      { id: 56, sku_id: 7, location: 'self', qty: -1, kind: 'sale', lot_id: 20, unit_cost: null, occurred_at: AT, ref_type: 'order', ref_id: 'O1', reverses_id: null, idem_key: 'sale:X#1', note: null },
    ] });
    const r = await reverse(f.db, 'sale:X', { occurredAt: AT, note: '취소' });
    expect(r.posted).toBe(true);
    const inserts = f.calls.filter((c) => c.sql.startsWith('insert'));
    expect(inserts.map((c) => [c.params[2], c.params[3], c.params[4], c.params[9], c.params[10]])).toEqual([
      [2, 'reversal', 10, 55, 'rev:sale:X#0'],
      [1, 'reversal', 20, 56, 'rev:sale:X#1'],
    ]);
  });

  it('reverse는 Date occurred_at을 ISO 문자열로 옮긴다', async () => {
    f = fakeDb({ stored: [
      { id: 55, sku_id: 7, location: 'self', qty: -2, kind: 'sale', lot_id: 10, unit_cost: null, occurred_at: new Date(AT), ref_type: null, ref_id: null, reverses_id: null, idem_key: 'sale:Z#0', note: null },
    ] });
    await expect(reverse(f.db, 'sale:Z', { occurredAt: AT })).resolves.toMatchObject({ posted: true });
  });

  it.each(['sale:X#0', 'rev:sale:X'])('reverse는 멱등키 %s를 조회 전에 거부한다', async (k) => {
    await expect(reverse(f.db, k, { occurredAt: AT })).rejects.toThrow(RangeError);
    expect(f.calls).toEqual([]);
  });

  it('reverse할 전표가 없으면 던진다', async () => {
    await expect(reverse(f.db, 'nope', { occurredAt: AT })).rejects.toThrow('되돌릴 전표가 없다');
  });

  it('사유를 13번째 인자(reason 칸)로 기록한다', async () => {
    await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 1, unitCost: 100, kind: 'adjust', reason: 'return_in', occurredAt: AT, idemKey: 'adj:r' });
    const ins = f.calls.find((c) => c.sql.startsWith('insert into erp.stock_ledger'))!;
    expect(ins.sql).toContain('reason');
    expect(ins.params[12]).toBe('return_in');
  });
});
