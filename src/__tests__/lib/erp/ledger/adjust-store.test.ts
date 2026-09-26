import { describe, it, expect } from 'vitest';
import { applyAdjustment, applyAdjustments, ensureCutover, legacyUnitCost } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, CostRequiredError, StaleCountError, type AdjustInput } from '@/lib/erp/ledger/adjust';
import type { Db } from '@/lib/erp/ledger/store';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const REQ2 = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const AT = '2026-09-27T10:00:00+09:00';

/** SQL 앞부분으로 분기하는 가짜 DB */
function fakeDb(o: {
  /** 같은 요청 id로 이미 기록된 전표의 SKU·위치 */
  dup?: { sku_id: number; location: string };
  /** 멱등키가 이미 있다(postLotCreate·postConsume가 posted:false) */
  idemTaken?: boolean;
  onHand?: { qty: number; n: number };
  lots?: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[];
  lotCost?: number | null;
  legacyCost?: number | null;
  baseUnitLabel?: string | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select sku_id, location from erp.stock_ledger where ref_type')) return { rows: o.dup ? [o.dup] : [], rowCount: o.dup ? 1 : 0 };
      if (sql.startsWith('select coalesce(sum(qty)')) return { rows: [o.onHand ?? { qty: 0, n: 0 }], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger where idem_key')) return { rows: o.idemTaken ? [{}] : [], rowCount: o.idemTaken ? 1 : 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: o.lots ?? [], rowCount: (o.lots ?? []).length };
      if (sql.startsWith('select l.unit_cost')) return { rows: o.lotCost == null ? [] : [{ unit_cost: o.lotCost }], rowCount: 1 };
      if (sql.startsWith('select s.base_unit_label')) return { rows: [{ base_unit_label: o.baseUnitLabel ?? null, unit_cost: o.legacyCost ?? null }], rowCount: 1 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

const input = (o: Partial<AdjustInput> = {}): AdjustInput => ({
  skuId: 7, location: 'self', mode: 'count', value: 5, expected: 0, reason: 'count_diff', requestId: REQ, occurredAt: AT, ...o,
});
const inserts = (calls: { sql: string; params: unknown[] }[]) => calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));

describe('applyAdjustment', () => {
  it('빈 위치의 첫 지금 개수 → 기초 전표(opening:<sku>:<위치>, 사유 opening) + ledger_cutover', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    const r = await applyAdjustment(f.db, input({ unitCost: 700 }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'opening', qty: 5, idemKey: 'opening:7:self', unitCost: 700, costSource: 'input' });
    const [ins] = inserts(f.calls);
    // [2]=qty [3]=kind [5]=unit_cost [7]=ref_type [8]=ref_id [10]=idem_key [12]=reason
    expect([ins.params[2], ins.params[3], ins.params[5], ins.params[7], ins.params[8], ins.params[10], ins.params[12]])
      .toEqual([5, 'opening', 700, 'adjust', REQ, 'opening:7:self', 'opening']);
    expect(f.calls.find((c) => c.sql.startsWith('insert into erp.sync_cursors'))!.params).toEqual([AT]);
  });

  it('지금 개수가 줄면 FIFO 조정 차감(adj:<uuid>#순번 · 고른 사유), 커서는 건드리지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 10, n: 2 }, lots: [{ lot_id: 1, qty: 10, unit_cost: 700, lot_at: 1 }] });
    const r = await applyAdjustment(f.db, input({ value: 7, expected: 10, reason: 'damage' }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'adjust', qty: -3, idemKey: `adj:${REQ}` });
    const [ins] = inserts(f.calls);
    expect([ins.params[2], ins.params[3], ins.params[4], ins.params[10], ins.params[12]]).toEqual([-3, 'adjust', 1, `adj:${REQ}#0`, 'damage']);
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.sync_cursors'))).toBe(false);
  });

  it('화면 재고와 저장 시점 재고가 다르면 StaleCountError, 아무것도 쓰지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 4, n: 1 } });
    await expect(applyAdjustment(f.db, input({ value: 3, expected: 5 }))).rejects.toBeInstanceOf(StaleCountError);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('같은 요청 id가 같은 SKU·위치에 이미 있으면 duplicate — 재고를 읽지도 않는다', async () => {
    const f = fakeDb({ dup: { sku_id: 7, location: 'self' } });
    const r = await applyAdjustment(f.db, input());
    expect(r.outcome).toBe('duplicate');
    expect(f.calls.some((c) => c.sql.startsWith('select coalesce(sum(qty)'))).toBe(false);
  });

  it('같은 요청 id가 다른 SKU·위치에 쓰였으면 AdjustInputError(duplicate로 삼키지 않는다)', async () => {
    for (const dup of [{ sku_id: 8, location: 'self' }, { sku_id: 7, location: 'rg_inbound' }]) {
      const f = fakeDb({ dup, onHand: { qty: 0, n: 0 } });
      await expect(applyAdjustment(f.db, input({ unitCost: 700 }))).rejects.toThrow('요청 id가 다른 조정에 이미 쓰였다');
      await expect(applyAdjustment(fakeDb({ dup }).db, input({ unitCost: 700 }))).rejects.toBeInstanceOf(AdjustInputError);
      expect(inserts(f.calls)).toHaveLength(0);
    }
  });

  it('대문자 요청 id도 소문자로 찾고 기록한다', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    const r = await applyAdjustment(f.db, input({ unitCost: 700, requestId: REQ.toUpperCase() }));
    expect(r.requestId).toBe(REQ);
    expect(f.calls.find((c) => c.sql.startsWith('select sku_id, location'))!.params).toEqual([REQ]);
    expect(inserts(f.calls)[0].params[8]).toBe(REQ);
  });

  it('비어 있지 않은 위치의 지금 개수가 늘면 조정 lot(adj:<uuid>), 커서는 건드리지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 3, n: 1 } });
    const r = await applyAdjustment(f.db, input({ value: 5, expected: 3, unitCost: 700 }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'adjust', qty: 2, idemKey: `adj:${REQ}` });
    const [ins] = inserts(f.calls);
    expect([ins.params[2], ins.params[3], ins.params[10], ins.params[12]]).toEqual([2, 'adjust', `adj:${REQ}`, 'count_diff']);
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.sync_cursors'))).toBe(false);
  });

  it('빈 위치의 +수량은 지금 개수(expected 0)와 같다 — 기초 전표 + 커서', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    const r = await applyAdjustment(f.db, input({ mode: 'delta', value: 4, expected: undefined, reason: 'return_in', unitCost: 700 }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'opening', qty: 4, idemKey: 'opening:7:self' });
    const [ins] = inserts(f.calls);
    expect([ins.params[3], ins.params[10], ins.params[12]]).toEqual(['opening', 'opening:7:self', 'opening']);
    expect(f.calls.find((c) => c.sql.startsWith('insert into erp.sync_cursors'))!.params).toEqual([AT]);
  });

  it('빈 위치의 −수량은 AdjustInputError, 아무것도 쓰지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await expect(applyAdjustment(f.db, input({ mode: 'delta', value: -1, expected: undefined, reason: 'loss' })))
      .rejects.toThrow('비어 있는 위치에서는 뺄 수 없다');
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('빈 RG 위치의 RG 대조 반영은 기초 전표', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    const r = await applyAdjustment(f.db, input({ location: 'rg', reason: 'rg_reconcile', value: 6, expected: 0, unitCost: 700 }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'opening', qty: 6, idemKey: 'opening:7:rg' });
    expect(inserts(f.calls)[0].params[12]).toBe('opening');
  });

  it('RG 위치와 RG 대조 사유는 짝이다 — 어긋나면 AdjustInputError', async () => {
    await expect(applyAdjustment(fakeDb().db, input({ location: 'rg', reason: 'count_diff' }))).rejects.toBeInstanceOf(AdjustInputError);
    await expect(applyAdjustment(fakeDb().db, input({ location: 'self', reason: 'rg_reconcile' }))).rejects.toBeInstanceOf(AdjustInputError);
  });

  it('멱등키가 이미 있어 기록되지 않으면(불변식 위반) 입력 오류가 아니라 일반 Error', async () => {
    for (const o of [{ onHand: { qty: 0, n: 0 } }, { onHand: { qty: 10, n: 2 }, lots: [{ lot_id: 1, qty: 10, unit_cost: 700, lot_at: 1 }] }]) {
      const f = fakeDb({ ...o, idemTaken: true });
      const err = await applyAdjustment(f.db, input({ value: 5, expected: o.onHand.qty, unitCost: 700 })).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AdjustInputError);
      expect(String(err.message)).toMatch(/멱등키/);
    }
  });

  it('단가를 안 보내면 최근 lot 단가를 쓰고 옛 입고는 보지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: 800, legacyCost: 650 });
    const r = await applyAdjustment(f.db, input({ mode: 'delta', value: 3, expected: undefined, reason: 'return_in' }));
    expect(r).toMatchObject({ kind: 'adjust', qty: 3, unitCost: 800, costSource: 'lot' });
    expect(f.calls.some((c) => c.sql.startsWith('select round(ce.unit_cost)'))).toBe(false);
  });

  it('최근 lot도 없으면 옛 입고(cost_entries) 단가', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: null, legacyCost: 650 });
    const r = await applyAdjustment(f.db, input({ mode: 'delta', value: 1, expected: undefined, reason: 'other' }));
    expect(r).toMatchObject({ unitCost: 650, costSource: 'legacy' });
  });

  it('기준 단위가 정해진 SKU는 옛 입고 단가를 쓰지 않는다(단위가 다를 수 있다) → CostRequiredError', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: null, legacyCost: 650, baseUnitLabel: '개' });
    await expect(applyAdjustment(f.db, input({ mode: 'delta', value: 1, expected: undefined, reason: 'other' })))
      .rejects.toBeInstanceOf(CostRequiredError);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('단가를 끝내 모르면 CostRequiredError', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await expect(applyAdjustment(f.db, input())).rejects.toBeInstanceOf(CostRequiredError);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('차이가 0이면 noop', async () => {
    const f = fakeDb({ onHand: { qty: 5, n: 1 } });
    const r = await applyAdjustment(f.db, input({ value: 5, expected: 5 }));
    expect(r.outcome).toBe('noop');
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('입력이 틀리면 DB를 건드리기 전에 AdjustInputError', async () => {
    const f = fakeDb();
    await expect(applyAdjustment(f.db, input({ mode: 'delta', value: 0 }))).rejects.toBeInstanceOf(AdjustInputError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('applyAdjustments', () => {
  it('SKU 오름차순으로 먼저 잠근다(1-B 인계 — 교착 방지)', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await applyAdjustments(f.db, [input({ skuId: 9, unitCost: 100 }), input({ skuId: 3, unitCost: 100, requestId: REQ2 })]);
    expect(f.calls[0].params).toEqual([7101, 3]);
    expect(f.calls[1].params).toEqual([7101, 9]);
  });

  it('실패한 항목의 순번을 AdjustItemError로 알린다', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    try {
      await applyAdjustments(f.db, [input({ unitCost: 100 }), input({ skuId: 8, expected: 5, requestId: REQ2 })]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AdjustItemError);
      expect((e as AdjustItemError).index).toBe(1);
      expect((e as AdjustItemError).inner).toBeInstanceOf(StaleCountError);
    }
  });

  it('같은 요청 id가 한 요청에 두 번이면(대소문자 무시) 거부 — DB를 건드리지 않는다', async () => {
    const f = fakeDb();
    try {
      await applyAdjustments(f.db, [input({ unitCost: 100 }), input({ skuId: 8, requestId: REQ.toUpperCase() })]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AdjustItemError);
      expect((e as AdjustItemError).index).toBe(1);
      expect((e as AdjustItemError).inner).toBeInstanceOf(AdjustInputError);
    }
    expect(f.calls).toHaveLength(0);
  });

  it('같은 SKU·위치가 한 요청에 두 번이면 거부', async () => {
    const f = fakeDb();
    await expect(applyAdjustments(f.db, [input(), input({ requestId: REQ2 })])).rejects.toBeInstanceOf(AdjustItemError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('legacyUnitCost', () => {
  it('기준 단위가 없으면 옛 입고 최근 단가(받은 시각·만든 시각 null은 뒤로)', async () => {
    const f = fakeDb({ legacyCost: 650 });
    expect(await legacyUnitCost(f.db, 7)).toBe(650);
    expect(f.calls[0].sql).toMatch(/received_at desc nulls last, ce\.created_at desc nulls last/);
    expect(f.calls[0].params).toEqual([7]);
  });
  it('기준 단위가 있으면 null — 옛 cost_entries는 다른 단위일 수 있어 사람이 적는다', async () => {
    expect(await legacyUnitCost(fakeDb({ legacyCost: 650, baseUnitLabel: '개' }).db, 7)).toBeNull();
  });
  it('옛 입고가 없으면 null', async () => {
    expect(await legacyUnitCost(fakeDb({ legacyCost: null }).db, 7)).toBeNull();
  });
});

describe('ensureCutover', () => {
  it('기준 시각은 가장 이른 기초 시각 — 이미 있으면 least()로 더 이른 쪽을 남긴다', async () => {
    const f = fakeDb();
    await ensureCutover(f.db, AT);
    expect(f.calls[0].params).toEqual([AT]);
    expect(f.calls[0].sql.replace(/\s+/g, ' ')).toMatch(
      /on conflict \(name\) do update set cursor_at = least\(erp\.sync_cursors\.cursor_at, excluded\.cursor_at\), updated_at = now\(\)/,
    );
  });
});
