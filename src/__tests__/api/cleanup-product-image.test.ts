import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: { generateContent: (...args: unknown[]) => mockGenerateContent(...args) },
  }),
}));

// fetch mock
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '@/app/api/ai/cleanup-product-image/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/cleanup-product-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const SUPABASE_URL = 'https://abcdef.supabase.co/storage/v1/object/public/images/test.jpg';
const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const MOCK_RESPONSE = {
  candidates: [{
    content: {
      parts: [{ inlineData: { data: MOCK_IMAGE_BASE64, mimeType: 'image/jpeg' } }],
    },
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from(MOCK_IMAGE_BASE64, 'base64').buffer,
    headers: { get: (h: string) => h === 'content-type' ? 'image/jpeg' : null },
  });
  mockGenerateContent.mockResolvedValue(MOCK_RESPONSE);
});

describe('POST /api/ai/cleanup-product-image', () => {
  it('정상 요청 시 imageBase64와 mimeType 반환', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.imageBase64).toBeTruthy();
    expect(json.mimeType).toBe('image/jpeg');
  });

  it('Supabase URL 아닌 외부 URL → 403', async () => {
    const res = await POST(makeRequest({ imageUrl: 'https://evil.com/image.jpg' }));
    expect(res.status).toBe(403);
  });

  it('imageUrl 없으면 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('imageUrl fetch 실패 시 500', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    expect(res.status).toBe(500);
  });

  it('Gemini 응답에 imageData 없으면 500', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'no image' }] } }],
    });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    expect(res.status).toBe(500);
  });

  it('Gemini 호출 실패 시 500', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini error'));
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    expect(res.status).toBe(500);
  });
});
