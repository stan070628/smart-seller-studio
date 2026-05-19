import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { GET, PUT, DELETE } from '@/app/api/listing/sourcing/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('인증 실패', () => {
  it('requireAuth가 Response를 반환하면 그대로 전달', async () => {
    const { requireAuth } = await import('@/lib/supabase/auth');
    vi.mocked(requireAuth).mockResolvedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=111');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/listing/sourcing', () => {
  it('ids가 없으면 빈 sourcing 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sourcing).toEqual({});
  });

  it('ids 배치 조회 후 map 반환', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { product_id: '111', sourcing_type: 'online', sourcing_value: 'https://1688.com/x' },
        { product_id: '222', sourcing_type: 'offline', sourcing_value: '코스트코' },
      ],
    });
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=111,222');
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.sourcing).toEqual({
      '111': { type: 'online', value: 'https://1688.com/x' },
      '222': { type: 'offline', value: '코스트코' },
    });
  });

  it('DB 오류 시 500 반환', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=111');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/listing/sourcing', () => {
  it('value가 빈 문자열이면 400', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '111', type: 'online', value: '' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('정상 upsert → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '111', type: 'online', value: 'https://1688.com/x' }),
    });
    const res = await PUT(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO product_sourcing'),
      ['coupang', '111', 'online', 'https://1688.com/x', null],
    );
  });

  it('필수 필드 누락 시 400', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', value: 'https://1688.com/x' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('type이 online/offline이 아니면 400을 반환한다', async () => {
    const req = new Request('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '123', type: 'invalid', value: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PUT(req as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it('DB 오류 시 500 반환', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({ platform: 'coupang', productId: '111', type: 'online', value: 'https://1688.com/x' }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(500);
  });

  it('productName을 포함하면 DB에 product_name도 저장한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({
        platform: 'coupang',
        productId: '111',
        type: 'online',
        value: 'https://1688.com/x',
        productName: '캠핑 접이식 의자',
      }),
    });
    const res = await PUT(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('product_name'),
      ['coupang', '111', 'online', 'https://1688.com/x', '캠핑 접이식 의자'],
    );
  });

  it('productName 없어도 정상 저장된다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'PUT',
      body: JSON.stringify({
        platform: 'coupang',
        productId: '222',
        type: 'online',
        value: 'https://domeggook.com/x',
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/listing/sourcing', () => {
  it('정상 삭제 → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'DELETE',
      body: JSON.stringify({ platform: 'coupang', productId: '111' }),
    });
    const res = await DELETE(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM product_sourcing'),
      ['coupang', '111'],
    );
  });

  it('필수 필드 누락 시 400', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'DELETE',
      body: JSON.stringify({ platform: 'coupang' }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('DB 오류 시 500 반환', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const req = new NextRequest('http://localhost/api/listing/sourcing', {
      method: 'DELETE',
      body: JSON.stringify({ platform: 'coupang', productId: '111' }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(500);
  });
});
