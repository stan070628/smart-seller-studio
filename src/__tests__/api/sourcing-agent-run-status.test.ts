import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'u1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: mockQuery }) }));

import { GET } from '@/app/api/sourcing/agent/run/status/route';

const url = (qs: string) => new Request(`http://localhost/api/sourcing/agent/run/status?${qs}`);

describe('GET /api/sourcing/agent/run/status', () => {
  beforeEach(() => mockQuery.mockReset());

  it('요청한 id의 상태와 결과를 반환한다', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 12, keyword: '등산 스틱', status: 'done', error_message: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ request_id: 12, domeggook_product_name: '경량 등산스틱', domeggook_price: 12800 }],
      });

    const res = await GET(url('ids=12'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0].status).toBe('done');
    expect(body.data.runs[0].results).toHaveLength(1);
  });

  it('ids가 없으면 400이다', async () => {
    const res = await GET(url(''));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('숫자가 아닌 id는 걸러낸다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await GET(url('ids=12,abc,13'));
    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual([12, 13]);
  });

  it('id가 전부 비정상이면 400이다', async () => {
    const res = await GET(url('ids=abc,def'));
    expect(res.status).toBe(400);
  });
});
