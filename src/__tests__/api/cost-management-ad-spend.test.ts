/**
 * PATCH /api/cost-management/products/[id]/ad-spend 테스트
 * 월별 광고비 upsert 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/products/${id}/ad-spend`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('PATCH /api/cost-management/products/[id]/ad-spend', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'row-uuid', product_id: 'prod-uuid', year_month: '2026-05', ad_spend: '150000' }],
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(401);
  });

  it('year_month 형식이 잘못되면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-5', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/year_month/i);
  });

  it('ad_spend 음수이면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: -1000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ad_spend/i);
  });

  it('정상 요청이면 upsert 쿼리 실행 후 200', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT/i);
  });
});
