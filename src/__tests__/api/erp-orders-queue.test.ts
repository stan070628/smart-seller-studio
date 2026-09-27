// src/__tests__/api/erp-orders-queue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getPool: vi.fn(), unattributedGroups: vi.fn(), recentLinks: vi.fn(),
  linkListing: vi.fn(), linkLines: vi.fn(), unlinkListing: vi.fn(), unlinkLine: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: m.getPool }));
vi.mock('@/lib/erp/orders/queue', () => ({ unattributedGroups: m.unattributedGroups, recentLinks: m.recentLinks }));
vi.mock('@/lib/erp/orders/link', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/link')>('@/lib/erp/orders/link');
  return { ...actual, linkListing: m.linkListing, linkLines: m.linkLines, unlinkListing: m.unlinkListing, unlinkLine: m.unlinkLine };
});

import { LinkError } from '@/lib/erp/orders/link';

const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  m.getPool.mockReturnValue(pool);
});

describe('/api/erp/orders 대기열', () => {
  it('로그인하지 않으면 401', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const q = await import('@/app/api/erp/orders/unattributed/route');
    const l = await import('@/app/api/erp/orders/link/route');
    const u = await import('@/app/api/erp/orders/unlink/route');
    expect((await q.GET(new NextRequest('http://localhost/api/erp/orders/unattributed'))).status).toBe(401);
    expect((await l.POST(post('/api/erp/orders/link', {}))).status).toBe(401);
    expect((await u.POST(post('/api/erp/orders/unlink', {}))).status).toBe(401);
  });

  it('GET unattributed — 묶음 + 최근 연결', async () => {
    m.unattributedGroups.mockResolvedValue([{ productId: '1' }]);
    m.recentLinks.mockResolvedValue({ listings: [], lines: [] });
    const { GET } = await import('@/app/api/erp/orders/unattributed/route');
    const json = await (await GET(new NextRequest('http://localhost/api/erp/orders/unattributed'))).json();
    expect(json.data).toEqual({ groups: [{ productId: '1' }], recent: { listings: [], lines: [] } });
    expect(m.recentLinks).toHaveBeenCalledWith(pool, 20);
  });

  it('POST link — mode listing/line을 트랜잭션 안에서 부르고 LinkError는 코드별 HTTP', async () => {
    m.linkListing.mockResolvedValue({ listingId: 1801, relinked: { changed: [5] } });
    const { POST } = await import('@/app/api/erp/orders/link/route');
    const ok = await POST(post('/api/erp/orders/link', { mode: 'listing', channel: 'coupang_rg', productId: '9', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }));
    expect(ok.status).toBe(200);
    expect(m.linkListing).toHaveBeenCalledWith(client, { channel: 'coupang_rg', productId: '9', optionKey: '', skuId: 72, multiplier: 1, label: 'x' }, expect.any(String));
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');

    m.linkLines.mockResolvedValue({ changed: [55] });
    await POST(post('/api/erp/orders/link', { mode: 'line', lineIds: [55], skuId: 73 }));
    expect(m.linkLines).toHaveBeenCalledWith(client, { lineIds: [55], skuId: 73 }, expect.any(String));

    m.linkListing.mockRejectedValue(new LinkError('exists', '이미 있다'));
    expect((await POST(post('/api/erp/orders/link', { mode: 'listing', channel: 'toss', productId: '1', optionKey: '', skuId: 1, multiplier: 1, label: '' }))).status).toBe(409);
    expect((await POST(post('/api/erp/orders/link', { mode: 'x' }))).status).toBe(400);
  });

  it('(리뷰 A5~A7 #3) skuId 등이 숫자가 아니면 400 — Number(true)===1로 새지 않는다', async () => {
    const { POST } = await import('@/app/api/erp/orders/link/route');
    const listing = await POST(post('/api/erp/orders/link', { mode: 'listing', channel: 'coupang_rg', productId: '9', optionKey: '', skuId: true, multiplier: 1, label: 'x' }));
    expect(listing.status).toBe(400);
    expect(m.linkListing).not.toHaveBeenCalled();
    const line = await POST(post('/api/erp/orders/link', { mode: 'line', lineIds: [55, true], skuId: 73 }));
    expect(line.status).toBe(400);
    expect(m.linkLines).not.toHaveBeenCalled();
  });

  it('POST unlink — listing/line, 숫자 문자열도 받는다', async () => {
    m.unlinkListing.mockResolvedValue({ changed: [] });
    m.unlinkLine.mockResolvedValue({ changed: [] });
    const { POST } = await import('@/app/api/erp/orders/unlink/route');
    await POST(post('/api/erp/orders/unlink', { mode: 'listing', listingId: 1801 }));
    await POST(post('/api/erp/orders/unlink', { mode: 'line', lineId: 55 }));
    expect(m.unlinkListing).toHaveBeenCalledWith(client, 1801, expect.any(String));
    expect(m.unlinkLine).toHaveBeenCalledWith(client, 55, expect.any(String));

    const strRes = await POST(post('/api/erp/orders/unlink', { mode: 'listing', listingId: '1801' }));
    expect(strRes.status).toBe(200);
    expect(m.unlinkListing).toHaveBeenLastCalledWith(client, 1801, expect.any(String));

    const badRes = await POST(post('/api/erp/orders/unlink', { mode: 'listing', listingId: true }));
    expect(badRes.status).toBe(400);
  });
});
