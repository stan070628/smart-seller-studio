import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/sourcing/trend-discovery', () => ({
  discoverTrendSeeds: vi.fn(),
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }),
}));

import { GET } from '@/app/api/sourcing/cron/trend-seeds/route';
import { discoverTrendSeeds } from '@/lib/sourcing/trend-discovery';
import { getSourcingPool } from '@/lib/sourcing/db';

function makeRequest(token: string) {
  return new NextRequest('http://localhost/api/sourcing/cron/trend-seeds', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /api/sourcing/cron/trend-seeds', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.clearAllMocks();
    // reset pool mock
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rowCount: 1 });
  });

  it('올바른 토큰으로 씨드를 저장하고 200 반환', async () => {
    (discoverTrendSeeds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '캠핑의자', source: 'youtube', reason: '트렌드' },
    ]);

    const res = await GET(makeRequest('test-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.saved).toBe(1);
  });

  it('잘못된 토큰이면 401 반환', async () => {
    const res = await GET(makeRequest('wrong-token'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 없으면 500 반환', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeRequest('any'));
    expect(res.status).toBe(500);
  });

  it('씨드 없으면 saved=0', async () => {
    (discoverTrendSeeds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();
    expect(body.data.saved).toBe(0);
  });
});
