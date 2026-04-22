import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@/app/api/ai/keyword-evaluate/route', () => ({
  evaluateKeyword: vi.fn().mockResolvedValue({ pass: true, reasoning: '검색량 대비 경쟁 낮음' }),
}));

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/ai/keyword-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-suggest (evaluate 통합)', () => {
  it('키워드에 pass와 reasoning 필드가 포함된다', async () => {
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    const res = await POST(makeRequest({}));
    const json = await res.json();
    expect(json.success).toBe(true);
    const kw = json.data.keywords[0];
    expect(kw).toHaveProperty('pass');
    expect(kw).toHaveProperty('reasoning');
  });

  it('searchVolume이 있는 키워드는 evaluateKeyword가 호출된다', async () => {
    const { evaluateKeyword } = await import('@/app/api/ai/keyword-evaluate/route');
    vi.mocked(evaluateKeyword).mockClear();
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    await POST(makeRequest({}));
    expect(vi.mocked(evaluateKeyword)).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }),
    );
  });

  it('Naver API 실패 시 pass가 null이다', async () => {
    const { getKeywordStats } = await import('@/lib/naver-ad');
    vi.mocked(getKeywordStats).mockRejectedValueOnce(new Error('Naver down'));
    const { POST } = await import('@/app/api/ai/keyword-suggest/route');
    const res = await POST(makeRequest({}));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.keywords[0].pass).toBeNull();
    expect(json.data.keywords[0].reasoning).toBeNull();
  });
});
