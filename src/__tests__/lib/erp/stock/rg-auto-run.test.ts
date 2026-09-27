// src/__tests__/lib/erp/stock/rg-auto-run.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ postTransfer: vi.fn(), lockSku: vi.fn() }));
vi.mock('@/lib/erp/ledger/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/ledger/store')>('@/lib/erp/ledger/store');
  return { ...actual, postTransfer: m.postTransfer, lockSku: m.lockSku };
});

import { runRgAuto } from '@/lib/erp/stock/rg-auto-run';

const NOW = new Date('2026-10-05T00:30:00.000Z');
let calls: { sql: string; params: unknown[] }[];
function client(opts: { deduct: boolean; auto: boolean }) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("name = 'deduct_enabled'")) return { rows: [{ value: { enabled: opts.deduct } }], rowCount: 1 };
      if (sql.includes("name = 'rg_auto_arrive_enabled'")) return { rows: [{ value: { enabled: opts.auto } }], rowCount: 1 };
      if (sql.includes("location = 'rg'") && sql.includes('stock_on_hand')) return { rows: [{ sku_id: '72', qty: 100 }], rowCount: 1 };
      if (sql.includes("location = 'rg_inbound'") && sql.includes('stock_on_hand')) return { rows: [{ sku_id: '72', qty: 5 }], rowCount: 1 };
      if (sql.includes("l.channel = 'coupang_rg' and l.active")) return { rows: [{ vid: '95401822934', sku_id: '72', multiplier: 1 }], rowCount: 1 };
      if (sql.includes("status = 'active'")) return { rows: [{ id: '72' }], rowCount: 1 };
      if (sql.includes("where location = 'rg_inbound'") && sql.includes('stock_ledger')) return { rows: [{ sku_id: '72', qty: 5, occurred_at: new Date('2026-10-03T00:00:00Z') }], rowCount: 1 };
      if (sql.includes('from erp.rg_recon_snapshots')) return { rows: [], rowCount: 0 };
      if (sql.includes('from erp.skus where id = any')) return { rows: [{ id: '72', name: '극세사 타월', option_label: '블루' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
}
const deps = (c: ReturnType<typeof client>) => ({
  pool: { connect: vi.fn(async () => c as never) },
  collectRg: vi.fn(async (): Promise<{ ok: boolean; error: string | null; busy?: boolean }> => ({ ok: true, error: null })),
  fetchRgStock: vi.fn(async () => [{ vid: '95401822934', qty: 108 }, { vid: '95999999999', qty: 2 }]),
  sleep: vi.fn(async () => {}),
});

beforeEach(() => { calls = []; vi.clearAllMocks(); m.postTransfer.mockResolvedValue({ posted: true, ids: [1, 2] }); });

describe('runRgAuto', () => {
  it('차감이 꺼져 있으면 건너뛴다 — RG 수집·조회도 하지 않는다', async () => {
    const c = client({ deduct: false, auto: true });
    const d = deps(c);
    expect(await runRgAuto({ now: NOW, forceDry: false, deps: d })).toMatchObject({ skipped: 'deduct_off' });
    expect(d.collectRg).not.toHaveBeenCalled();
    expect(d.fetchRgStock).not.toHaveBeenCalled();
  });

  it('자동 이동 꺼짐 — 판정·기록만(옮길 예정), 전표 없음', async () => {
    const c = client({ deduct: true, auto: false });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(r).toMatchObject({ skipped: null, autoMove: false, moves: [{ skuId: 72, qty: 5 }] });
    expect(r.alerts).toEqual(['극세사 타월 · 블루 RG가 원장보다 3개 많다(보낸 기록 없음)', '연결 안 된 RG 번호 95999999999 재고 2개']);
    expect(m.postTransfer).not.toHaveBeenCalled();
    const snaps = calls.filter((x) => x.sql.startsWith('insert into erp.rg_recon_snapshots'));
    // [0]run_id [1]run_at [2]sku_id [3]vid [4]ledger [5]actual [6]inbound [7]planned [8]moved [9]alert
    expect(snaps.map((s) => s.params.slice(2))).toEqual([
      [72, null, 100, 108, 5, 5, 0, '극세사 타월 · 블루 RG가 원장보다 3개 많다(보낸 기록 없음)'],
      [null, '95999999999', 0, 2, 0, 0, 0, '연결 안 된 RG 번호 95999999999 재고 2개'],
    ]);
  });

  it('자동 이동 켜짐 — SKU 잠금 뒤 입고중 → RG 전표(멱등키 rgauto:<run>:<sku>)', async () => {
    const c = client({ deduct: true, auto: true });
    const r = await runRgAuto({ now: NOW, forceDry: false, deps: deps(c) });
    expect(r.autoMove).toBe(true);
    expect(m.lockSku).toHaveBeenCalledWith(c, 72);
    expect(m.postTransfer).toHaveBeenCalledWith(c, expect.objectContaining({
      skuId: 72, from: 'rg_inbound', to: 'rg', qty: 5, refType: 'rg_auto', idemKey: expect.stringMatching(/^rgauto:[0-9a-f-]{36}:72$/),
    }));
    expect(calls.find((x) => x.sql.startsWith('insert into erp.rg_recon_snapshots'))?.params[8]).toBe(5);
    expect(calls.map((x) => x.sql).filter((s) => s === 'BEGIN' || s === 'COMMIT')).toEqual(['BEGIN', 'COMMIT']);
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
});
