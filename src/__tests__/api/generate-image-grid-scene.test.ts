/**
 * generate-image-grid-scene route 단위 테스트
 * Claude/Gemini는 vi.mock으로 대체한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// requireAuth는 항상 통과 처리
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}));

// rate limit은 항상 허용
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('test-key'),
}));

// Claude 클라이언트 mock
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"points":["포인트1","포인트2","포인트3"]}' }],
      }),
    },
  }),
}));

// Gemini 이미지 생성 mock
vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: vi.fn().mockResolvedValue({
    imageBase64: 'base64-bg-image',
    mimeType: 'image/jpeg',
  }),
}));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/generate-image-grid-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-image-grid-scene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('유효한 요청 시 points와 배경 이미지 base64 반환', async () => {
    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.points).toEqual(['포인트1', '포인트2', '포인트3']);
    expect(data.data.imageBase64).toBe('base64-bg-image');
    expect(data.data.mimeType).toBe('image/jpeg');
  });

  it('imageUrls가 빈 배열이면 400 반환', async () => {
    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({ imageUrls: [], title: '제품 특징' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('Claude OCR 실패 시 points=[]로 fallback하고 Gemini는 계속 실행', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: { create: vi.fn().mockRejectedValue(new Error('Claude overloaded')) },
    } as never);

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.points).toEqual([]);
    expect(data.data.imageBase64).toBe('base64-bg-image');
  });

  it('Gemini 실패 시 500 반환', async () => {
    const { generateFrameImage } = await import('@/lib/ai/imagen');
    vi.mocked(generateFrameImage).mockRejectedValueOnce(new Error('Gemini error'));

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('Claude가 JSON이 아닌 텍스트 반환 시 points=[] fallback', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sorry, I cannot help' }] }) },
    } as never);

    const { POST } = await import('@/app/api/ai/generate-image-grid-scene/route');
    const req = makeRequest({
      imageUrls: ['https://example.com/img1.jpg'],
      title: '제품 특징',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(data.data.points).toEqual([]);
  });
});
