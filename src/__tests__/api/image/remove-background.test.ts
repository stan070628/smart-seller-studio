// src/__tests__/api/image/remove-background.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/bg-removed.png' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:remove-background'),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/remove-background', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/remove-background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STABILITY_API_KEY = 'test-stability-key';
  });

  it('유효한 imageUrl → 200 OK와 transparentImageUrl 반환', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)) });

    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.transparentImageUrl).toBe('https://storage.example.com/bg-removed.png');
  });

  it('imageUrl 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('STABILITY_API_KEY 없음 → 500', async () => {
    vi.resetModules();
    delete process.env.STABILITY_API_KEY;
    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    expect(res.status).toBe(500);
  });

  it('Stability AI 실패 → 502', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error') });

    const { POST } = await import('@/app/api/image/remove-background/route');
    const res = await POST(makeRequest({ imageUrl: 'https://example.com/product.jpg' }));
    expect(res.status).toBe(502);
  });
});
