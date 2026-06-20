import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

// vi.hoisted로 선언해야 vi.mock 팩토리 내부에서 참조할 수 있다
const { mockQuery, mockGet } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

vi.mock('@/app/api/sourcing/costco/lookup/route', () => ({
  GET: mockGet,
}));

import { POST } from '@/app/api/listing/sourcing/check-costco-stock/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('POST /api/listing/sourcing/check-costco-stock', () => {
  it('인증 실패 시 401 반환', async () => {
    const { requireAuth } = await import('@/lib/supabase/auth');
    vi.mocked(requireAuth).mockResolvedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('sourcingUrl 누락 시 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('코스트코 URL이 아닌 경우 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://detail.1688.com/xxx' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/코스트코/);
  });

  it('상품코드 추출 실패 시 422 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/category' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('lookup 성공 → DB 업데이트 → { status, checkedAt } 반환', async () => {
    mockGet.mockResolvedValueOnce(
      Response.json({ stockStatus: 'inStock', productCode: '1234567' }),
    );
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe('inStock');
    expect(json.checkedAt).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE product_sourcing'),
      expect.arrayContaining(['inStock', 'coupang', '111']),
    );
  });

  it('lookup 404 → DB 업데이트 안 함, 422 반환', async () => {
    mockGet.mockResolvedValueOnce(Response.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 }));
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/9999999' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lookup 5xx → DB 업데이트 안 함, 502 반환', async () => {
    mockGet.mockResolvedValueOnce(Response.json({ error: 'API 조회 실패' }, { status: 500 }));
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
