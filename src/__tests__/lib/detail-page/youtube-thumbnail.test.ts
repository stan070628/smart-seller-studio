import { describe, it, expect, vi, beforeEach } from 'vitest';

// uploadToStorage 목
vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(async () => ({ url: 'https://cdn.example.com/yt/thumb.jpg' })),
}));

const RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
); // 1x1 png

describe('composeYoutubeThumbnail', () => {
  beforeEach(() => {
    // maxresdefault 성공 응답 목
    global.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => RED.buffer.slice(RED.byteOffset, RED.byteOffset + RED.byteLength),
    })) as unknown as typeof fetch;
  });

  it('videoId로 썸네일을 합성해 업로드하고 호스팅 URL을 반환한다', async () => {
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    const url = await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');
    expect(url).toBe('https://cdn.example.com/yt/thumb.jpg');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('img.youtube.com/vi/dQw4w9WgXcQ/'),
      expect.anything(),
    );
  });

  it('maxres 실패 시 hqdefault로 폴백한다', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (u: string) => {
      calls.push(u);
      const ok = u.includes('hqdefault');
      return { ok, arrayBuffer: async () => RED.buffer.slice(RED.byteOffset, RED.byteOffset + RED.byteLength) };
    }) as unknown as typeof fetch;
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    const url = await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');
    expect(url).toBe('https://cdn.example.com/yt/thumb.jpg');
    expect(calls.some((c) => c.includes('maxresdefault'))).toBe(true);
    expect(calls.some((c) => c.includes('hqdefault'))).toBe(true);
  });
});
