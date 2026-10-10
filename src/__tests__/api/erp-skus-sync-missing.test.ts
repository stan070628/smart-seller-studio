// src/__tests__/api/erp-skus-sync-missing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockMissing } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockMissing: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));
vi.mock('@/lib/erp/sku/sync-app', () => ({ syncMissingForApp: mockMissing, syncForApp: vi.fn() }));

const req = () => new NextRequest('http://localhost/api/erp/skus/sync-missing', { method: 'POST', body: '{}' });
const RESULT = {
  results: [{ sellerProductId: 300, productName: 'C', status: 'created', skus: 2 }],
  created: 1, exists: 0, failed: 0, skus: 2, more: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockMissing.mockResolvedValue(RESULT);
});

describe('POST /api/erp/skus/sync-missing', () => {
  it('로그인하지 않으면 401 — 돌리지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    expect((await POST(req())).status).toBe(401);
    expect(mockMissing).not.toHaveBeenCalled();
  });

  it('결과를 돌려준다', async () => {
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: RESULT });
  });

  it('후보 조회가 던지면 500 server', async () => {
    mockMissing.mockRejectedValueOnce(new Error('db down'));
    const { POST } = await import('@/app/api/erp/skus/sync-missing/route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('server');
  });
});
