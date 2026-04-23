import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: 0 }),
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
            text: JSON.stringify({ pass: true, reasoning: '검색량 대비 경쟁이 낮아 신규 진입에 적합합니다.' }),
          },
        ],
      }),
    },
  }),
}));

async function getPost() {
  const mod = await import('@/app/api/ai/keyword-evaluate/route');
  return mod.POST;
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/keyword-evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/keyword-evaluate', () => {
  it('pass와 reasoning을 반환한다', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pass).toBe(true);
    expect(typeof json.data.reasoning).toBe('string');
    expect(json.data.reasoning.length).toBeGreaterThan(0);
  });

  it('topReviewCount 없어도 평가한다', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '캠핑 의자', searchVolume: 5000, competitorCount: 200 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty('pass');
  });

  it('searchVolume 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', competitorCount: 312 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('competitorCount 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700 }));
    expect(res.status).toBe(400);
  });

  it('keyword 없으면 400 반환', async () => {
    const POST = await getPost();
    const res = await POST(makeRequest({ searchVolume: 11700, competitorCount: 312 }));
    expect(res.status).toBe(400);
  });

  it('Claude API 오류 시 pass: null, reasoning: null을 200으로 반환한다', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: {
        create: vi.fn().mockRejectedValueOnce(new Error('API down')),
      },
    } as unknown as ReturnType<typeof getAnthropicClient>);

    const POST = await getPost();
    const res = await POST(makeRequest({ keyword: '방수 백팩', searchVolume: 11700, competitorCount: 312 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pass).toBeNull();
    expect(json.data.reasoning).toBeNull();
  });

  it('evaluateKeyword 헬퍼가 export된다', async () => {
    const mod = await import('@/app/api/ai/keyword-evaluate/route');
    expect(typeof mod.evaluateKeyword).toBe('function');
  });
});
