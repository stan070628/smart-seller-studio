import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makePatchRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/products/${id}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

describe('PATCH /api/cost-management/products/[id] — hidden 필드', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid', email: 'test@example.com' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'prod-uuid', seller_product_id: null, vendor_item_id: null, naver_channel_product_no: null, variants: null, hidden: true }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('hidden: true 로 숨김 처리', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: true }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(true);
  });

  it('hidden: false 로 복원 처리 (falsy 함정 방지)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'prod-uuid', seller_product_id: null, vendor_item_id: null, naver_channel_product_no: null, variants: null, hidden: false }],
      rowCount: 1,
    });
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: false }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(false);
  });

  it('hidden 미전달 시 기존 값 유지 (null 전달)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'prod-uuid', seller_product_id: 12345, vendor_item_id: null, naver_channel_product_no: null, variants: null, hidden: false }],
      rowCount: 1,
    });
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    await PATCH(makePatchRequest('prod-uuid', { seller_product_id: 12345 }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(null);
  });

  it('hidden 값이 boolean이 아니면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: 'yes' }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(400);
  });
});
