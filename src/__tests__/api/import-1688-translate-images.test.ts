// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/listing/image-translator', () => ({
  translateImage: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { translateImage } from '@/lib/listing/image-translator';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockTranslate = translateImage as ReturnType<typeof vi.fn>;

const { POST } = await import('@/app/api/listing/import-1688/translate-images/route');

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/listing/import-1688/translate-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
});

describe('POST /api/listing/import-1688/translate-images', () => {
  it('lifestyle 타입은 번역하지 않고 status=skipped로 응답한다', async () => {
    mockTranslate.mockImplementation(async (url: string) => ({
      originalUrl: url,
      translatedUrl: 'https://cdn/' + url,
      status: 'ok' as const,
    }));

    const res = await POST(
      makeReq({
        images: [
          { url: 'https://a/info.jpg', type: 'infographic' },
          { url: 'https://a/life.jpg', type: 'lifestyle' },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.images).toHaveLength(2);
    const lifestyle = body.images.find(
      (i: { type: string }) => i.type === 'lifestyle'
    );
    expect(lifestyle.translationStatus).toBe('skipped');
    expect(lifestyle.translatedUrl).toBeNull();
    expect(mockTranslate).toHaveBeenCalledTimes(1); // infographic만
  });

  it('한 이미지가 실패해도 다른 이미지는 정상 응답한다', async () => {
    mockTranslate
      .mockResolvedValueOnce({
        originalUrl: 'https://a/1.jpg',
        translatedUrl: 'https://cdn/1.jpg',
        status: 'ok',
      })
      .mockResolvedValueOnce({
        originalUrl: 'https://a/2.jpg',
        translatedUrl: null,
        status: 'failed',
      });

    const res = await POST(
      makeReq({
        images: [
          { url: 'https://a/1.jpg', type: 'infographic' },
          { url: 'https://a/2.jpg', type: 'size_chart' },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.images[0].translatedUrl).toBe('https://cdn/1.jpg');
    expect(body.images[1].translationStatus).toBe('failed');
    expect(body.images[1].translatedUrl).toBeNull();
  });

  it('빈 images 배열은 400을 반환', async () => {
    const res = await POST(makeReq({ images: [] }));
    expect(res.status).toBe(400);
  });

  it('인증 실패 시 401을 반환', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    );
    const res = await POST(
      makeReq({ images: [{ url: 'https://a/1.jpg', type: 'infographic' }] })
    );
    expect(res.status).toBe(401);
  });
});
