import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCoupangThumbnail, editThumbnail } from '@/lib/detail-page/thumbnail-flow';

function mockFetchSequence(responses: Array<{ ok?: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ ok: r.ok ?? true, json: () => Promise.resolve(r.json) });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('generateCoupangThumbnail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generate → upload → coupang-resize 순서로 호출하고 최종 URL을 반환한다', async () => {
    const fn = mockFetchSequence([
      { json: { success: true, data: { imageBase64: 'B64', mimeType: 'image/png' } } },
      { json: { success: true, url: 'https://x/temp.jpg' } },
      { json: { url: 'https://x/coupang-resized/final.jpg' } },
    ]);
    const url = await generateCoupangThumbnail(['https://x/a.jpg'], '화이트 배경 스튜디오');
    expect(url).toBe('https://x/coupang-resized/final.jpg');
    expect(fn).toHaveBeenNthCalledWith(1, '/api/ai/generate-thumbnail', expect.anything());
    expect(fn).toHaveBeenNthCalledWith(2, '/api/image/upload-ai', expect.anything());
    expect(fn).toHaveBeenNthCalledWith(3, '/api/image/coupang-resize', expect.anything());
  });

  it('coupang-resize 실패 시 업로드 URL로 폴백한다', async () => {
    mockFetchSequence([
      { json: { success: true, data: { imageBase64: 'B64', mimeType: 'image/png' } } },
      { json: { success: true, url: 'https://x/temp.jpg' } },
      { ok: false, json: { error: 'resize 실패' } },
    ]);
    const url = await generateCoupangThumbnail(['https://x/a.jpg'], '화이트 배경 스튜디오');
    expect(url).toBe('https://x/temp.jpg');
  });

  it('generate 실패 시 에러를 던진다', async () => {
    mockFetchSequence([{ ok: false, json: { success: false, error: '생성 실패' } }]);
    await expect(generateCoupangThumbnail(['https://x/a.jpg'], '방향')).rejects.toThrow('생성 실패');
  });
});

describe('editThumbnail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edit-thumbnail을 호출하고 editedUrl을 반환한다', async () => {
    const fn = mockFetchSequence([
      { json: { success: true, data: { editedUrl: 'https://x/edited.jpg' } } },
    ]);
    const url = await editThumbnail('https://x/orig.jpg', '배경을 더 밝게');
    expect(url).toBe('https://x/edited.jpg');
    expect(fn).toHaveBeenCalledWith('/api/ai/edit-thumbnail', expect.anything());
  });

  it('실패 시 에러를 던진다', async () => {
    mockFetchSequence([{ ok: false, json: { success: false, error: '수정 실패' } }]);
    await expect(editThumbnail('https://x/orig.jpg', 'p')).rejects.toThrow('수정 실패');
  });
});
