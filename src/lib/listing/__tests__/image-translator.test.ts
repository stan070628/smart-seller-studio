// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/listing/gemini-vision-client', () => ({
  extractTextBlocks: vi.fn(),
}));
vi.mock('@/lib/listing/translation-cache', () => ({
  hashImageUrl: (u: string) => 'hash-' + u,
  getCachedTranslation: vi.fn(),
  saveTranslation: vi.fn(),
}));
vi.mock('@/lib/listing/sharp-overlay', () => ({
  composeOverlay: vi.fn(async () => Buffer.from('jpeg-out')),
}));
vi.mock('@/lib/supabase/server', () => {
  const upload = vi.fn(async () => ({ error: null }));
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn/${path}` },
  }));
  const from = vi.fn(() => ({ upload, getPublicUrl }));
  return {
    getSupabaseServerClient: () => ({ storage: { from } }),
    STORAGE_BUCKET: 'test',
  };
});
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: vi.fn(async () => ({
        content: [
          { type: 'text', text: '{"translations":[{"index":0,"ko":"제품"}]}' },
        ],
      })),
    },
  }),
}));

global.fetch = vi.fn(async () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff]).buffer, {
    status: 200,
    headers: { 'content-length': '3' },
  })
) as unknown as typeof fetch;

const visionMod = (await import('@/lib/listing/gemini-vision-client')) as unknown as {
  extractTextBlocks: ReturnType<typeof vi.fn>;
};
const cacheMod = (await import('@/lib/listing/translation-cache')) as unknown as {
  getCachedTranslation: ReturnType<typeof vi.fn>;
  saveTranslation: ReturnType<typeof vi.fn>;
};
const { translateImage } = await import('@/lib/listing/image-translator');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('translateImage', () => {
  it('캐시 히트 시 OCR을 호출하지 않고 캐시된 URL을 반환한다', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce({
      image_url_hash: 'h',
      original_url: 'https://a/x.jpg',
      translated_url: 'https://cdn/cached.jpg',
      status: 'ok',
    });

    const result = await translateImage('https://a/x.jpg');
    expect(result.translatedUrl).toBe('https://cdn/cached.jpg');
    expect(visionMod.extractTextBlocks).not.toHaveBeenCalled();
  });

  it('OCR이 빈 배열이면 status=no_text, translatedUrl=null을 반환', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    visionMod.extractTextBlocks.mockResolvedValueOnce([]);

    const result = await translateImage('https://a/y.jpg');
    expect(result.translatedUrl).toBeNull();
    expect(result.status).toBe('no_text');
    expect(cacheMod.saveTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'no_text', translated_url: null })
    );
  });

  it('OCR + 번역 + 합성 + 업로드 후 translatedUrl을 반환', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    visionMod.extractTextBlocks.mockResolvedValueOnce([
      { text: '产品', bbox: { x: 0, y: 0, w: 50, h: 20 } },
    ]);

    const result = await translateImage('https://a/z.jpg');
    expect(result.status).toBe('ok');
    expect(result.translatedUrl).toMatch(/^https:\/\/cdn\//);
  });

  it('OCR 실패 시 status=failed, translatedUrl=null을 반환 (재시도 1회)', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    visionMod.extractTextBlocks
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));

    const result = await translateImage('https://a/fail.jpg');
    expect(result.status).toBe('failed');
    expect(result.translatedUrl).toBeNull();
    expect(visionMod.extractTextBlocks).toHaveBeenCalledTimes(2);
  });

  it('failed 상태 캐시는 hit하지 않고 다시 시도한다', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce({
      image_url_hash: 'h',
      original_url: 'https://a/retry.jpg',
      translated_url: null,
      status: 'failed',
    });
    visionMod.extractTextBlocks.mockResolvedValueOnce([
      { text: '产品', bbox: { x: 0, y: 0, w: 50, h: 20 } },
    ]);

    const result = await translateImage('https://a/retry.jpg');
    expect(result.status).toBe('ok');
    expect(visionMod.extractTextBlocks).toHaveBeenCalled();
  });

  it('SSRF: 사설 IP 호스트는 즉시 status=failed', async () => {
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    const result = await translateImage('https://192.168.1.1/x.jpg');
    expect(result.status).toBe('failed');
    expect(result.translatedUrl).toBeNull();
    expect(visionMod.extractTextBlocks).not.toHaveBeenCalled();
  });
});
