import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { POST } from '@/app/api/sourcing/product-discover/confirm/route';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const validBody = {
  productInfo: { source: 'manual', title: '테스트 상품' },
  keywords: [
    { keyword: '키워드1', searchVolume: 5000, competitorCount: 100000, compIdx: '낮음', avgCtr: 1.5, topReviewCount: 20, seedScore: 75, seedGrade: 'A' },
  ],
};

describe('POST /api/sourcing/product-discover/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('새 세션 → INSERT + draftId 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'session-uuid' }] });

    const res = await POST(makeReq(validBody));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.draftId).toBe('session-uuid');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO seed_sessions/);
  });

  it('도매꾹 상품 → sourcing_items UPSERT 추가', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'session-uuid' }] })
      .mockResolvedValueOnce({ rows: [] }); // sourcing_items UPSERT

    const res = await POST(makeReq({
      ...validBody,
      productInfo: { source: 'domeggook', title: '도매꾹 상품', itemNo: 12345 },
    }));
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO sourcing_items/);
  });

  it('빈 키워드 → 400', async () => {
    const res = await POST(makeReq({ ...validBody, keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('productInfo 없음 → 400', async () => {
    const res = await POST(makeReq({ keywords: validBody.keywords }));
    expect(res.status).toBe(400);
  });
});
