import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingIndex } from '@/lib/erp/orders/resolve';
import type { OrderAdapter, OrderLine } from '@/lib/erp/orders/types';

const m = vi.hoisted(() => ({
  readCutover: vi.fn(), readCursor: vi.fn(), advanceCursor: vi.fn(), loadListingIndex: vi.fn(), loadLegacyIndex: vi.fn(),
  upsertOrderLines: vi.fn(), markAbsentCanceled: vi.fn(), reevaluateUnknownLines: vi.fn(), readDeductSetting: vi.fn(),
  writeDeductEnabled: vi.fn(), syncLegacySales: vi.fn(), ensureCursorRow: vi.fn(), takeLease: vi.fn(), releaseLease: vi.fn(),
}));
vi.mock('@/lib/erp/orders/store', () => ({
  readCutover: m.readCutover, readCursor: m.readCursor, advanceCursor: m.advanceCursor, loadListingIndex: m.loadListingIndex,
  loadLegacyIndex: m.loadLegacyIndex, upsertOrderLines: m.upsertOrderLines, markAbsentCanceled: m.markAbsentCanceled,
  reevaluateUnknownLines: m.reevaluateUnknownLines, readDeductSetting: m.readDeductSetting,
  // Task 5에서 collect.ts가 deduct.ts를 불러오면 필요하다
  writeDeductEnabled: m.writeDeductEnabled,
  ensureCursorRow: m.ensureCursorRow, takeLease: m.takeLease, releaseLease: m.releaseLease,
}));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));

import { collectChannel, reportAlerts, reportCounts } from '@/lib/erp/orders/collect';

const CUT = '2026-09-26T11:07:04.989Z';
const NOW = new Date('2026-09-27T03:00:00.000Z');
const LINE: OrderLine = {
  channel: 'coupang_rg', externalOrderId: '41000000001', externalLineId: '41000000001:80000000001', orderedAt: '2026-09-27T01:00:00.000Z',
  paidAt: '2026-09-27T01:00:00.000Z', rawStatus: 'PAID', status: 'paid', productId: '80000000001', optionKey: '', altProductId: null,
  productLabel: '퓨어틴', qty: 2, unitPrice: 21900, amount: 43800,
};
const COVER = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };

const LEASE_AT = '2026-09-27T02:59:59.000Z';
let seq: string[];
const client = {
  query: vi.fn(async (sql: string, _p?: unknown[]) => {
    seq.push(sql);
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};
const pool = { connect: vi.fn(async () => client as never) };
const deduct = vi.fn(async (_db: unknown, _p: { enabled: boolean; cutover: string; lineIds: number[]; channel: string; at: string }) =>
  ({ posted: 1, reversed: 0, short: 0, pending: 0, unchanged: 0 }));
const adapter = (o: Partial<OrderAdapter> = {}): OrderAdapter => ({
  channel: 'coupang_rg', tailDays: 7,
  fetch: vi.fn(async () => { seq.push('FETCH'); return { lines: [LINE], cover: COVER, absenceMeansCancel: true, rejected: [] }; }),
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  seq = [];
  m.takeLease.mockImplementation(async () => { seq.push('LEASE'); return { ok: true, at: LEASE_AT }; });
  m.releaseLease.mockImplementation(async () => { seq.push('RELEASE'); });
  m.readCutover.mockResolvedValue(CUT);
  m.readCursor.mockResolvedValue(null);
  m.loadListingIndex.mockResolvedValue(new ListingIndex([
    { listingId: 5, channel: 'coupang_rg', productId: '80000000001', optionKey: '', linkMode: 'single', skus: [{ skuId: 7, multiplier: 1 }] },
  ]));
  m.loadLegacyIndex.mockResolvedValue({ skuLegacy: new Map(), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() });
  m.upsertOrderLines.mockResolvedValue({ ids: [100], changedIds: [100], inserted: 1, updated: 0, unchanged: 0 });
  m.markAbsentCanceled.mockResolvedValue({ ids: [90], legacyKeys: ['rg-1-2'], marked: 2, absent: 3, refused: null });
  m.reevaluateUnknownLines.mockResolvedValue({ ids: [], legacyKeys: [], remaining: 0 });
  m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 1, warnings: [] });
  m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
});

describe('collectChannel', () => {
  it('(C1) 임대를 못 잡으면 busy — 조용한 성공이 아니라 실패로 보고하고(알림 대상) 채널을 부르지 않는다', async () => {
    m.takeLease.mockResolvedValue({ ok: false, at: null });
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ channel: 'coupang_rg', ok: false, skipped: 'busy' });
    expect(r.error).toMatch(/임대/);
    expect(a.fetch).not.toHaveBeenCalled();
    expect(m.releaseLease).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
    expect(reportCounts([r])).toMatchObject({ errors: 1, busy: 1, coupang_rg_busy: 1 });
    // 세션 advisory lock은 쓰지 않는다(트랜잭션 풀러)
    expect(seq.some((s) => /pg_try_advisory_lock|pg_advisory_unlock/.test(s))).toBe(false);
  });

  it('(C1) 커서 행을 기초 시각으로 보장한 뒤 임대를 잡고, 끝나면 같은 주인으로 푼다', async () => {
    await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(m.ensureCursorRow).toHaveBeenCalledWith(client, 'coupang_rg', CUT);
    const owner = m.takeLease.mock.calls[0][2];
    expect(typeof owner).toBe('string');
    expect(m.releaseLease).toHaveBeenCalledWith(client, 'coupang_rg', owner);
    expect(seq.indexOf('LEASE')).toBeLessThan(seq.indexOf('FETCH'));
    expect(seq[seq.length - 1]).toBe('RELEASE');
  });

  it('첫 실행은 기초 시각부터 가져오고(트랜잭션 밖) 한 트랜잭션에서 upsert → 사라짐 → unknown 재판정 → 옛 장부 → 차감 → 커서', async () => {
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date(CUT), to: NOW });
    expect(seq.indexOf('FETCH')).toBeLessThan(seq.indexOf('BEGIN'));
    // 쓰기 트랜잭션 안에서 채널 트랜잭션 잠금
    expect(seq[seq.indexOf('BEGIN') + 1]).toMatch(/^select pg_advisory_xact_lock\(\$1::int, \$2::int\)/);
    expect(client.query.mock.calls.find((c) => String(c[0]).startsWith('select pg_advisory_xact_lock'))?.[1]).toEqual([7102, 2]);
    expect(m.upsertOrderLines.mock.calls[0][1][0]).toMatchObject({
      externalLineId: '41000000001:80000000001', legacyKey: 'rg-41000000001-80000000001',
      resolution: { attribution: 'mapped', alloc: [{ skuId: 7, qty: 2 }] }, legacy: null,
    });
    // 수집 시작 시각(임대를 잡은 DB 시각) 이전에 처음 본 라인만 사라짐 판정 대상
    expect(m.markAbsentCanceled).toHaveBeenCalledWith(client, 'coupang_rg', COVER, [expect.objectContaining({ externalLineId: '41000000001:80000000001' })], LEASE_AT);
    expect(m.reevaluateUnknownLines).toHaveBeenCalledWith(client, 'coupang_rg');
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-41000000001-80000000001', 'rg-1-2']);
    expect(deduct).toHaveBeenCalledWith(client, { enabled: false, cutover: CUT, lineIds: [100, 90], channel: 'coupang_rg', at: NOW.toISOString() });
    expect(m.advanceCursor).toHaveBeenCalledWith(client, 'coupang_rg', NOW.toISOString());
    expect(seq.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    expect(seq[seq.length - 1]).toBe('RELEASE');
    expect(r).toMatchObject({ ok: true, skipped: null, fetched: 1, inserted: 1, updated: 0, unchanged: 0, absent: 1, absenceMarked: 2,
      absenceRefused: null, rejected: 0, unattributed: 0,
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
    await collectChannel(pool, adapter({ fetch: vi.fn(async () => ({ lines: [LINE], cover: null, absenceMeansCancel: false, rejected: [] })) }), { now: NOW, dryRun: false, deduct });
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
    // 읽기만 하므로 임대·커서 행도 건드리지 않는다
    expect(m.takeLease).not.toHaveBeenCalled();
    expect(m.ensureCursorRow).not.toHaveBeenCalled();
  });

  it('(M3) 차감에는 새로 들어왔거나 바뀐 라인만 넘긴다', async () => {
    m.upsertOrderLines.mockResolvedValue({ ids: [100, 101], changedIds: [101], inserted: 0, updated: 1, unchanged: 1 });
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(deduct.mock.calls[0][1].lineIds).toEqual([101, 90]);
    expect(r).toMatchObject({ updated: 1, unchanged: 1 });
  });

  it('(I1) 사라짐 판정을 거절하면 나머지는 쓰고 보고서·counts·알림에 싣는다', async () => {
    const refused = { reason: 'empty_fetch', absent: 4, seenInCover: 0, coverRows: 4 };
    m.markAbsentCanceled.mockResolvedValue({ ids: [], legacyKeys: [], marked: 0, absent: 4, refused });
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ ok: true, absent: 0, absenceRefused: refused });
    expect(m.advanceCursor).toHaveBeenCalled();
    expect(reportCounts([r])).toMatchObject({ absence_refused: 1, coupang_rg_absence_refused: 1 });
    expect(reportAlerts(r).join(' ')).toMatch(/사라짐 판정 거절.*empty_fetch/);
  });

  it('(I5) 어댑터가 버린 잘못된 라인은 세고(구매자 정보 없이) 알림 재료로 싣는다 — 채널 전체를 실패시키지 않는다', async () => {
    const rejected = [{ lineKey: '41000000009:80000000001', reason: 'bad_qty' as const }];
    const a = adapter({ fetch: vi.fn(async () => ({ lines: [LINE], cover: COVER, absenceMeansCancel: true, rejected })) });
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ ok: true, rejected: 1, rejectedLines: rejected });
    expect(reportCounts([r])).toMatchObject({ rejected: 1, coupang_rg_rejected: 1 });
    expect(reportAlerts(r).join(' ')).toMatch(/잘못된 라인 1건/);
  });

  it('쓰다 실패하면 ROLLBACK · 커서 그대로 · 오류는 개인정보를 가린다 · 잠금은 푼다', async () => {
    m.upsertOrderLines.mockRejectedValue(new Error('수령인 010-1234-5678 때문에 실패'));
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('010-****-5678');
    expect(seq).toContain('ROLLBACK');
    expect(m.advanceCursor).not.toHaveBeenCalled();
    expect(seq[seq.length - 1]).toBe('RELEASE');
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

describe('collectOrders · reportCounts', () => {
  it('채널을 차례로 돌고, 어댑터를 못 만든 채널(환경변수 없음)은 실패 보고만 남긴다', async () => {
    const { collectOrders } = await import('@/lib/erp/orders/collect');
    const factories = {
      coupang_wing: () => { throw new Error('COUPANG_ACCESS_KEY가 없다'); },
      coupang_rg: () => adapter(),
      naver: () => adapter({ channel: 'naver', fetch: vi.fn(async () => ({ lines: [], cover: null, absenceMeansCancel: false, rejected: [] })) }),
      toss: () => adapter(),
    };
    const reports = await collectOrders({ channels: ['coupang_wing', 'coupang_rg', 'naver'], dryRun: false, now: NOW, pool, factories });
    expect(reports.map((r) => [r.channel, r.ok])).toEqual([['coupang_wing', false], ['coupang_rg', true], ['naver', true]]);
    expect(reports[0].error).toContain('COUPANG_ACCESS_KEY');
    const counts = reportCounts(reports);
    expect(counts).toMatchObject({ channels: 3, errors: 1, coupang_wing_error: 1, coupang_rg_error: 0, coupang_rg_fetched: 1, coupang_rg_new: 1, naver_fetched: 0 });
  });
});

describe('collectChannel — 과거 보충(backfillFrom · 결정 5)', () => {
  // 기초 이전(9/5) 라인과 기초 이후 라인을 같이 받는다
  const OLD: OrderLine = {
    ...LINE, externalOrderId: '41000000002', externalLineId: '41000000002:80000000001',
    orderedAt: '2026-09-05T01:00:00.000Z', paidAt: '2026-09-05T01:00:00.000Z',
  };
  const both = () => adapter({ fetch: vi.fn(async () => { seq.push('FETCH'); return { lines: [OLD, LINE], cover: COVER, absenceMeansCancel: true, rejected: [] }; }) });

  it('구간 시작만 9/1 KST 0시로 바꾸고(끝 = 지금) 사라짐 판정·커서 이동은 하지 않는다 — 임대·트랜잭션 잠금·upsert·옛 장부·차감은 그대로', async () => {
    m.upsertOrderLines.mockResolvedValue({ ids: [100, 101], changedIds: [100, 101], inserted: 2, updated: 0, unchanged: 0 });
    const a = both();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct, backfillFrom: '2026-09-01' });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date('2026-08-31T15:00:00.000Z'), to: NOW });
    expect(m.takeLease).toHaveBeenCalled();
    expect(m.releaseLease).toHaveBeenCalled();
    expect(client.query.mock.calls.find((c) => String(c[0]).startsWith('select pg_advisory_xact_lock'))?.[1]).toEqual([7102, 2]);
    expect(m.upsertOrderLines.mock.calls[0][1].map((l: OrderLine) => l.externalLineId)).toEqual([OLD.externalLineId, LINE.externalLineId]);
    // 사라짐 판정 없음(absent_since도 적지 않는다) · 커서는 앞으로도 뒤로도 움직이지 않는다
    expect(m.markAbsentCanceled).not.toHaveBeenCalled();
    expect(m.advanceCursor).not.toHaveBeenCalled();
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-41000000002-80000000001', 'rg-41000000001-80000000001']);
    // 차감기는 돌되 기초 시각은 진짜 기초 시각 — 보충 시작일이 아니다(9/5 라인은 pre_cutover로 남는다)
    expect(deduct).toHaveBeenCalledWith(client, { enabled: false, cutover: CUT, lineIds: [100, 101], channel: 'coupang_rg', at: NOW.toISOString() });
    expect(seq.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    expect(r).toMatchObject({
      ok: true, backfill: true, window: { from: '2026-08-31T15:00:00.000Z', to: NOW.toISOString() },
      fetched: 2, inserted: 2, absent: 0, absenceMarked: 0, absenceRefused: null, backfillSkipped: 0,
    });
  });

  it('보충 시작일 전에 주문된 라인(네이버 변경 조회가 끌고 오는 8월 주문)은 쓰지 않고 센다', async () => {
    const aug: OrderLine = { ...OLD, externalLineId: '41000000003:80000000001', externalOrderId: '41000000003', orderedAt: '2026-08-20T01:00:00.000Z', paidAt: '2026-08-20T01:00:00.000Z' };
    const a = adapter({ fetch: vi.fn(async () => ({ lines: [aug, OLD], cover: null, absenceMeansCancel: false, rejected: [] })) });
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct, backfillFrom: '2026-09-01' });
    expect(m.upsertOrderLines.mock.calls[0][1].map((l: OrderLine) => l.externalLineId)).toEqual([OLD.externalLineId]);
    expect(r).toMatchObject({ ok: true, fetched: 1, backfillSkipped: 1 });
  });

  it('dryRun + 보충 — 보충 구간으로 가져와 세기만 하고 쓰지 않는다', async () => {
    const a = both();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: true, deduct, backfillFrom: '2026-09-01' });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date('2026-08-31T15:00:00.000Z'), to: NOW });
    expect(r).toMatchObject({ ok: true, dryRun: true, backfill: true, fetched: 2 });
    expect(seq).not.toContain('BEGIN');
    expect(m.takeLease).not.toHaveBeenCalled();
    expect(m.upsertOrderLines).not.toHaveBeenCalled();
  });

  it('범위를 벗어난 시작일(기초 이후 · 62일 초과 · 형식)은 채널을 부르지 않고 실패로 보고한다', async () => {
    for (const bad of ['2026-09-27', '2026-07-01', '2026/09/01']) {
      const a = both();
      const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct, backfillFrom: bad });
      expect(r).toMatchObject({ ok: false, backfill: true });
      expect(r.error).toMatch(/보충/);
      expect(a.fetch).not.toHaveBeenCalled();
    }
    expect(m.takeLease).not.toHaveBeenCalled();
  });

  it('backfillTo — 구간 끝을 그날 다음 날 KST 0시로 줄이고, 그 뒤에 주문된 라인은 쓰지 않고 센다(Vercel 300초 안에 나눠 부르기)', async () => {
    const a = both();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct, backfillFrom: '2026-09-01', backfillTo: '2026-09-07' });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date('2026-08-31T15:00:00.000Z'), to: new Date('2026-09-07T15:00:00.000Z') });
    // OLD(9/5)만 남고 LINE(기초 이후)은 구간 밖
    expect(m.upsertOrderLines.mock.calls[0][1].map((l: OrderLine) => l.externalLineId)).toEqual([OLD.externalLineId]);
    expect(r).toMatchObject({ ok: true, backfill: true, fetched: 1, backfillSkipped: 1, window: { to: '2026-09-07T15:00:00.000Z' } });
    expect(m.advanceCursor).not.toHaveBeenCalled();
  });

  it('backfillTo가 시작일보다 앞이면 채널을 부르지 않고 실패로 보고한다', async () => {
    const a = both();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct, backfillFrom: '2026-09-10', backfillTo: '2026-09-05' });
    expect(r).toMatchObject({ ok: false, backfill: true });
    expect(a.fetch).not.toHaveBeenCalled();
    expect(m.takeLease).not.toHaveBeenCalled();
  });

  it('보통 수집은 backfill: false · backfillSkipped 0', async () => {
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ backfill: false, backfillSkipped: 0 });
    expect(m.markAbsentCanceled).toHaveBeenCalled();
    expect(m.advanceCursor).toHaveBeenCalled();
  });

  it('collectOrders는 backfillFrom을 채널마다 넘긴다', async () => {
    const { collectOrders } = await import('@/lib/erp/orders/collect');
    const a = both();
    const factories = { coupang_wing: () => a, coupang_rg: () => a, naver: () => a, toss: () => a };
    const reports = await collectOrders({ channels: ['coupang_rg'], dryRun: true, now: NOW, pool, factories, backfillFrom: '2026-09-01' });
    expect(reports[0]).toMatchObject({ backfill: true, window: { from: '2026-08-31T15:00:00.000Z' } });
    const narrowed = await collectOrders({ channels: ['coupang_rg'], dryRun: true, now: NOW, pool, factories, backfillFrom: '2026-09-01', backfillTo: '2026-09-03' });
    expect(narrowed[0]).toMatchObject({ window: { from: '2026-08-31T15:00:00.000Z', to: '2026-09-03T15:00:00.000Z' } });
  });
});
