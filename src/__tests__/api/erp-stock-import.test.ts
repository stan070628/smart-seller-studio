// src/__tests__/api/erp-stock-import.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { toCsv, type CountRow } from '@/lib/erp/ledger/opening';

const { mockGetCurrentUser, mockGetPool, mockReadDb, mockFetchRg, mockCommit } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockReadDb: vi.fn(),
  mockFetchRg: vi.fn(),
  mockCommit: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/opening-db', () => ({ readDb: mockReadDb, fetchRgStock: mockFetchRg, readRgLinks: vi.fn() }));
vi.mock('@/lib/erp/ledger/opening-import', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/opening-import')>()),
  commitOpeningImport: mockCommit,
}));

const row = (o: Partial<CountRow>): CountRow => ({
  skuId: 7, skuKey: 'k7', name: '왜건', option: '블랙', group: 'g1', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '', ...o,
});
const CSV = toCsv([row({ selfCount: 3 }), row({ skuId: 9, skuKey: 'k9', name: '타월', option: '', group: 'g2', selfCount: 1 })]);
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/erp/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('select distinct sku_id from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockReadDb.mockResolvedValue({
    skus: [
      { id: 7, key: 'k7', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-7'], baseUnitLabel: null },
      { id: 9, key: 'k9', name: '타월', optionLabel: '', legacyProductCostIds: [], baseUnitLabel: null },
    ],
    links: [{ vid: '111', skuId: 7, multiplier: 1 }],
    legacy: [{ productCostId: 'pc-7', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 1000 }], soldQty: 0, voidedQty: 0 }],
    baseUnitMissing: [],
  });
  mockFetchRg.mockResolvedValue([{ vid: '111', qty: 2 }]);
  mockCommit.mockResolvedValue(3);
});

describe('POST /api/erp/stock/import', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/import/route');
    expect((await POST(post({ csv: CSV, countedAt: new Date().toISOString(), commit: false }))).status).toBe(401);
  });

  it('머리글이 다른 CSV는 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    expect((await POST(post({ csv: 'a,b\n1,2', countedAt: new Date().toISOString(), commit: false }))).status).toBe(400);
  });

  it('미리보기: 단가를 모르는 SKU는 오류로, 합계는 지금 RG 포함', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt: new Date().toISOString(), commit: false }))).json();
    expect(json.data.committed).toBe(0);
    expect(json.data.errors.join('\n')).toContain('단가를 모른다: k9');
    expect(json.data.totals).toMatchObject({ self: 3, rg: 2, value: 5000 });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('오류가 있으면 commit=true여도 적재하지 않는다', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, countedAt: new Date().toISOString(), commit: true }))).json();
    expect(json.data.committed).toBe(0);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('단가를 입력하면 한 트랜잭션으로 적재한다', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt: new Date().toISOString(), unitCostOverrides: { k9: 800 }, commit: true }))).json();
    expect(json.data.errors).toEqual([]);
    expect(json.data.committed).toBe(3);
    const [db, plan, opts] = mockCommit.mock.calls[0];
    expect(db).toBe(client);
    expect(plan).toEqual([
      { skuId: 7, key: 'k7', location: 'self', qty: 3, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg', qty: 2, unitCost: 1000 },
      { skuId: 9, key: 'k9', location: 'self', qty: 1, unitCost: 800 },
    ]);
    expect(opts).toEqual({ fileName: 'count.csv', cutoverAt: json.data.cutoverAt });
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT']);
  });

  it('실사 시각이 24시간 넘게 지났으면 오류', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const json = await (await POST(post({ csv: CSV, countedAt: old, unitCostOverrides: { k9: 800 }, commit: true }))).json();
    expect(json.data.errors.join('\n')).toContain('24시간');
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
