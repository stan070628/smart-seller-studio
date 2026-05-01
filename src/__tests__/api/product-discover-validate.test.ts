import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/sourcing/product-discovery-pipeline', () => ({
  validateKeywords: vi.fn(),
}));

import { POST } from '@/app/api/sourcing/product-discover/validate/route';
import { validateKeywords } from '@/lib/sourcing/product-discovery-pipeline';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/sourcing/product-discover/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAVER_AD_API_KEY = 'test';
    process.env.NAVER_AD_SECRET_KEY = 'test';
    process.env.NAVER_AD_CUSTOMER_ID = 'test';
  });

  it('정상 → 검증 결과 반환', async () => {
    (validateKeywords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { keyword: '펜트리수납함', searchVolume: 6650, competitorCount: 102404, compIdx: '중간', avgCtr: 1.24 },
    ]);
    const res = await POST(makeReq({ keywords: ['펜트리수납함'] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(1);
    expect(json.data.results[0].keyword).toBe('펜트리수납함');
  });

  it('빈 키워드 배열 → 400', async () => {
    const res = await POST(makeReq({ keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('keywords 필드 없음 → 400', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });
});
