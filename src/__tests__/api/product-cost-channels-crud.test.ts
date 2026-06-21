import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockAuth = getCurrentUser as ReturnType<typeof vi.fn>;
const mockPool = getSourcingPool as ReturnType<typeof vi.fn>;

describe('POST /api/cost-management/products/[id]/channels', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com' });
    mockQuery = vi.fn();
    mockPool.mockReturnValue({ query: mockQuery });
  });

  it('coupang_rg 채널 추가 성공', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'ch-1', channel_type: 'coupang_rg', external_id: 95401822935, created_at: new Date() }] });

    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: 95401822935 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.channel_type).toBe('coupang_rg');
    expect(json.data.external_id).toBe(95401822935);
  });

  it('잘못된 channel_type → 400', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'invalid_channel', external_id: 12345 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('external_id 음수 → 400', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: -1 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(400);
  });

  it('없는 product → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check 실패
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/missing/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: 12345 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cost-management/products/[id]/channels/[channelId]', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com' });
    mockQuery = vi.fn();
    mockPool.mockReturnValue({ query: mockQuery });
  });

  it('채널 삭제 성공', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const { DELETE } = await import('@/app/api/cost-management/products/[id]/channels/[channelId]/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels/ch-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'prod-1', channelId: 'ch-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('없는 채널 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const { DELETE } = await import('@/app/api/cost-management/products/[id]/channels/[channelId]/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels/missing');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'prod-1', channelId: 'missing' }) });
    expect(res.status).toBe(404);
  });
});
