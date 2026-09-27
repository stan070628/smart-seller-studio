// src/__tests__/api/erp-karrot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getPool: vi.fn(), recordKarrotSale: vi.fn(), cancelKarrotSale: vi.fn(), recentKarrot: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: m.getPool }));
vi.mock('@/lib/erp/orders/karrot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/karrot')>('@/lib/erp/orders/karrot');
  return { ...actual, recordKarrotSale: m.recordKarrotSale, cancelKarrotSale: m.cancelKarrotSale, recentKarrot: m.recentKarrot };
});
import { KarrotError } from '@/lib/erp/orders/karrot';

const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
const post = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const REQ = '3f2b8c1e-8d4a-4b8e-9c1a-2b3c4d5e6f70';

beforeEach(() => { vi.clearAllMocks(); m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' }); m.getPool.mockReturnValue(pool); });

describe('/api/erp/sales/karrot', () => {
  it('로그인하지 않으면 401', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const r = await import('@/app/api/erp/sales/karrot/route');
    const c = await import('@/app/api/erp/sales/karrot/cancel/route');
    expect((await r.GET(new NextRequest('http://localhost/api/erp/sales/karrot'))).status).toBe(401);
    expect((await r.POST(post('/api/erp/sales/karrot', {}))).status).toBe(401);
    expect((await c.POST(post('/api/erp/sales/karrot/cancel', { lineId: 1 }))).status).toBe(401);
  });

  it('POST — 검사 뒤 트랜잭션 안에서 기록 · 재고 초과는 409 · 입력 오류 400', async () => {
    m.recordKarrotSale.mockResolvedValue({ lineId: 901, outcome: 'recorded', deduct: null });
    const { POST } = await import('@/app/api/erp/sales/karrot/route');
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const ok = await POST(post('/api/erp/sales/karrot', { skuId: 72, qty: 1, amount: 10000, soldOn: today, requestId: REQ }));
    expect(ok.status).toBe(200);
    expect(m.recordKarrotSale).toHaveBeenCalledWith(client, { skuId: 72, qty: 1, amount: 10000, soldOn: today, requestId: REQ }, expect.any(Date));
    expect((await POST(post('/api/erp/sales/karrot', { skuId: 72, qty: 0, amount: 1, soldOn: today, requestId: REQ }))).status).toBe(400);
    m.recordKarrotSale.mockRejectedValue(new KarrotError('stock', '재고 부족'));
    expect((await POST(post('/api/erp/sales/karrot', { skuId: 72, qty: 9, amount: 1, soldOn: today, requestId: REQ }))).status).toBe(409);
  });

  it('GET 최근 10건 · cancel', async () => {
    m.recentKarrot.mockResolvedValue([]);
    const { GET } = await import('@/app/api/erp/sales/karrot/route');
    await GET(new NextRequest('http://localhost/api/erp/sales/karrot'));
    expect(m.recentKarrot).toHaveBeenCalledWith(pool, 10);
    const { POST } = await import('@/app/api/erp/sales/karrot/cancel/route');
    await POST(post('/api/erp/sales/karrot/cancel', { lineId: 901 }));
    expect(m.cancelKarrotSale).toHaveBeenCalledWith(client, 901, expect.any(Date));
    expect((await POST(post('/api/erp/sales/karrot/cancel', { lineId: 'x' }))).status).toBe(400);
  });
});
