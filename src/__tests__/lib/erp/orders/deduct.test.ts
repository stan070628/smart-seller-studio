import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsufficientStockError } from '@/lib/erp/ledger/fifo';
import type { Db } from '@/lib/erp/ledger/store';

const m = vi.hoisted(() => ({
  lockSku: vi.fn(), postConsume: vi.fn(), reverse: vi.fn(),
  readCutover: vi.fn(), readDeductSetting: vi.fn(), writeDeductEnabled: vi.fn(),
}));
vi.mock('@/lib/erp/ledger/store', () => ({ lockSku: m.lockSku, postConsume: m.postConsume, reverse: m.reverse }));
vi.mock('@/lib/erp/orders/store', () => ({ readCutover: m.readCutover, readDeductSetting: m.readDeductSetting, writeDeductEnabled: m.writeDeductEnabled }));

import { DeductSwitchError, enableDeduction, previewBackfill, runDeductions } from '@/lib/erp/orders/deduct';

const CUT = '2026-09-26T11:07:04.989Z';
const AT = '2026-09-27T03:00:00.000Z';
const PAID = new Date('2026-09-27T01:00:00.000Z');

type Row = Record<string, unknown>;
const row = (o: Row): Row => ({
  id: 1, channel: 'naver', external_line_id: '2026092700000001', external_order_id: '2026092712340001', status: 'paid', attribution: 'mapped',
  alloc: [{ skuId: 4, qty: 2 }], paid_at: PAID, deduction_state: 'pending', deduction_note: null, ledger_version: 0, posted: [], ...o,
});

let lines: Row[];
let onHand: Row[];
let calls: { sql: string; params: unknown[] }[];
let order: string[];
const db: Db = {
  async query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });
    order.push(sql.split(' ').slice(0, 2).join(' '));
    if (sql.startsWith('select l.id, l.channel')) return { rows: lines, rowCount: lines.length };
    if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: null };
    if (/^(savepoint|release savepoint|rollback to savepoint)/.test(sql)) return { rows: [], rowCount: null };
    if (sql.startsWith('update erp.order_lines set deduction_state')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('select sku_id, location, qty from erp.stock_on_hand')) return { rows: onHand, rowCount: onHand.length };
    if (sql.startsWith('select id, name, option_label from erp.skus')) return { rows: [{ id: 4, name: '쿨매트', option_label: '블루' }, { id: 9, name: '퓨어틴', option_label: '' }], rowCount: 2 };
    throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
  },
};
const updates = () => calls.filter((c) => c.sql.startsWith('update erp.order_lines set deduction_state')).map((c) => ({
  id: c.params[0], state: c.params[1], note: c.params[2], posted: JSON.parse(c.params[3] as string), version: c.params[4],
}));

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  order = [];
  onHand = [];
  m.lockSku.mockImplementation(async (_db: Db, id: number) => { order.push(`lock ${id}`); });
  m.postConsume.mockImplementation(async (_db: Db, p: { skuId: number }) => { order.push(`post ${p.skuId}`); return { posted: true, ids: [1] }; });
  m.reverse.mockResolvedValue({ posted: true, ids: [2] });
  m.readCutover.mockResolvedValue(CUT);
});

describe('runDeductions', () => {
  it('대상 라인을 행 잠금으로 읽고, SKU를 오름차순으로 먼저 잠근 뒤 결제 시각으로 뺀다(RG = rg, 나머지 = self)', async () => {
    lines = [
      row({ id: 1, channel: 'coupang_rg', external_line_id: '41000000001:80000000001', external_order_id: '41000000001', alloc: [{ skuId: 9, qty: 1 }] }),
      row({ id: 2, alloc: [{ skuId: 4, qty: 2 }] }),
    ];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(calls[0].sql).toContain('for update of l');
    expect(calls[0].params).toEqual([[1], null, true]);
    expect(order.filter((o) => /^(lock|post)/.test(o))).toEqual(['lock 4', 'lock 9', 'post 9', 'post 4']);
    expect(m.postConsume.mock.calls[0][1]).toEqual({
      skuId: 9, location: 'rg', qty: 1, kind: 'sale', occurredAt: PAID.toISOString(), idemKey: 'sale:coupang_rg:41000000001:80000000001:s9',
      refType: 'order_line', refId: '1', note: '쿠팡 RG 주문 41000000001',
    });
    expect(m.postConsume.mock.calls[1][1]).toMatchObject({ location: 'self', idemKey: 'sale:naver:2026092700000001:s4', note: '네이버 주문 2026092712340001' });
    expect(updates()).toEqual([
      { id: 1, state: 'posted', note: null, posted: [{ skuId: 9, qty: 1, idemKey: 'sale:coupang_rg:41000000001:80000000001:s9' }], version: 1 },
      { id: 2, state: 'posted', note: null, posted: [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }], version: 1 },
    ]);
    expect(s).toEqual({ posted: 2, reversed: 0, short: 0, pending: 0, unchanged: 0 });
  });

  it('재고 부족이면 그 라인만 savepoint로 되돌리고 skipped_short — 다음 라인은 계속한다', async () => {
    lines = [row({ id: 1 }), row({ id: 2, external_line_id: '2026092700000002', alloc: [{ skuId: 9, qty: 1 }] })];
    m.postConsume.mockImplementationOnce(async () => { throw new InsufficientStockError(2, 0); });
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [], channel: 'naver', at: AT });
    expect(order).toContain('rollback to');
    expect(updates()[0]).toMatchObject({ id: 1, state: 'skipped_short', posted: [], version: 0 });
    expect(updates()[0].note).toMatch(/^재고 부족/);
    expect(updates()[1]).toMatchObject({ id: 2, state: 'posted', version: 1 });
    expect(s).toMatchObject({ posted: 1, short: 1 });
  });

  it('bundle 라인의 둘째 SKU가 모자라면 첫째 SKU 차감도 함께 되돌린다(savepoint)', async () => {
    lines = [row({ alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }] })];
    m.postConsume.mockImplementation(async (_db: Db, p: { skuId: number }) => {
      if (p.skuId === 9) throw new Error('SKU 9 · rg · lot 3의 재고가 음수가 된다 (-1)');
      return { posted: true, ids: [1] };
    });
    await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    const sp = calls.map((c) => c.sql).filter((q) => /savepoint/.test(q));
    expect(sp).toEqual(['savepoint erp_sale', 'rollback to savepoint erp_sale', 'release savepoint erp_sale']);
    expect(updates()[0]).toMatchObject({ state: 'skipped_short', posted: [] });
  });

  it('뺀 라인이 취소되면 역전표(수집 시각 · 취소·반품 메모) → reversed', async () => {
    const posted = [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }];
    lines = [row({ status: 'canceled', deduction_state: 'posted', ledger_version: 1, posted })];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(m.reverse).toHaveBeenCalledWith(db, 'sale:naver:2026092700000001:s4', { occurredAt: AT, note: '네이버 주문 2026092712340001 취소·반품' });
    expect(m.postConsume).not.toHaveBeenCalled();
    expect(updates()).toEqual([{ id: 1, state: 'reversed', note: 'voided', posted: [], version: 1 }]);
    expect(s.reversed).toBe(1);
  });

  it('스위치가 꺼져 있으면 원장을 건드리지 않고 pending으로 둔다', async () => {
    lines = [row({ deduction_state: 'none' })];
    const s = await runDeductions(db, { enabled: false, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(m.lockSku).not.toHaveBeenCalled();
    expect(m.postConsume).not.toHaveBeenCalled();
    expect(updates()).toEqual([{ id: 1, state: 'pending', note: null, posted: [], version: 0 }]);
    expect(s.pending).toBe(1);
  });

  it('바뀐 것이 없는 라인은 다시 쓰지 않는다', async () => {
    lines = [row({ status: 'delivered', deduction_state: 'posted', ledger_version: 1, posted: [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }] })];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(updates()).toEqual([]);
    expect(s.unchanged).toBe(1);
  });

  it('재고 부족이 아닌 오류는 되돌린 뒤 다시 던진다(수집 트랜잭션이 통째로 롤백)', async () => {
    lines = [row({})];
    m.postConsume.mockRejectedValueOnce(new Error('connection reset'));
    await expect(runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT })).rejects.toThrow('connection reset');
  });

  it('includeOpen:false면 넘긴 라인만(자가시험·개별 재처리)', async () => {
    lines = [];
    await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [7], channel: 'toss', at: AT, includeOpen: false });
    expect(calls[0].params).toEqual([[7], 'toss', false]);
  });
});

describe('previewBackfill', () => {
  it('켜면 뺄 라인·SKU·집/RG 감소량과 재고가 모자라는 SKU를 보인다(기초 이전·미귀속은 빠진다)', async () => {
    lines = [
      row({ id: 1, alloc: [{ skuId: 4, qty: 2 }] }),
      row({ id: 2, channel: 'coupang_rg', external_line_id: '41000000001:80000000001', alloc: [{ skuId: 9, qty: 3 }], paid_at: new Date('2026-09-27T02:00:00Z') }),
      row({ id: 3, deduction_state: 'skipped_short', alloc: [{ skuId: 4, qty: 1 }] }),
      row({ id: 4, paid_at: new Date('2026-09-26T10:00:00Z') }),
    ];
    onHand = [{ sku_id: 4, location: 'self', qty: 10 }, { sku_id: 9, location: 'rg', qty: 1 }];
    const p = await previewBackfill(db);
    expect(p).toEqual({
      cutover: CUT, lines: 3, skus: 2, self: 3, rg: 3,
      firstPaidAt: '2026-09-27T01:00:00.000Z', lastPaidAt: '2026-09-27T02:00:00.000Z',
      byChannel: { coupang_wing: 0, coupang_rg: 1, naver: 2, toss: 0 },
      shortages: [{ skuId: 9, name: '퓨어틴', option: '', location: 'rg', need: 3, have: 1 }],
    });
  });
});

describe('enableDeduction', () => {
  beforeEach(() => {
    lines = [row({ id: 1 })];
    onHand = [{ sku_id: 4, location: 'self', qty: 10 }];
  });

  it('이미 켜져 있으면 already', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: true, enabledAt: AT, by: 'u' });
    await expect(enableDeduction(db, { expectedLines: 1, by: 'u-1', at: AT })).rejects.toMatchObject({ code: 'already' });
    expect(m.writeDeductEnabled).not.toHaveBeenCalled();
  });

  it('화면이 본 소급 라인 수와 다르면 stale — 켜지 않는다', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
    const e = await enableDeduction(db, { expectedLines: 5, by: 'u-1', at: AT }).catch((x) => x);
    expect(e).toBeInstanceOf(DeductSwitchError);
    expect(e.code).toBe('stale');
    expect(m.writeDeductEnabled).not.toHaveBeenCalled();
    expect(m.postConsume).not.toHaveBeenCalled();
  });

  it('설정 행을 잡고(for update) 켠 뒤 모든 채널의 대기 라인을 소급한다', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
    const r = await enableDeduction(db, { expectedLines: 1, by: 'u-1', at: AT });
    expect(m.readDeductSetting).toHaveBeenCalledWith(db, true);
    expect(m.writeDeductEnabled).toHaveBeenCalledWith(db, { by: 'u-1', at: AT });
    expect(r.preview.lines).toBe(1);
    expect(r.summary.posted).toBe(1);
    const sel = calls.filter((c) => c.sql.startsWith('select l.id, l.channel'));
    expect(sel[sel.length - 1].params).toEqual([[], null, true]);
  });

  it('previewBackfill 전에 4개 채널 잠금(7102, 1~4)을 오름차순으로 먼저 잡는다 — 수집 트랜잭션과 순서를 맞춘다(M3)', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
    await enableDeduction(db, { expectedLines: 1, by: 'u-1', at: AT });
    const locks = calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock'));
    expect(locks.map((c) => c.params)).toEqual([[7102, 1], [7102, 2], [7102, 3], [7102, 4]]);
    // previewBackfill(라인 select)보다 먼저 잡힌다
    const firstSelectIdx = calls.findIndex((c) => c.sql.startsWith('select l.id, l.channel'));
    const lastLockIdx = calls.findIndex((c) => c.sql.startsWith('select pg_advisory_xact_lock')) + locks.length - 1;
    expect(lastLockIdx).toBeLessThan(firstSelectIdx);
  });
});
