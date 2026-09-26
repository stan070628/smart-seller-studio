// src/__tests__/api/receipts-confirm-ledger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockCreate, mockSync, mockPostLots, order } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockCreate: vi.fn(),
  mockSync: vi.fn(),
  mockPostLots: vi.fn(),
  order: [] as string[],
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/cost-management/create-entry', () => ({ createCostEntry: mockCreate }));
vi.mock('@/lib/receipt/draft-status', () => ({ syncDraftStatus: mockSync }));
vi.mock('@/lib/erp/ledger/receipt', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/receipt')>()),
  postReceiptLots: mockPostLots,
}));

import { ReceiptSplitError } from '@/lib/erp/ledger/receipt';

const LINE = {
  id: 'line-uuid-1', line_no: 1, item_code: '713160', item_label: '라운드티', quantity: '4', unit_price: 2500, amount: 10000,
  is_discount: false, applies_to_line_id: null, tax_type: 'taxable', decision: 'ingest', product_cost_id: 'pc-1',
  entry_type: 'normal', items_per_box: null, subdivision_unit: null, cost_entry_id: null,
};
const ctx = { params: Promise.resolve({ id: 'd-1' }) };
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/receipts/d-1/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  client = {
    query: vi.fn(async (sql: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { order.push(sql); return { rows: [], rowCount: 0 }; }
      if (sql.startsWith('UPDATE receipt_draft_lines')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO costco_item_map')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 40)}`);
    }),
    release: vi.fn(),
  };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM receipt_drafts')) return { rows: [{ id: 'd-1', purchased_at: '2026-09-20' }] };
      if (sql.includes('FROM receipt_draft_lines')) return { rows: [LINE] };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 40)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockCreate.mockResolvedValue({ entry: { id: 'ce-1', quantity: '4', unit_cost: 2500 }, carryoverOut: null, isSubdivisionMode: false });
  mockSync.mockResolvedValue('unchanged');
  mockPostLots.mockImplementation(async () => { order.push('ledger'); return [{ skuId: 7, qty: 4 }]; });
});

describe('POST /api/receipts/[id]/confirm — 원장 입고', () => {
  it('입고(cost_entries)와 같은 트랜잭션에서 COMMIT 전에 원장 입고를 기록한다', async () => {
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    const res = await POST(post({ sku_splits: { 1: [{ sku_id: 7, qty: 4 }] } }), ctx);
    const json = await res.json();
    expect(json.data.created).toEqual([{ line_no: 1, cost_entry_id: 'ce-1' }]);
    expect(order).toEqual(['BEGIN', 'ledger', 'COMMIT']);
    expect(mockPostLots).toHaveBeenCalledWith(client, {
      lineId: 'line-uuid-1', lineNo: 1, itemCode: '713160', itemLabel: '라운드티', productCostId: 'pc-1',
      packs: 4, unitCost: 2500, receivedAt: '2026-09-20', requested: [{ skuId: 7, qty: 4 }],
    });
  });

  it('원장 분배가 틀리면 그 줄은 실패로 알리고 입고까지 되돌린다', async () => {
    mockPostLots.mockRejectedValue(new ReceiptSplitError('옵션이 2개다 — 확정 화면에서 옵션별 수량을 나눈다'));
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    const json = await (await POST(post({}), ctx)).json();
    expect(json.data.created).toEqual([]);
    expect(json.data.failed).toEqual([{ line_no: 1, error: '옵션이 2개다 — 확정 화면에서 옵션별 수량을 나눈다' }]);
    expect(order).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('「다른 SKU로 바꾸기」 표시(manual)를 원장 입고까지 넘긴다', async () => {
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    await POST(post({ sku_splits: { 1: [{ sku_id: 99, qty: null, manual: true }] } }), ctx);
    expect(mockPostLots.mock.calls[0][1].requested).toEqual([{ skuId: 99, qty: null, manual: true }]);
  });

  it('sku_splits 형태가 틀리면 400 — 안내는 ~습니다 체', async () => {
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    const res = await POST(post({ sku_splits: [1, 2] }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('옵션 분배(sku_splits) 형식이 잘못됐습니다.');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
