// src/__tests__/api/erp-home.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockToday, mockRevenue, mockMonthly } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn(), mockToday: vi.fn(), mockRevenue: vi.fn(), mockMonthly: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/home/today', () => ({ buildToday: mockToday }));
vi.mock('@/lib/erp/home/revenue', () => ({ buildRevenue: mockRevenue }));
vi.mock('@/lib/erp/home/monthly', () => ({ buildMonthly: mockMonthly }));

const get = (url: string) => new NextRequest(`http://localhost${url}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockGetPool.mockReturnValue({ query: vi.fn() });
  mockToday.mockResolvedValue({ newOrders: { data: { count: 1, stale: 0 }, error: null } });
  mockRevenue.mockResolvedValue({ period: '7d', days: [], totals: { revenue: 0, orders: 0, byChannel: {} } });
  mockMonthly.mockResolvedValue([{ month: '2026-09', revenue: 1, orders: 1, source: 'erp' }]);
});

describe('GET /api/erp/home/today', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/home/today/route');
    expect((await GET(get('/api/erp/home/today'))).status).toBe(401);
  });
  it('buildToday 결과를 돌려준다', async () => {
    const { GET } = await import('@/app/api/erp/home/today/route');
    const res = await GET(get('/api/erp/home/today'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { newOrders: { data: { count: 1, stale: 0 }, error: null } } });
  });
});

describe('GET /api/erp/home/revenue', () => {
  it('이번달이면 최근 6개월 월 매출(months)을 붙이고, 아니면 붙이지 않는다', async () => {
    const { GET } = await import('@/app/api/erp/home/revenue/route');
    const m = await (await GET(get('/api/erp/home/revenue?period=month'))).json();
    expect(m.data.months).toEqual([{ month: '2026-09', revenue: 1, orders: 1, source: 'erp' }]);
    const w = await (await GET(get('/api/erp/home/revenue?period=7d'))).json();
    expect(w.data.months).toBeUndefined();
    expect(mockMonthly).toHaveBeenCalledTimes(1);
  });

  it('period가 이상하면 400', async () => {
    const { GET } = await import('@/app/api/erp/home/revenue/route');
    expect((await GET(get('/api/erp/home/revenue?period=year'))).status).toBe(400);
  });
  it('period를 넘기고 기본값은 30d', async () => {
    const { GET } = await import('@/app/api/erp/home/revenue/route');
    await GET(get('/api/erp/home/revenue?period=7d'));
    expect(mockRevenue.mock.calls[0][1]).toBe('7d');
    await GET(get('/api/erp/home/revenue'));
    expect(mockRevenue.mock.calls[1][1]).toBe('30d');
  });
  it('집계가 던지면 500', async () => {
    mockRevenue.mockRejectedValue(new Error('db down'));
    const { GET } = await import('@/app/api/erp/home/revenue/route');
    expect((await GET(get('/api/erp/home/revenue?period=7d'))).status).toBe(500);
  });
});
