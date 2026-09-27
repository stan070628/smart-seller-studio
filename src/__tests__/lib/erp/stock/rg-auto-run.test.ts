// src/__tests__/lib/erp/stock/rg-auto-run.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ postTransfer: vi.fn(), lockSku: vi.fn() }));
vi.mock('@/lib/erp/ledger/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/ledger/store')>('@/lib/erp/ledger/store');
  return { ...actual, postTransfer: m.postTransfer, lockSku: m.lockSku };
});

import { runRgAuto } from '@/lib/erp/stock/rg-auto-run';

const NOW = new Date('2026-10-05T00:30:00.000Z');
const INC72 = '극세사 타월 · 블루 RG가 원장보다 3개 많다(보낸 기록 없음)';
const UNMAPPED = '연결 안 된 RG 번호 95999999999 재고 2개';
const K_INC72 = `unsent_increase:72|${INC72}`;
const K_UNMAPPED = `unmapped_vid:95999999999|${UNMAPPED}`;

interface Sku { id: number; name: string; option: string | null; vid: string; ledger: number; inbound: number; active?: boolean }
const S72: Sku = { id: 72, name: '극세사 타월', option: '블루', vid: '95401822934', ledger: 100, inbound: 5 };
const S80: Sku = { id: 80, name: '수건', option: null, vid: '95400000080', ledger: 10, inbound: 4 };

let calls: { sql: string; params: unknown[] }[];
let order: string[];
function client(opts: {
  deduct: boolean; auto: boolean; skus?: Sku[];
  /** 잠금 뒤 다시 읽는 원장 값(없으면 처음 읽은 값) */
  locked?: Record<number, { rg: number; rg_inbound: number }>;
  prevDiff?: { sku_id: string; diff: number }[];
  prevRun?: { sku_id: string | null; vid: string | null; planned_move: number; alert: string | null }[];
  flows?: { id: string; reverses_id: string | null; sku_id: string; qty: number; occurred_at: Date }[];
}) {
  const skus = opts.skus ?? [S72];
  const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length });
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("name = 'deduct_enabled'")) return rows([{ value: { enabled: opts.deduct } }]);
      if (sql.includes("name = 'rg_auto_arrive_enabled'")) return rows([{ value: { enabled: opts.auto } }]);
      if (sql.includes('stock_on_hand where sku_id = $1')) {
        const s = skus.find((k) => k.id === params[0])!;
        const l = opts.locked?.[s.id] ?? { rg: s.ledger, rg_inbound: s.inbound };
        return rows([{ location: 'rg', qty: l.rg }, { location: 'rg_inbound', qty: l.rg_inbound }]);
      }
      if (sql.includes("location = 'rg'") && sql.includes('stock_on_hand')) return rows(skus.map((s) => ({ sku_id: String(s.id), qty: s.ledger })));
      if (sql.includes("location = 'rg_inbound'") && sql.includes('stock_on_hand')) return rows(skus.map((s) => ({ sku_id: String(s.id), qty: s.inbound })));
      if (sql.includes("l.channel = 'coupang_rg' and l.active")) return rows(skus.map((s) => ({ vid: s.vid, sku_id: String(s.id), multiplier: 1 })));
      if (sql.includes("status = 'active'")) return rows(skus.filter((s) => s.active !== false).map((s) => ({ id: String(s.id) })));
      if (sql.includes("where location = 'rg_inbound'") && sql.includes('stock_ledger')) {
        return rows(opts.flows ?? skus.map((s, i) => ({ id: String(i + 1), reverses_id: null, sku_id: String(s.id), qty: s.inbound, occurred_at: new Date('2026-10-03T00:00:00Z') })));
      }
      if (sql.includes('distinct on (sku_id)') && sql.includes('rg_recon_snapshots')) return rows(opts.prevDiff ?? []);
      if (sql.includes('with last as') && sql.includes('rg_recon_snapshots')) return rows(opts.prevRun ?? []);
      if (sql.includes('from erp.skus where id = any')) return rows(skus.map((s) => ({ id: String(s.id), name: s.name, option_label: s.option })));
      return rows([]);
    }),
    release: vi.fn(() => { order.push('release'); }),
  };
}
const deps = (c: ReturnType<typeof client>, stock = [{ vid: '95401822934', qty: 108 }, { vid: '95999999999', qty: 2 }]) => ({
  pool: { connect: vi.fn(async () => { order.push('connect'); return c as never; }) },
  collectRg: vi.fn(async (): Promise<{ ok: boolean; error: string | null; busy?: boolean }> => { order.push('collect'); return { ok: true, error: null }; }),
  fetchRgStock: vi.fn(async () => stock),
  sleep: vi.fn(async () => {}),
});
const snapsOf = () => calls.filter((x) => x.sql.startsWith('insert into erp.rg_recon_snapshots'))
  // [0]run_id [1]run_at [2]sku_id [3]vid [4]ledger [5]actual [6]inbound [7]planned [8]moved [9]alert
  .map((s) => s.params.slice(2));

beforeEach(() => { calls = []; order = []; vi.clearAllMocks(); m.postTransfer.mockResolvedValue({ posted: true, ids: [1, 2] }); });

describe('runRgAuto', () => {
  it('차감이 꺼져 있으면 건너뛴다 — RG 수집·조회도 하지 않는다', async () => {
    const c = client({ deduct: false, auto: true });
    const d = deps(c);
    expect(await runRgAuto({ now: NOW, forceDry: false, deps: d })).toMatchObject({ skipped: 'deduct_off' });
    expect(d.collectRg).not.toHaveBeenCalled();
    expect(d.fetchRgStock).not.toHaveBeenCalled();
  });

  it('DB 연결은 RG 수집(과 busy 재시도)이 끝난 뒤에 잡는다 — 차감 확인용 연결은 수집 전에 돌려준다', async () => {
    const d = deps(client({ deduct: true, auto: false }));
    d.collectRg.mockImplementationOnce(async () => { order.push('collect'); return { ok: false, error: 'busy', busy: true }; });
    await runRgAuto({ now: NOW, forceDry: false, deps: d });
    expect(order).toEqual(['connect', 'release', 'collect', 'collect', 'connect', 'release']);
  });

  it('자동 이동 꺼짐 — 판정·기록만(옮길 예정), 전표 없음', async () => {
    const c = client({ deduct: true, auto: false });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(r).toMatchObject({ skipped: null, autoMove: false, moves: [{ skuId: 72, qty: 5 }], moved: [], failed: 0 });
    expect(r.alerts).toEqual([INC72, UNMAPPED]);
    expect(m.postTransfer).not.toHaveBeenCalled();
    expect(snapsOf()).toEqual([
      [72, null, 100, 108, 5, 5, 0, K_INC72],
      [null, '95999999999', 0, 2, 0, 0, 0, K_UNMAPPED],
    ]);
  });

  it('자동 이동 켜짐 — SKU 잠금 뒤 입고중 → RG 전표(멱등키 rgauto:<run>:<sku>) · savepoint로 감싼다', async () => {
    const c = client({ deduct: true, auto: true });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(r.autoMove).toBe(true);
    expect(r.moved).toEqual([{ skuId: 72, qty: 5 }]);
    expect(m.lockSku).toHaveBeenCalledWith(c, 72);
    expect(m.postTransfer).toHaveBeenCalledWith(c, expect.objectContaining({
      skuId: 72, from: 'rg_inbound', to: 'rg', qty: 5, refType: 'rg_auto', idemKey: expect.stringMatching(/^rgauto:[0-9a-f-]{36}:72$/),
    }));
    expect(snapsOf()[0][6]).toBe(5);
    const sqls = calls.map((x) => x.sql);
    expect(sqls.filter((s) => s === 'BEGIN' || s === 'COMMIT')).toEqual(['BEGIN', 'COMMIT']);
    expect(sqls).toContain('savepoint rgauto_0');
    expect(sqls).toContain('release savepoint rgauto_0');
    // 기록은 이동 뒤에(moved가 최종값)
    expect(sqls.findIndex((s) => s.startsWith('insert into erp.rg_recon_snapshots'))).toBeGreaterThan(sqls.indexOf('savepoint rgauto_0'));
  });

  it('잠금 뒤 다시 읽는다 — 그 사이 입고중이 줄었으면 줄어든 만큼만 옮긴다(planned는 판정 그대로)', async () => {
    const c = client({ deduct: true, auto: true, locked: { 72: { rg: 100, rg_inbound: 2 } } });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(m.postTransfer).toHaveBeenCalledWith(c, expect.objectContaining({ skuId: 72, qty: 2 }));
    expect(r.moved).toEqual([{ skuId: 72, qty: 2 }]);
    expect(snapsOf()[0].slice(5, 7)).toEqual([5, 2]);
  });

  it('잠금 뒤 다시 읽는다 — 원장 RG가 올랐으면(역전표 등) 차이가 줄어든 만큼만 · 차이가 없어지면 옮기지 않는다', async () => {
    const c = client({ deduct: true, auto: true, locked: { 72: { rg: 105, rg_inbound: 5 } } });
    await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(m.postTransfer).toHaveBeenCalledWith(c, expect.objectContaining({ skuId: 72, qty: 3 }));
    vi.clearAllMocks(); calls = [];
    const c2 = client({ deduct: true, auto: true, locked: { 72: { rg: 108, rg_inbound: 5 } } });
    const r2 = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c2) });
    expect(m.postTransfer).not.toHaveBeenCalled();
    expect(r2.moved).toEqual([]);
    expect(snapsOf()[0].slice(5, 7)).toEqual([5, 0]);
  });

  it('한 SKU 전표가 실패해도 그 savepoint만 되돌리고 다른 SKU 이동·기록은 커밋한다 — 실패는 알림', async () => {
    const c = client({ deduct: true, auto: true, skus: [S72, S80] });
    m.postTransfer.mockImplementation(async (_db: unknown, p: { skuId: number }) => {
      if (p.skuId === 72) throw new Error('입고중 부족');
      return { posted: true, ids: [3, 4] };
    });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, [{ vid: '95401822934', qty: 108 }, { vid: '95400000080', qty: 14 }]) });
    const sqls = calls.map((x) => x.sql);
    expect(sqls).toContain('rollback to savepoint rgauto_0');
    expect(sqls).toContain('release savepoint rgauto_1');
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
    expect(r.moved).toEqual([{ skuId: 80, qty: 4 }]);
    expect(r.failed).toBe(1);
    expect(r.alerts).toContain('극세사 타월 · 블루 자동 이동 실패: 입고중 부족');
    expect(snapsOf()).toEqual([
      [72, null, 100, 108, 5, 5, 0, `${K_INC72} / move_failed:72|극세사 타월 · 블루 자동 이동 실패: 입고중 부족`],
      [80, null, 10, 14, 4, 4, 4, null],
    ]);
  });

  it('비활성 SKU에 RG 재고가 있으면 알림 + 기록 줄(판정·이동 대상 아님)', async () => {
    const c = client({ deduct: true, auto: true, skus: [S72, { ...S80, active: false }] });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, [{ vid: '95401822934', qty: 108 }, { vid: '95400000080', qty: 3 }]) });
    expect(r.alerts).toContain('비활성 SKU 수건 RG 재고 3개');
    expect(m.postTransfer).toHaveBeenCalledTimes(1);
    expect(snapsOf()).toContainEqual([80, null, 10, 3, 4, 0, 0, 'inactive_sku:80|비활성 SKU 수건 RG 재고 3개']);
  });

  it('직전 차이(2회 연속 감소 판정)는 20시간보다 앞선 기록에서만 읽는다', async () => {
    const c = client({ deduct: true, auto: false });
    await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    const q = calls.find((x) => x.sql.includes('distinct on (sku_id)'))!;
    expect(q.sql).toMatch(/run_at < \$1::timestamptz - interval '20 hours'/);
    expect(q.params).toEqual([NOW.toISOString()]);
  });

  it('입고중 FIFO는 역전표 짝을 뺀다 — 원장 줄 id·reverses_id를 읽는다', async () => {
    const flows = [
      { id: '1', reverses_id: null, sku_id: '72', qty: 5, occurred_at: new Date('2026-09-20T00:00:00Z') },
      { id: '2', reverses_id: null, sku_id: '72', qty: 10, occurred_at: new Date('2026-09-25T00:00:00Z') },
      { id: '3', reverses_id: '2', sku_id: '72', qty: -10, occurred_at: new Date('2026-09-26T00:00:00Z') },
    ];
    const c = client({ deduct: true, auto: false, flows });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, [{ vid: '95401822934', qty: 100 }]) });
    expect(calls.find((x) => x.sql.includes('stock_ledger') && x.sql.includes("'rg_inbound'"))?.sql).toMatch(/reverses_id/);
    expect(r.alerts).toEqual(['극세사 타월 · 블루 입고중 15일째(2026-09-20 발송분)']);
  });

  it('텔레그램 중복 방지 — 직전 실행과 같은 알림·같은 옮길 예정이면 newAlerts 비고 movesChanged false', async () => {
    const prevRun = [
      { sku_id: '72', vid: null, planned_move: 5, alert: K_INC72 },
      { sku_id: null, vid: '95999999999', planned_move: 0, alert: K_UNMAPPED },
    ];
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(client({ deduct: true, auto: false, prevRun })) });
    expect(r.newAlerts).toEqual([]);
    expect(r.movesChanged).toBe(false);
    const q = calls.find((x) => x.sql.includes('with last as'))!;
    expect(q.params).toEqual([NOW.toISOString()]);
  });

  it('텔레그램 중복 방지 — 새 알림만 · 옮길 예정 수량이 바뀌면 movesChanged · 감소는 늘 보낸다', async () => {
    const DEC = '극세사 타월 · 블루 RG가 원장보다 2개 적다(2회 연속 — 분실·파손 의심)';
    const prevRun = [{ sku_id: '72', vid: null, planned_move: 4, alert: `decrease:72|${DEC}` }];
    const c = client({ deduct: true, auto: false, prevRun, prevDiff: [{ sku_id: '72', diff: -1 }] });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, [{ vid: '95401822934', qty: 98 }, { vid: '95999999999', qty: 2 }]) });
    expect(r.alerts).toEqual([DEC, UNMAPPED]);
    expect(r.newAlerts).toEqual([DEC, UNMAPPED]);
    expect(r.movesChanged).toBe(true); // 72:4 → 없음
    const r2 = await runRgAuto({ now: NOW, forceDry: false, deps: deps(client({ deduct: true, auto: false })) });
    expect(r2.newAlerts).toEqual([INC72, UNMAPPED]);
    expect(r2.movesChanged).toBe(true); // 기록 없음 → 72:5
  });

  it('forceDry면 스위치가 켜져 있어도 옮기지 않는다 · RG 수집이 실패하면 던진다', async () => {
    const c = client({ deduct: true, auto: true });
    await runRgAuto({ now: NOW, forceDry: true, deps: deps(c) });
    expect(m.postTransfer).not.toHaveBeenCalled();
    const d = deps(client({ deduct: true, auto: true }));
    d.collectRg.mockResolvedValue({ ok: false, error: '임대 못 잡음' });
    await expect(runRgAuto({ now: NOW, forceDry: false, deps: d })).rejects.toThrow(/RG 주문 수집/);
  });

  it('RG 수집이 busy(orders-sync와 겹침)면 기다렸다 다시 부른다 · 끝내 busy면 던진다', async () => {
    const d = deps(client({ deduct: true, auto: false }));
    d.collectRg.mockResolvedValueOnce({ ok: false, error: 'busy', busy: true });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: d });
    expect(r.skipped).toBeNull();
    expect(d.collectRg).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    const d2 = deps(client({ deduct: true, auto: false }));
    d2.collectRg.mockResolvedValue({ ok: false, error: 'busy', busy: true });
    await expect(runRgAuto({ now: NOW, forceDry: false, deps: d2 })).rejects.toThrow(/RG 주문 수집/);
    expect(d2.collectRg).toHaveBeenCalledTimes(5);
  });

  it('텔레그램 중복 방지는 고정 키로 — 입고중 초과 날짜 수가 늘어도(같은 발송분) 다시 보내지 않는다 · 수량이 바뀐 증가도 같은 키', async () => {
    const flows = [{ id: '1', reverses_id: null, sku_id: '72', qty: 5, occurred_at: new Date('2026-09-20T00:00:00Z') }];
    const prevRun = [{ sku_id: '72', vid: null, planned_move: 0,
      alert: 'inbound_stale:72:2026-09-20T00:00:00.000Z|극세사 타월 · 블루 입고중 14일째(2026-09-20 발송분) / unsent_increase:72|극세사 타월 · 블루 RG가 원장보다 1개 많다(보낸 기록 없음)' }];
    const c = client({ deduct: true, auto: false, flows, prevRun });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c, [{ vid: '95401822934', qty: 100 }]) });
    expect(r.alerts).toEqual(['극세사 타월 · 블루 입고중 15일째(2026-09-20 발송분)']);
    expect(r.newAlerts).toEqual([]);
  });
});
