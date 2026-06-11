// src/__tests__/lib/reference-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('normalized-image')),
  })),
}));

import { loadReferenceImages } from '@/lib/ai/reference-images';

const NORMALIZED = Buffer.from('normalized-image').toString('base64');

describe('loadReferenceImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('referenceImages 3장을 정규화하여 3개 반환한다', async () => {
    const result = await loadReferenceImages({
      referenceImages: [
        { base64: Buffer.from('a').toString('base64') },
        { base64: Buffer.from('b').toString('base64') },
        { base64: Buffer.from('c').toString('base64') },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result[0].mimeType).toBe('image/jpeg');
    expect(result[0].base64).toBe(NORMALIZED);
  });

  it('4장 이상이면 첫 3장만 사용한다', async () => {
    const result = await loadReferenceImages({
      referenceImages: [1, 2, 3, 4].map((n) => ({ base64: Buffer.from(String(n)).toString('base64') })),
    });
    expect(result).toHaveLength(3);
  });

  it('productImageUrls를 fetch하여 정규화한다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    });
    const result = await loadReferenceImages({ productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'] });
    expect(result).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('fetch 실패한 URL은 건너뛴다', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const result = await loadReferenceImages({ productImageUrls: ['https://x/a.jpg'] });
    expect(result).toHaveLength(0);
  });

  it('하위호환: 단일 productImageBase64를 1장으로 처리한다', async () => {
    const result = await loadReferenceImages({ productImageBase64: Buffer.from('x').toString('base64') });
    expect(result).toHaveLength(1);
  });

  it('입력이 전혀 없으면 빈 배열을 반환한다', async () => {
    const result = await loadReferenceImages({});
    expect(result).toHaveLength(0);
  });
});
