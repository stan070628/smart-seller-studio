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

  // pool.query가 mock이라 이 테스트는 "중복이 실제로 제거되는지"를 증명하지 못한다.
  // 중복 제거는 Postgres가 하는 일이므로 여기서 검증할 수 있는 것은 쿼리가 여전히
  // 중복 제거를 요구한다는 사실뿐이다. 조용한 원복을 막는 용도다.
  it('키워드별 최신 1건만 남기도록 DISTINCT ON을 쓴다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET();

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('DISTINCT ON (keyword)');
    // DISTINCT ON은 선행 ORDER BY가 대상 컬럼과 일치해야 하므로 안쪽 정렬이 필수다
    expect(sql).toContain('ORDER BY keyword, created_at DESC');
    // LIMIT은 중복 제거 뒤(바깥 쿼리)에 걸려야 서로 다른 키워드 30개가 나온다
    expect(sql.indexOf('DISTINCT ON (keyword)')).toBeLessThan(sql.indexOf('LIMIT $1'));
  });

  it('DB 오류 시 500과 메시지를 반환한다', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
