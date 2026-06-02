// src/__tests__/api/rg-shipments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeGetRequest(params = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/rg-shipments${params}`,
    { method: 'GET' }
  );
}

describe('GET /api/cost-management/rg-shipments', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('이벤트 없으면 빈 배열 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('이벤트 목록을 반환한다', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'event-uuid-1',
          shipped_at: '2026-05-28',
          total_shipping_fee: 22750,
          created_at: '2026-05-28T10:00:00Z',
          items: [
            { product_name: '상품A', quantity: 100, unit_rg_fee: 152 },
          ],
        },
      ],
    });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].shipped_at).toBe('2026-05-28');
    expect(json.data[0].items[0].product_name).toBe('상품A');
  });

  it('limit 파라미터가 쿼리에 반영된다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    await GET(makeGetRequest('?limit=5'));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT/i);
    expect(params).toContain(5);
  });
});
