import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
  RATE_LIMITS: { AI_API: {} },
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn().mockReturnValue({
    query: vi.fn(),
  }),
}));

vi.mock('@/lib/naver-ad', () => ({
  expandKeywords: vi.fn(),
}));

vi.mock('@/app/api/ai/keyword-evaluate/route', () => ({
  evaluateKeyword: vi.fn(),
}));

import { POST } from '@/app/api/ai/keyword-discover/route';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expandKeywords } from '@/lib/naver-ad';
import { evaluateKeyword } from '@/app/api/ai/keyword-evaluate/route';

function makeRequest() {
  return new NextRequest('http://localhost/api/ai/keyword-discover', { method: 'POST' });
}

describe('POST /api/ai/keyword-discover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('씨드 → 확장 → 필터 → AI 평가 후 200 반환', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ keyword: '캠핑의자' }],
    });

    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '캠핑의자', searchVolume: 5000, competitorCount: 200 },
      // 검색량 2000 미만 → 필터 제외
      { keyword: '초저인기', searchVolume: 500, competitorCount: 100 },
      // competitorCount가 MAX_COMPETITOR_COUNT(5,000,000) 이상 → 필터 제외
      { keyword: '포화시장', searchVolume: 10000, competitorCount: 5_000_000 },
    ]);

    (evaluateKeyword as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      pass: true,
      reasoning: '진입 가능',
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.keywords).toHaveLength(1);
    expect(body.data.keywords[0].keyword).toBe('캠핑의자');
    expect(body.data.keywords[0].pass).toBe(true);
  });

  it('씨드 없으면 폴백 씨드 사용', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await POST(makeRequest());
    expect(expandKeywords).toHaveBeenCalledWith(
      expect.arrayContaining(['주방용품']),
    );
  });

  it('필터 조건 — 검색량 2000 미만은 제외', async () => {
    const pool = getSourcingPool();
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ keyword: 'test' }],
    });
    (expandKeywords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { keyword: '저검색', searchVolume: 1999, competitorCount: 100 },
    ]);

    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.data.keywords).toHaveLength(0);
    expect(evaluateKeyword).not.toHaveBeenCalled();
  });
});
