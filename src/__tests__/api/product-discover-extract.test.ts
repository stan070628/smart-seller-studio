import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));
vi.mock('@/lib/sourcing/ai-keyword-extract', () => ({
  extractKeywordsFromProduct: vi.fn(),
}));

import { POST } from '@/app/api/sourcing/product-discover/extract-keywords/route';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';

const makeReq = (body: unknown) =>
  new NextRequest('http://localhost/api/sourcing/product-discover/extract-keywords', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/sourcing/product-discover/extract-keywords', () => {
  beforeEach(() => vi.clearAllMocks());

  it('정상 → 키워드 배열 반환', async () => {
    (extractKeywordsFromProduct as ReturnType<typeof vi.fn>).mockResolvedValue(['a', 'b', 'c']);
    const res = await POST(makeReq({ productTitle: '16cm 펜트리수납함' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.keywords).toEqual(['a', 'b', 'c']);
  });

  it('AI 실패 → 200 + 빈 배열 (사용자 직접 입력 fallback)', async () => {
    (extractKeywordsFromProduct as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeReq({ productTitle: '아무 상품' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.keywords).toEqual([]);
    expect(json.data.aiFailed).toBe(true);
  });

  it('빈 상품명 → 400', async () => {
    const res = await POST(makeReq({ productTitle: '   ' }));
    expect(res.status).toBe(400);
  });

  it('잘못된 body → 400', async () => {
    const res = await POST(makeReq({ wrong: 'field' }));
    expect(res.status).toBe(400);
  });
});
