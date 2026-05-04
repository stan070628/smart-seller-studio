// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('sharp', () => {
  const sharpInstance = {
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-base-image')),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => sharpInstance) };
});

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(),
}));

import { uploadToStorage } from '@/lib/supabase/server';
const mockUpload = uploadToStorage as ReturnType<typeof vi.fn>;

const VALID_URL = 'https://cdn.example.com/product.jpg';
const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('generateAndUploadThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('1024') },
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
    } as unknown as Response);
    mockUpload.mockResolvedValue({ url: 'https://storage.example.com/thumb.jpg' });
  });

  it('성공 시 Supabase URL을 반환한다', async () => {
    const { generateAndUploadThumbnail } = await import('@/lib/listing/import-1688-thumbnail');
    const url = await generateAndUploadThumbnail(VALID_URL, '테스트 상품', SESSION_ID);
    expect(url).toBe('https://storage.example.com/thumb.jpg');
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringContaining(`1688-import/${SESSION_ID}`),
      expect.anything(),
      'image/jpeg',
      expect.any(Number)
    );
  });

  it('fetch 실패(non-ok) 시 Error를 throw한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as Response);
    const { generateAndUploadThumbnail } = await import('@/lib/listing/import-1688-thumbnail');
    await expect(generateAndUploadThumbnail(VALID_URL, '상품', SESSION_ID)).rejects.toThrow('이미지 다운로드 실패');
  });

  it('http:// URL은 SSRF 방어로 Error를 throw한다', async () => {
    const { generateAndUploadThumbnail } = await import('@/lib/listing/import-1688-thumbnail');
    await expect(
      generateAndUploadThumbnail('http://cdn.example.com/1.jpg', '상품', SESSION_ID)
    ).rejects.toThrow('https');
  });

  it('uploadToStorage 실패 시 Error를 전파한다', async () => {
    mockUpload.mockRejectedValue(new Error('Storage 오류'));
    const { generateAndUploadThumbnail } = await import('@/lib/listing/import-1688-thumbnail');
    await expect(generateAndUploadThumbnail(VALID_URL, '상품', SESSION_ID)).rejects.toThrow('Storage 오류');
  });
});
