/**
 * PUT /api/settlement/expenses/[date] — 일별 수동 비용 upsert
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeReq(date: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/expenses/${date}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT settlement/expenses/[date]', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
    mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'e1' }] });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('잘못된 날짜 형식이면 400', async () => {
    const { PUT } = await import('@/app/api/settlement/expenses/[date]/route');
    const res = await PUT(makeReq('2026-7-1', { adSpend: 1 }), { params: Promise.resolve({ date: '2026-7-1' }) });
    expect(res.status).toBe(400);
  });

  it('upsert 쿼리에 ON CONFLICT + 값 포함', async () => {
    const { PUT } = await import('@/app/api/settlement/expenses/[date]/route');
    const res = await PUT(
      makeReq('2026-07-16', { adSpend: 85000, boxCost: 120000, boxMemo: '중박스 500개', parcelAdjustment: -5000, memo: '' }),
      { params: Promise.resolve({ date: '2026-07-16' }) },
    );
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(params).toContain(85000);
    expect(params).toContain(120000);
    expect(params).toContain(-5000);
  });
});
