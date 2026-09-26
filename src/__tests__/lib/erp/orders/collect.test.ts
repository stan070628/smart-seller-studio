import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingIndex } from '@/lib/erp/orders/resolve';
import type { OrderAdapter, OrderLine } from '@/lib/erp/orders/types';

const m = vi.hoisted(() => ({
  readCutover: vi.fn(), readCursor: vi.fn(), advanceCursor: vi.fn(), loadListingIndex: vi.fn(), loadLegacyIndex: vi.fn(),
  upsertOrderLines: vi.fn(), markAbsentCanceled: vi.fn(), reevaluateUnknownLines: vi.fn(), readDeductSetting: vi.fn(),
  writeDeductEnabled: vi.fn(), syncLegacySales: vi.fn(),
}));
vi.mock('@/lib/erp/orders/store', () => ({
  readCutover: m.readCutover, readCursor: m.readCursor, advanceCursor: m.advanceCursor, loadListingIndex: m.loadListingIndex,
  loadLegacyIndex: m.loadLegacyIndex, upsertOrderLines: m.upsertOrderLines, markAbsentCanceled: m.markAbsentCanceled,
  reevaluateUnknownLines: m.reevaluateUnknownLines, readDeductSetting: m.readDeductSetting,
  // Task 5에서 collect.ts가 deduct.ts를 불러오면 필요하다
  writeDeductEnabled: m.writeDeductEnabled,
}));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));

import { collectChannel } from '@/lib/erp/orders/collect';

const CUT = '2026-09-26T11:07:04.989Z';
const NOW = new Date('2026-09-27T03:00:00.000Z');
const LINE: OrderLine = {
  channel: 'coupang_rg', externalOrderId: '41000000001', externalLineId: '41000000001:80000000001', orderedAt: '2026-09-27T01:00:00.000Z',
  paidAt: '2026-09-27T01:00:00.000Z', rawStatus: 'PAID', status: 'paid', productId: '80000000001', optionKey: '', altProductId: null,
  productLabel: '퓨어틴', qty: 2, unitPrice: 21900, amount: 43800,
};
const COVER = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };

let seq: string[];
let lockOk: boolean;
const client = {
  query: vi.fn(async (sql: string) => {
    seq.push(sql.split(' ')[0] === 'select' ? sql.slice(0, 30) : sql);
    if (sql.startsWith('select pg_try_advisory_lock')) return { rows: [{ ok: lockOk }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};
const pool = { connect: vi.fn(async () => client as never) };
const deduct = vi.fn(async (_db: unknown, _p: { enabled: boolean; cutover: string; lineIds: number[]; channel: string; at: string }) =>
  ({ posted: 1, reversed: 0, short: 0, pending: 0, unchanged: 0 }));
const adapter = (o: Partial<OrderAdapter> = {}): OrderAdapter => ({
  channel: 'coupang_rg', tailDays: 7,
  fetch: vi.fn(async () => { seq.push('FETCH'); return { lines: [LINE], cover: COVER, absenceMeansCancel: true }; }),
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  seq = [];
  lockOk = true;
  m.readCutover.mockResolvedValue(CUT);
  m.readCursor.mockResolvedValue(null);
  m.loadListingIndex.mockResolvedValue(new ListingIndex([
    { listingId: 5, channel: 'coupang_rg', productId: '80000000001', optionKey: '', linkMode: 'single', skus: [{ skuId: 7, multiplier: 1 }] },
  ]));
  m.loadLegacyIndex.mockResolvedValue({ skuLegacy: new Map(), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() });
  m.upsertOrderLines.mockResolvedValue({ ids: [100], inserted: 1, updated: 0 });
  m.markAbsentCanceled.mockResolvedValue({ ids: [90], legacyKeys: ['rg-1-2'] });
  m.reevaluateUnknownLines.mockResolvedValue({ ids: [], legacyKeys: [], remaining: 0 });
  m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 1, warnings: [] });
  m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
});

describe('collectChannel', () => {
  it('채널 잠금을 못 잡으면 busy — 채널을 부르지 않는다', async () => {
    lockOk = false;
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ channel: 'coupang_rg', ok: true, skipped: 'busy' });
    expect(a.fetch).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
    expect(seq.some((s) => s.startsWith('select pg_advisory_unlock'))).toBe(false);
  });

  it('첫 실행은 기초 시각부터 가져오고(트랜잭션 밖) 한 트랜잭션에서 upsert → 사라짐 → unknown 재판정 → 옛 장부 → 차감 → 커서', async () => {
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date(CUT), to: NOW });
    expect(seq.indexOf('FETCH')).toBeLessThan(seq.indexOf('BEGIN'));
    expect(m.upsertOrderLines.mock.calls[0][1][0]).toMatchObject({
      externalLineId: '41000000001:80000000001', legacyKey: 'rg-41000000001-80000000001',
      resolution: { attribution: 'mapped', alloc: [{ skuId: 7, qty: 2 }] }, legacy: null,
    });
    expect(m.markAbsentCanceled).toHaveBeenCalledWith(client, 'coupang_rg', COVER, ['41000000001:80000000001']);
    expect(m.reevaluateUnknownLines).toHaveBeenCalledWith(client, 'coupang_rg');
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-41000000001-80000000001', 'rg-1-2']);
    expect(deduct).toHaveBeenCalledWith(client, { enabled: false, cutover: CUT, lineIds: [100, 90], channel: 'coupang_rg', at: NOW.toISOString() });
    expect(m.advanceCursor).toHaveBeenCalledWith(client, 'coupang_rg', NOW.toISOString());
    expect(seq.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    expect(seq[seq.length - 1]).toMatch(/^select pg_advisory_unlock/);
    expect(r).toMatchObject({ ok: true, skipped: null, fetched: 1, inserted: 1, updated: 0, absent: 1, unattributed: 0,
      unknownReEvaluated: 0, unknownRemaining: 0,
      legacy: { upserted: 1, inserted: 1, voided: 1, warnings: 0 }, deduct: { posted: 1 }, window: { from: CUT, to: NOW.toISOString() } });
  });

  it('unknown 재판정으로 바뀐 라인은 옛 장부 키·차감 대상에 합쳐지고 남은 unknown 수·경고 수가 counts에 실린다(설계 해석 #23)', async () => {
    m.reevaluateUnknownLines.mockResolvedValue({ ids: [70], legacyKeys: ['wing-9-1'], remaining: 2 });
    m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 1, warnings: [{ key: 'x', reason: 'sold_without_product_cost' }] });
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-41000000001-80000000001', 'rg-1-2', 'wing-9-1']);
    expect(deduct).toHaveBeenCalledWith(client, expect.objectContaining({ lineIds: [100, 90, 70] }));
    expect(r).toMatchObject({ unknownReEvaluated: 1, unknownRemaining: 2, legacy: { warnings: 1 } });
  });

  it('사라짐 판정은 absenceMeansCancel이 참일 때만', async () => {
    await collectChannel(pool, adapter({ fetch: vi.fn(async () => ({ lines: [LINE], cover: null, absenceMeansCancel: false })) }), { now: NOW, dryRun: false, deduct });
    expect(m.markAbsentCanceled).not.toHaveBeenCalled();
    expect(deduct.mock.calls[0][1].lineIds).toEqual([100]);
  });

  it('dryRun은 가져와서 연결만 세고 쓰지 않는다 — unknown 재판정도 하지 않는다', async () => {
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: true, deduct });
    expect(r).toMatchObject({ ok: true, dryRun: true, fetched: 1, unattributed: 0, unknownReEvaluated: 0, unknownRemaining: null });
    expect(seq).not.toContain('BEGIN');
    expect(m.upsertOrderLines).not.toHaveBeenCalled();
    expect(m.advanceCursor).not.toHaveBeenCalled();
    expect(m.reevaluateUnknownLines).not.toHaveBeenCalled();
  });

  it('쓰다 실패하면 ROLLBACK · 커서 그대로 · 오류는 개인정보를 가린다 · 잠금은 푼다', async () => {
    m.upsertOrderLines.mockRejectedValue(new Error('수령인 010-1234-5678 때문에 실패'));
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('010-****-5678');
    expect(seq).toContain('ROLLBACK');
    expect(m.advanceCursor).not.toHaveBeenCalled();
    expect(seq[seq.length - 1]).toMatch(/^select pg_advisory_unlock/);
  });

  it('채널 호출이 실패하면 트랜잭션을 열지 않고 실패로 돌려준다', async () => {
    const r = await collectChannel(pool, adapter({ fetch: vi.fn(async () => { throw new Error('RG 429'); }) }), { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ ok: false, error: 'RG 429' });
    expect(seq).not.toContain('BEGIN');
  });

  it('커서가 있으면 48시간 겹침·꼬리일수(7)로 시작한다', async () => {
    m.readCursor.mockResolvedValue('2026-10-10T00:00:00.000Z');
    const a = adapter();
    await collectChannel(pool, a, { now: new Date('2026-10-10T00:15:00.000Z'), dryRun: true, deduct });
    expect((a.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0].from.toISOString()).toBe('2026-10-03T00:15:00.000Z');
  });
});
