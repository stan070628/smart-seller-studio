// src/__tests__/api/erp-stock-count-queue.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));

const dbRow = (id: number, o: Record<string, unknown> = {}) => ({
  id: String(id), key: `k${id}`, name: `상품${id}`, option_label: '', legacy: [], base_unit_label: null,
  self: 1, rg_inbound: 0, rg: 0, value: '1000', self_value: '1000', has_ledger: true, lot_cost: 1000, legacy_cost: null, last_counted_at: null, ...o,
});
const get = (url: string) => new NextRequest(`http://localhost${url}`);
let sql = '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-27T03:00:00Z')); // KST 2026-09-27 12:00
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockGetPool.mockReturnValue({
    query: vi.fn(async (q: string) => {
      sql = q;
      return {
        rows: [
          dbRow(1, { self_value: '500' }),
          dbRow(2, { self_value: '9000', last_counted_at: new Date('2026-09-20T01:00:00Z') }),
          dbRow(3, { self_value: '100' }),
          dbRow(4, { self_value: '8000', last_counted_at: new Date('2026-09-27T00:30:00Z') }), // 오늘(KST 09:30) 셌다
          dbRow(5, { self: 0, value: '0', self_value: '0', has_ledger: false }), // 전표 없음
        ],
        rowCount: 5,
      };
    }),
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/erp/stock/count-queue', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    expect((await GET(get('/api/erp/stock/count-queue'))).status).toBe(401);
  });

  it('우선순위대로 — 안 센 것(집 금액 순) → 오래된 것. 오늘 센 것·전표 없는 것은 빠진다', async () => {
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    const json = await (await GET(get('/api/erp/stock/count-queue'))).json();
    expect(json.data.today).toBe('2026-09-27');
    expect(json.data.n).toBe(8);
    expect(json.data.items.map((x: { skuId: number }) => x.skuId)).toEqual([1, 3, 2]);
    expect(json.data.items[2]).toMatchObject({ name: '상품2', selfValue: 9000, lastCountedAt: '2026-09-20T01:00:00.000Z' });
    expect(sql).toMatch(/from erp\.stock_counts c where c\.sku_id = s\.id and c\.location = 'self'/);
  });

  it('n은 1~30으로 자르고, 숫자가 아니면 기본 8', async () => {
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    expect((await (await GET(get('/api/erp/stock/count-queue?n=1'))).json()).data.items.map((x: { skuId: number }) => x.skuId)).toEqual([1]);
    expect((await (await GET(get('/api/erp/stock/count-queue?n=99'))).json()).data.n).toBe(30);
    expect((await (await GET(get('/api/erp/stock/count-queue?n=abc'))).json()).data.n).toBe(8);
  });
});
