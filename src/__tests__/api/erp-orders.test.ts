// src/__tests__/api/erp-orders.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getPool: vi.fn(),
  ordersStatus: vi.fn(), dayLines: vi.fn(), previewBackfill: vi.fn(), enableDeduction: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: m.getPool }));
vi.mock('@/lib/erp/orders/queries', () => ({ ordersStatus: m.ordersStatus, dayLines: m.dayLines }));
vi.mock('@/lib/erp/orders/deduct', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/deduct')>('@/lib/erp/orders/deduct');
  return { ...actual, previewBackfill: m.previewBackfill, enableDeduction: m.enableDeduction };
});

import { DeductSwitchError } from '@/lib/erp/orders/deduct';

const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
const get = (path: string) => new NextRequest(`http://localhost${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  m.getPool.mockReturnValue(pool);
});

describe('/api/erp/orders/*', () => {
  it('로그인하지 않으면 네 라우트 모두 401', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const status = await import('@/app/api/erp/orders/status/route');
    const lines = await import('@/app/api/erp/orders/lines/route');
    const preview = await import('@/app/api/erp/orders/deduct-preview/route');
    const enable = await import('@/app/api/erp/orders/deduct-enable/route');
    expect((await status.GET(get('/api/erp/orders/status'))).status).toBe(401);
    expect((await lines.GET(get('/api/erp/orders/lines?channel=naver&date=2026-09-27'))).status).toBe(401);
    expect((await preview.GET(get('/api/erp/orders/deduct-preview'))).status).toBe(401);
    expect((await enable.POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }))).status).toBe(401);
    expect(m.enableDeduction).not.toHaveBeenCalled();
  });

  it('GET status — 수집 현황', async () => {
    m.ordersStatus.mockResolvedValue({ today: '2026-09-27', channels: [] });
    const { GET } = await import('@/app/api/erp/orders/status/route');
    const res = await GET(get('/api/erp/orders/status'));
    expect((await res.json()).data.today).toBe('2026-09-27');
    expect(m.ordersStatus).toHaveBeenCalledWith(pool, expect.any(Date));
  });

  it('GET lines — 채널·날짜를 검사한다', async () => {
    m.dayLines.mockResolvedValue([{ id: 1 }]);
    const { GET } = await import('@/app/api/erp/orders/lines/route');
    expect((await GET(get('/api/erp/orders/lines?channel=karrot&date=2026-09-27'))).status).toBe(400);
    expect((await GET(get('/api/erp/orders/lines?channel=naver&date=2026-9-27'))).status).toBe(400);
    const res = await GET(get('/api/erp/orders/lines?channel=naver&date=2026-09-27'));
    expect((await res.json()).data).toEqual([{ id: 1 }]);
    expect(m.dayLines).toHaveBeenCalledWith(pool, 'naver', '2026-09-27');
  });

  it('GET deduct-preview', async () => {
    m.previewBackfill.mockResolvedValue({ lines: 3 });
    const { GET } = await import('@/app/api/erp/orders/deduct-preview/route');
    expect((await (await GET(get('/api/erp/orders/deduct-preview'))).json()).data).toEqual({ lines: 3 });
  });

  it('POST deduct-enable — confirm·expectedLines 필수, 한 트랜잭션에서 켠 사람과 함께', async () => {
    const { POST } = await import('@/app/api/erp/orders/deduct-enable/route');
    expect((await POST(post('/api/erp/orders/deduct-enable', { expectedLines: 1 }))).status).toBe(400);
    expect((await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: '1' }))).status).toBe(400);
    m.enableDeduction.mockResolvedValue({ preview: { lines: 1 }, summary: { posted: 1 } });
    const res = await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }));
    expect(res.status).toBe(200);
    expect(m.enableDeduction).toHaveBeenCalledWith(client, { expectedLines: 1, by: 'u-1', at: expect.any(String) });
    expect(client.query.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['BEGIN', 'COMMIT']);
  });

  it('POST deduct-enable — 이미 켜짐·수가 바뀜은 409(코드 그대로) · 롤백', async () => {
    const { POST } = await import('@/app/api/erp/orders/deduct-enable/route');
    m.enableDeduction.mockRejectedValue(new DeductSwitchError('stale', '소급할 라인이 바뀌었다'));
    const res = await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'stale' });
    expect(client.query.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
