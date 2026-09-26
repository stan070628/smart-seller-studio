// src/__tests__/api/erp-stock-rg.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockApply, mockFetchRg, mockLinks } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockApply: vi.fn(),
  mockFetchRg: vi.fn(),
  mockLinks: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/opening-db', () => ({ fetchRgStock: mockFetchRg, readRgLinks: mockLinks, readDb: vi.fn() }));
vi.mock('@/lib/erp/ledger/adjust-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/adjust-store')>()),
  applyAdjustments: mockApply,
}));

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  // 활성 SKU 확인은 이제 트랜잭션 안(client)에서 한다 — pool이 아니라 client가 그 SQL을 답한다
  client = {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('select sku_id, qty from erp.stock_on_hand')) return { rows: [{ sku_id: '7', qty: 5 }], rowCount: 1 };
      if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockLinks.mockResolvedValue([{ vid: '111', skuId: 7, multiplier: 1 }, { vid: '222', skuId: 9, multiplier: 2 }]);
  mockFetchRg.mockResolvedValue([{ vid: '111', qty: 4 }, { vid: '222', qty: 1 }, { vid: '333', qty: 2 }]);
});

describe('GET /api/erp/stock/rg-reconcile', () => {
  it('로그인하지 않으면 401이고 쿠팡을 부르지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/rg-reconcile/route');
    expect((await GET(new NextRequest('http://localhost/api/erp/stock/rg-reconcile'))).status).toBe(401);
    expect(mockFetchRg).not.toHaveBeenCalled();
  });

  it('SKU별 원장 RG와 실재고(배수 환산)를 돌려주고 미매핑 vid는 이슈로', async () => {
    const { GET } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const json = await (await GET(new NextRequest('http://localhost/api/erp/stock/rg-reconcile'))).json();
    expect(json.data.rows).toEqual([{ skuId: 7, ledger: 5, actual: 4 }, { skuId: 9, ledger: 0, actual: 2 }]);
    expect(json.data.issues).toEqual([expect.objectContaining({ kind: 'rg_vid_unmapped', ref: '333' })]);
    expect(json.data.inactive).toEqual([]);
  });
});

describe('POST /api/erp/stock/rg-reconcile', () => {
  it('로그인하지 않으면 401이고 쓰지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 7, expected: 5, actual: 4, requestId: REQ }] }),
    }));
    expect(res.status).toBe(401);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('확인한 행을 RG 위치 지금개수 조정(사유 rg_reconcile)으로 한 트랜잭션에 반영한다', async () => {
    mockApply.mockResolvedValue([]);
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 7, expected: 5, actual: 4, requestId: REQ, unitCost: null }] }),
    }));
    expect(res.status).toBe(200);
    expect(mockApply.mock.calls[0][1]).toEqual([{
      skuId: 7, location: 'rg', mode: 'count', value: 4, expected: 5, reason: 'rg_reconcile', note: 'RG 실재고 대조',
      unitCost: undefined, requestId: REQ, occurredAt: expect.any(String),
    }]);
  });

  it('활성이 아닌 SKU는 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 11, expected: 0, actual: 1, requestId: REQ }] }),
    }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it.each([
    ['빈 문자열', ''],
    ['불리언', true],
    ['배열', []],
    ['null', null],
  ])('actual이 실수가 아니면(%s) 400', async (_label, actual) => {
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 7, expected: 5, actual, requestId: REQ }] }),
    }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });
});
