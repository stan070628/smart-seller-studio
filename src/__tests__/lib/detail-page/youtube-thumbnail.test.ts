import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadToStorage } from '@/lib/supabase/server';

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
    // 폴백 순서: maxresdefault를 먼저 시도하고, 그 다음 hqdefault를 시도해야 한다.
    expect(calls[0]).toContain('maxresdefault');
    expect(calls[1]).toContain('hqdefault');
  });

  it('maxres, hqdefault 모두 실패하면 에러를 던진다', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      arrayBuffer: async () => RED.buffer.slice(RED.byteOffset, RED.byteOffset + RED.byteLength),
    })) as unknown as typeof fetch;
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    await expect(composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal')).rejects.toThrow();
  });

  it('같은 videoId로 두 번 호출해도 저장 경로가 겹치지 않는다', async () => {
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');
    await composeYoutubeThumbnail('dQw4w9WgXcQ', 'horizontal');

    const mockedUpload = vi.mocked(uploadToStorage);
    const paths = mockedUpload.mock.calls.map((call) => call[0]);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const [firstPath, secondPath] = paths.slice(-2);
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath).toMatch(/^ai-detail\/youtube\/dQw4w9WgXcQ-.+\.jpg$/);
    expect(secondPath).toMatch(/^ai-detail\/youtube\/dQw4w9WgXcQ-.+\.jpg$/);
  });

  it('유효하지 않은 videoId는 에러를 던진다', async () => {
    const { composeYoutubeThumbnail } = await import('@/lib/detail-page/youtube-thumbnail');
    await expect(composeYoutubeThumbnail('bad/../id', 'horizontal')).rejects.toThrow();
  });
});
