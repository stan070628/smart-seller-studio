// src/__tests__/api/image/composite.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/composite.jpg' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:composite'),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
  })),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/composite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/composite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(512)),
    });
  });

  it('유효한 URL 2개 → 200 OK와 합성 이미지 URL 반환', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({
      productImageUrl: 'https://example.com/product-transparent.png',
      backgroundImageUrl: 'https://example.com/gemini-background.jpg',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.url).toBe('https://storage.example.com/composite.jpg');
  });

  it('productImageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({ backgroundImageUrl: 'https://example.com/bg.jpg' }));
    expect(res.status).toBe(400);
  });

  it('backgroundImageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({ productImageUrl: 'https://example.com/product.png' }));
    expect(res.status).toBe(400);
  });

  it('이미지 fetch 실패 → 400', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({
      productImageUrl: 'https://example.com/product.png',
      backgroundImageUrl: 'https://example.com/bg.jpg',
    }));
    expect(res.status).toBe(400);
  });
});
