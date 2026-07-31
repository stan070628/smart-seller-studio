import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { GET } from '@/app/api/sourcing/seeds/route';

describe('GET /api/sourcing/seeds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('시드 목록과 마지막 수집 시각을 함께 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, keyword: '등산 모자', source: 'youtube', reason: '가을 등산 증가', seed_date: '2026-07-31', created_at: '2026-07-31T06:00:00Z' },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.seeds).toHaveLength(1);
    expect(body.data.seeds[0].keyword).toBe('등산 모자');
    expect(body.data.lastCollectedAt).toBe('2026-07-31T06:00:00Z');
  });

  it('시드가 없으면 lastCollectedAt이 null이다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET();
    const body = await res.json();

    expect(body.data.seeds).toHaveLength(0);
    expect(body.data.lastCollectedAt).toBeNull();
  });

  it('DB 오류 시 500과 메시지를 반환한다', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
