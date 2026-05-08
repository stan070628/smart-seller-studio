// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn();
  const from = vi.fn(() => ({ select, upsert }));
  return {
    getSupabaseServerClient: () => ({ from }),
    __mocks: { single, upsert, from, select, eq },
  };
});

const mod = (await import('@/lib/supabase/server')) as unknown as {
  __mocks: {
    single: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};
const { hashImageUrl, getCachedTranslation, saveTranslation } = await import(
  '@/lib/listing/translation-cache'
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashImageUrl', () => {
  it('동일 URL은 동일 해시를 반환한다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).toBe(hashImageUrl('https://a.com/x.jpg'));
  });

  it('다른 URL은 다른 해시를 반환한다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).not.toBe(hashImageUrl('https://a.com/y.jpg'));
  });

  it('해시는 64자 hex 문자열이다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getCachedTranslation', () => {
  it('캐시 히트 시 row를 반환한다', async () => {
    mod.__mocks.single.mockResolvedValueOnce({
      data: {
        image_url_hash: 'abc',
        translated_url: 'https://cdn/x.jpg',
        status: 'ok',
      },
      error: null,
    });
    const row = await getCachedTranslation('https://a.com/x.jpg');
    expect(row?.translated_url).toBe('https://cdn/x.jpg');
  });

  it('캐시 미스 시 null을 반환한다', async () => {
    mod.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116' },
    });
    const row = await getCachedTranslation('https://a.com/y.jpg');
    expect(row).toBeNull();
  });
});

describe('saveTranslation', () => {
  it('upsert 호출 시 image_url_hash를 키로 사용한다', async () => {
    mod.__mocks.upsert.mockResolvedValueOnce({ error: null });
    await saveTranslation({
      original_url: 'https://a.com/x.jpg',
      translated_url: 'https://cdn/x.jpg',
      ocr_blocks: [],
      status: 'ok',
    });
    expect(mod.__mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', original_url: 'https://a.com/x.jpg' }),
      expect.objectContaining({ onConflict: 'image_url_hash' })
    );
  });
});
