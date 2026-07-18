/**
 * POST /api/cost-management/products/[id]/sales — sale_amount 저장 검증
 * 수동 입력 규약: sale_amount = selling_price × quantity (단품 축)
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
  return new NextRequest(`http://localhost/api/cost-management/products/${id}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST sales — sale_amount', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
    mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })      // 소유 확인
      .mockResolvedValueOnce({ rows: [{ id: 'sale-1' }] });     // INSERT RETURNING
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('sale_amount = selling_price × quantity 로 INSERT 파라미터에 포함', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/sales/route');
    const res = await POST(
      makeRequest('prod-1', { sold_at: '2026-07-10', quantity: 3, selling_price: 10000, channel: 'manual' }),
      { params: Promise.resolve({ id: 'prod-1' }) },
    );
    expect(res.status).toBe(201);
    // 두 번째 쿼리(INSERT)의 파라미터 배열에 sale_amount=30000 포함
    const insertCall = mockQuery.mock.calls[1];
    const sql = insertCall[0] as string;
    const params = insertCall[1] as unknown[];
    expect(sql).toContain('sale_amount');
    expect(params).toContain(30000);
  });
});

describe('PATCH sales — sale_amount 재계산', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
    mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'sale-1' }] }); // UPDATE RETURNING
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('수량·판매가 수정 시 sale_amount를 COALESCE 곱으로 재계산', async () => {
    const { PATCH } = await import('@/app/api/cost-management/sales/[id]/route');
    const req = new NextRequest('http://localhost/api/cost-management/sales/sale-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'sale-1' }) });
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    // UPDATE에 sale_amount 재계산이 포함돼야 함
    expect(sql).toContain('sale_amount');
    expect(sql).toMatch(/sale_amount\s*=\s*COALESCE/);
  });
});
