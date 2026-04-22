import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/naver/keyword-stats/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/naver-ad', () => ({
  getKeywordStats: vi.fn().mockResolvedValue([
    { keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 },
    { keyword: '미니 선풍기', searchVolume: 3000, competitorCount: 980 },
  ]),
}));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/naver/keyword-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/naver/keyword-stats', () => {
  it('keywords 배열을 받아 stats를 반환한다', async () => {
    const req = makeRequest({ keywords: ['방수 백팩', '미니 선풍기'] });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.stats).toHaveLength(2);
    expect(json.data.stats[0].keyword).toBe('방수 백팩');
    expect(json.data.stats[0].searchVolume).toBe(11700);
    expect(json.data.stats[0].competitorCount).toBe(312);
  });

  it('keywords가 없으면 400을 반환한다', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('keywords가 빈 배열이면 400을 반환한다', async () => {
    const req = makeRequest({ keywords: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('keywords가 50개를 초과하면 400을 반환한다', async () => {
    const req = makeRequest({ keywords: Array(51).fill('test') });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
