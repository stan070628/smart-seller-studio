// src/__tests__/api/image/analyze-detail-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn(),
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn().mockResolvedValue({ url: 'https://storage.example.com/cropped.jpg' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 }),
  getRateLimitKey: vi.fn().mockReturnValue('test-ip:analyze-detail-images'),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg' }),
    extract: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-cropped-image')),
  })),
}));

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/analyze-detail-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/analyze-detail-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(500)),
    });
  });

  it('개별 이미지 1장 → 4개 섹션 crops 반환 (섹션 재사용)', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: 'text', text: 'hero' }],
    });

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/product.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.crops).toHaveLength(4);
    expect(data.crops.map((c: { sectionType: string }) => c.sectionType)).toEqual(['hero', 'lifestyle', 'detail', 'feature']);
  });

  it('긴 이미지 (height > 2.5× width) → Claude Vision cropBox 제안 사용', async () => {
    const sharpMock = await import('sharp');
    (sharpMock.default as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      metadata: vi.fn().mockResolvedValue({ width: 400, height: 2000, format: 'jpeg' }),
      extract: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake')),
    }));

    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          crops: [
            { sectionType: 'hero', cropBox: { x: 0, y: 0, width: 1, height: 0.25 } },
            { sectionType: 'lifestyle', cropBox: { x: 0, y: 0.25, width: 1, height: 0.25 } },
          ],
        }),
      }],
    });

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/long.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.crops).toHaveLength(4);
    expect(data.crops.some((c: { cropBox?: unknown }) => c.cropBox !== undefined)).toBe(true);
  });

  it('imageUrls 누락 → 400', async () => {
    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('Claude Vision 실패 → 폴백으로 4개 섹션 반환', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    (getAnthropicClient().messages.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Claude 오류'));

    const { POST } = await import('@/app/api/image/analyze-detail-images/route');
    const res = await POST(makeRequest({ imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.crops).toHaveLength(4);
  });
});
