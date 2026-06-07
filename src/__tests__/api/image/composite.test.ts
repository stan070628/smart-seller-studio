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

// sharp mock: vi.fn()으로 캡처해두고 테스트마다 구현을 교체할 수 있도록 한다.
const sharpMock = vi.fn();

vi.mock('sharp', () => ({
  default: sharpMock,
}));

/** 기본 sharp 구현 — 단일 인스턴스로 모든 메서드 체인 지원 */
function makeDefaultSharpInstance() {
  return {
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
  };
}

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/image/composite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });

describe('POST /api/image/composite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks가 구현도 초기화하므로 기본 구현을 복원한다.
    sharpMock.mockImplementation(makeDefaultSharpInstance);
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

  it('제품 이미지를 리사이즈한 뒤 배경에 합성한다', async () => {
    const productResizedBuffer = Buffer.alloc(512, 1);
    const compositeInnerMock = vi.fn().mockReturnThis();

    // 1번째 호출: 제품 리사이즈 인스턴스
    sharpMock.mockImplementationOnce(() => ({
      resize: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(productResizedBuffer),
    }));

    // 2번째 호출: 배경 + 합성 인스턴스
    sharpMock.mockImplementationOnce(() => ({
      resize: vi.fn().mockReturnThis(),
      composite: compositeInnerMock,
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1024, 2)),
    }));

    const { POST } = await import('@/app/api/image/composite/route');
    await POST(makeRequest({
      productImageUrl: 'https://example.com/product.png',
      backgroundImageUrl: 'https://example.com/bg.jpg',
    }));

    expect(compositeInnerMock).toHaveBeenCalledWith([
      expect.objectContaining({ input: productResizedBuffer }),
    ]);
  });

  it('placement: "center" → gravity "centre"로 합성', async () => {
    const compositeInnerMock = vi.fn().mockReturnThis();

    // 1번째 호출: 제품 리사이즈 인스턴스
    sharpMock.mockImplementationOnce(() => ({
      resize: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(512)),
    }));

    // 2번째 호출: 배경 + 합성 인스턴스
    sharpMock.mockImplementationOnce(() => ({
      resize: vi.fn().mockReturnThis(),
      composite: compositeInnerMock,
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
    }));

    const { POST } = await import('@/app/api/image/composite/route');
    await POST(makeRequest({
      productImageUrl: 'https://example.com/product.png',
      backgroundImageUrl: 'https://example.com/bg.jpg',
      placement: 'center',
    }));

    expect(compositeInnerMock).toHaveBeenCalledWith([
      expect.objectContaining({ gravity: 'centre' }),
    ]);
  });

  it('uploadToStorage 실패 → 500', async () => {
    const { uploadToStorage } = await import('@/lib/supabase/server');
    (uploadToStorage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Storage error'));

    const { POST } = await import('@/app/api/image/composite/route');
    const res = await POST(makeRequest({
      productImageUrl: 'https://example.com/product.png',
      backgroundImageUrl: 'https://example.com/bg.jpg',
    }));

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
