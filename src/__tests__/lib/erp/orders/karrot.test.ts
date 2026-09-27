// src/__tests__/lib/erp/orders/karrot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ syncLegacySales: vi.fn(), runDeductions: vi.fn(), readDeductSetting: vi.fn(), readCutover: vi.fn() }));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));
vi.mock('@/lib/erp/orders/deduct', () => ({ runDeductions: m.runDeductions }));
vi.mock('@/lib/erp/orders/store', () => ({ readDeductSetting: m.readDeductSetting, readCutover: m.readCutover }));

import { KarrotError, cancelKarrotSale, recordKarrotSale, soldAtIso, validateKarrot } from '@/lib/erp/orders/karrot';

const REQ = '3f2b8c1e-8d4a-4b8e-9c1a-2b3c4d5e6f70';
const NOW = new Date('2026-09-28T05:00:00.000Z'); // KST 14:00
const PC = '00000000-0000-4000-8000-00000000000a';

describe('validateKarrot · soldAtIso', () => {
  it('SKU·수량·금액·날짜·요청 id를 검사한다(날짜는 오늘 이전 31일 안)', () => {
    expect(validateKarrot({ skuId: 72, qty: 2, amount: 20000, soldOn: '2026-09-28', note: ' 직거래 ', requestId: REQ.toUpperCase() }, '2026-09-28'))
      .toEqual({ skuId: 72, qty: 2, amount: 20000, soldOn: '2026-09-28', note: '직거래', requestId: REQ });
    for (const bad of [
      { skuId: 0, qty: 1, amount: 1, soldOn: '2026-09-28', requestId: REQ },
      { skuId: 72, qty: 0, amount: 1, soldOn: '2026-09-28', requestId: REQ },
      { skuId: 72, qty: 1, amount: -1, soldOn: '2026-09-28', requestId: REQ },
      { skuId: 72, qty: 1, amount: 1, soldOn: '2026-09-29', requestId: REQ },
      { skuId: 72, qty: 1, amount: 1, soldOn: '2026-08-01', requestId: REQ },
      { skuId: 72, qty: 1, amount: 1, soldOn: '2026-09-28', requestId: 'x' },
    ]) expect(() => validateKarrot(bad, '2026-09-28')).toThrow(KarrotError);
  });

  it('오늘이면 지금, 지난 날이면 그날 KST 정오', () => {
    expect(soldAtIso('2026-09-28', NOW)).toBe(NOW.toISOString());
    expect(soldAtIso('2026-09-27', NOW)).toBe('2026-09-27T03:00:00.000Z');
  });
});

type Route = (sql: string, params: unknown[]) => unknown[] | undefined;
let calls: { sql: string; params: unknown[] }[];
const db = (route: Route) => {
  calls = [];
  return {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      const rows = route(sql, params);
      if (!rows) throw new Error(`예상 못 한 SQL: ${sql.slice(0, 70)}`);
      return { rows, rowCount: rows.length };
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 0, warnings: [] });
  m.runDeductions.mockResolvedValue({ posted: 0, reversed: 0, short: 0, pending: 1, unchanged: 0 });
  m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
  m.readCutover.mockResolvedValue('2026-09-26T11:07:04.989Z');
});

const baseRoute = (o: { exists?: boolean; onHand?: number; pending?: number } = {}): Route => (sql) => {
  if (sql.startsWith("select id from erp.order_lines where channel = 'karrot'")) return o.exists ? [{ id: '900' }] : [];
  if (sql.startsWith('select name, option_label, status, legacy_product_cost_ids')) return [{ name: '극세사 타월', option_label: '블루', status: 'active', legacy_product_cost_ids: [PC] }];
  if (sql.startsWith('select coalesce(sum(qty)')) return [{ qty: o.onHand ?? 5 }];
  if (sql.startsWith('select coalesce(sum((a->>')) return [{ qty: o.pending ?? 1 }];
  if (sql.startsWith('insert into erp.orders')) return [{ id: '800' }];
  if (sql.startsWith('insert into erp.order_lines')) return [{ id: '901' }];
  return undefined;
};

describe('recordKarrotSale', () => {
  it('SKU 잠금 → 재고 확인(원장 − 차감 대기) → 주문·줄 → 옛 장부 → 차감(스위치 따름)', async () => {
    const d = db(baseRoute());
    const r = await recordKarrotSale(d, { skuId: 72, qty: 2, amount: 20000, soldOn: '2026-09-28', requestId: REQ }, NOW);
    expect(calls[0].params).toEqual([7101, 72]);
    const line = calls.find((c) => c.sql.startsWith('insert into erp.order_lines'));
    expect(line?.params).toEqual([
      800, REQ, 72, '[{"skuId":72,"qty":2}]', 2, 10000, 20000, NOW.toISOString(), '극세사 타월 · 블루', `karrot-${REQ}`, PC,
    ]);
    expect(m.syncLegacySales).toHaveBeenCalledWith(d, [`karrot-${REQ}`]);
    expect(m.runDeductions).toHaveBeenCalledWith(d, { enabled: false, cutover: '2026-09-26T11:07:04.989Z', lineIds: [901], channel: null, at: NOW.toISOString(), includeOpen: false });
    expect(r).toMatchObject({ lineId: 901, outcome: 'recorded' });
  });

  it('같은 요청 id면 아무것도 쓰지 않고 duplicate', async () => {
    const d = db(baseRoute({ exists: true }));
    expect(await recordKarrotSale(d, { skuId: 72, qty: 1, amount: 1, soldOn: '2026-09-28', requestId: REQ }, NOW)).toMatchObject({ lineId: 900, outcome: 'duplicate' });
    expect(calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('집 재고(원장 5 − 대기 1 = 4)보다 많으면 KarrotError(stock) — 쓰지 않는다', async () => {
    const d = db(baseRoute({ onHand: 5, pending: 1 }));
    await expect(recordKarrotSale(d, { skuId: 72, qty: 5, amount: 1, soldOn: '2026-09-28', requestId: REQ }, NOW)).rejects.toMatchObject({ code: 'stock' });
    expect(calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });
});

describe('cancelKarrotSale', () => {
  it('줄·주문을 취소로 → 옛 장부(무효) → 차감(역전표)', async () => {
    const d = db((sql) => {
      if (sql.startsWith('select id, status, legacy_key, order_id from erp.order_lines')) return [{ id: '901', status: 'paid', legacy_key: `karrot-${REQ}`, order_id: '800' }];
      if (sql.startsWith('update erp.order_lines') || sql.startsWith('update erp.orders')) return [];
      return undefined;
    });
    await cancelKarrotSale(d, 901, NOW);
    expect(calls.find((c) => c.sql.startsWith('update erp.order_lines'))?.sql).toContain("status = 'canceled'");
    expect(m.syncLegacySales).toHaveBeenCalledWith(d, [`karrot-${REQ}`]);
    expect(m.runDeductions).toHaveBeenCalledWith(d, expect.objectContaining({ lineIds: [901], includeOpen: false }));
  });

  it('당근 줄이 아니면 not_found · 이미 취소면 아무것도 안 한다', async () => {
    await expect(cancelKarrotSale(db(() => []), 1, NOW)).rejects.toMatchObject({ code: 'not_found' });
    const d = db((sql) => (sql.startsWith('select id, status') ? [{ id: '901', status: 'canceled', legacy_key: 'k', order_id: '800' }] : undefined));
    await cancelKarrotSale(d, 901, NOW);
    expect(m.runDeductions).not.toHaveBeenCalled();
  });
});
