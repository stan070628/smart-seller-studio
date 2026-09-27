import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingIndex } from '@/lib/erp/orders/resolve';

const m = vi.hoisted(() => ({
  loadListingIndex: vi.fn(), loadLegacyIndex: vi.fn(), readCutover: vi.fn(), readDeductSetting: vi.fn(),
  syncLegacySales: vi.fn(), runDeductions: vi.fn(),
}));
vi.mock('@/lib/erp/orders/store', () => ({
  loadListingIndex: m.loadListingIndex, loadLegacyIndex: m.loadLegacyIndex, readCutover: m.readCutover, readDeductSetting: m.readDeductSetting,
}));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));
vi.mock('@/lib/erp/orders/deduct', () => ({ runDeductions: m.runDeductions }));

import { relinkLines } from '@/lib/erp/orders/relink';

const PC = '00000000-0000-4000-8000-00000000000a';
const stored = (o: Record<string, unknown> = {}) => ({
  id: '11', channel: 'toss', external_order_id: '9001', external_line_id: '318224910', ordered_at: '2026-09-26T12:47:57Z',
  paid_at: '2026-09-26T12:47:57Z', raw_status: 'PAID', status: 'paid', product_id: '698610759', option_key: '10개, 옐로우',
  alt_product_id: null, product_label: '극세사 타월 · 10개, 옐로우', order_qty: 1, unit_price: 12800, amount: 12800,
  manual_sku_id: null, listing_id: null, alloc: [], attribution: 'unattributed', unattributed_reason: 'option_unmatched',
  legacy_key: 'toss-318224910', legacy_product_cost_id: null, legacy_qty: null, ...o,
});

let calls: { sql: string; params: unknown[] }[];
function db(rows: unknown[]) {
  calls = [];
  return {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('from erp.order_lines l join erp.orders o')) return { rows, rowCount: rows.length };
      if (sql.startsWith('update erp.order_lines')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.loadListingIndex.mockResolvedValue(new ListingIndex([
    { listingId: 361, channel: 'toss', productId: '698610759', optionKey: '10개 / 옐로우', linkMode: 'single', skus: [{ skuId: 73, multiplier: 1 }] },
  ]));
  m.loadLegacyIndex.mockResolvedValue({ skuLegacy: new Map([[73, [PC]]]), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() });
  m.readCutover.mockResolvedValue('2026-09-26T11:07:04.989Z');
  m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
  m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 0, warnings: [] });
  m.runDeductions.mockResolvedValue({ posted: 0, reversed: 0, short: 0, pending: 1, unchanged: 0 });
});

describe('relinkLines', () => {
  it('저장된 줄을 지금 리스팅으로 다시 판정해 바뀐 줄만 쓰고 → 옛 장부 → 차감(스위치 그대로)', async () => {
    const d = db([stored()]);
    const r = await relinkLines(d, [11], '2026-09-27T09:00:00.000Z');
    const upd = calls.filter((c) => c.sql.startsWith('update erp.order_lines'));
    expect(upd).toHaveLength(1);
    // [0]id [1]listing_id [2]sku_id [3]alloc [4]attribution [5]reason [6]sku_qty [7]legacy_pc [8]legacy_qty
    expect(upd[0].params).toEqual([11, 361, 73, '[{"skuId":73,"qty":1}]', 'mapped', null, 1, PC, 1]);
    expect(m.syncLegacySales).toHaveBeenCalledWith(d, ['toss-318224910']);
    expect(m.runDeductions).toHaveBeenCalledWith(d, {
      enabled: false, cutover: '2026-09-26T11:07:04.989Z', lineIds: [11], channel: null, at: '2026-09-27T09:00:00.000Z', includeOpen: false,
    });
    expect(r).toMatchObject({ checked: 1, changed: [11] });
  });

  it('판정이 같으면 쓰지 않고 옛 장부·차감도 부르지 않는다', async () => {
    const d = db([stored({ listing_id: '361', alloc: [{ skuId: 73, qty: 1 }], attribution: 'mapped', unattributed_reason: null, legacy_product_cost_id: PC, legacy_qty: 1 })]);
    const r = await relinkLines(d, [11], '2026-09-27T09:00:00.000Z');
    expect(calls.some((c) => c.sql.startsWith('update'))).toBe(false);
    expect(m.syncLegacySales).not.toHaveBeenCalled();
    expect(m.runDeductions).not.toHaveBeenCalled();
    expect(r.changed).toEqual([]);
  });

  it('manual_sku_id가 있으면 그 SKU', async () => {
    const d = db([stored({ manual_sku_id: '72' })]);
    await relinkLines(d, [11], '2026-09-27T09:00:00.000Z');
    const upd = calls.find((c) => c.sql.startsWith('update erp.order_lines'));
    expect(upd?.params.slice(2, 5)).toEqual([72, '[{"skuId":72,"qty":1}]', 'mapped']);
  });

  it('빈 목록이면 아무것도 읽지 않는다', async () => {
    const d = db([]);
    expect(await relinkLines(d, [], 'x')).toEqual({ checked: 0, changed: [], legacy: null, deduct: null });
    expect(calls).toHaveLength(0);
  });
});
