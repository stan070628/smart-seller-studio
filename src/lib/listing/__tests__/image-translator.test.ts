// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/listing/google-vision-client', () => ({
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
vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(async (path: string) => ({
    url: `https://cdn/${path}`,
    path,
    size: 1,
  })),
  STORAGE_BUCKET: 'test',
}));
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

const visionMod = (await import('@/lib/listing/google-vision-client')) as unknown as {
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
});
