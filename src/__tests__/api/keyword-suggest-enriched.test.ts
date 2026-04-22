import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/ai/keyword-suggest/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              keywords: [
                { keyword: '방수 백팩', reason: '수요 안정적' },
                { keyword: '미니 선풍기', reason: '여름 수요' },
              ],
            }),
          },
        ],
      }),
    },
  }),
}));

vi.mock('@/lib/naver-ad', () => ({
  getKeywordStats: vi.fn().mockResolvedValue([
    { keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 },
    { keyword: '미니 선풍기', searchVolume: 42000, competitorCount: 1204 },
  ]),
}));

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/ai/keyword-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-suggest (enriched)', () => {
  it('키워드에 searchVolume과 competitorCount가 포함된다', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    const kw = json.data.keywords[0];
    expect(kw).toHaveProperty('searchVolume');
    expect(kw).toHaveProperty('competitorCount');
    expect(kw.keyword).toBe('방수 백팩');
    expect(kw.searchVolume).toBe(11700);
    expect(kw.competitorCount).toBe(312);
  });

  it('Naver API 실패 시 searchVolume/competitorCount가 null이어도 키워드를 반환한다', async () => {
    const { getKeywordStats } = await import('@/lib/naver-ad');
    vi.mocked(getKeywordStats).mockRejectedValueOnce(new Error('Naver API down'));

    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keywords).toHaveLength(2);
    expect(json.data.keywords[0].searchVolume).toBeNull();
    expect(json.data.keywords[0].competitorCount).toBeNull();
  });
});
