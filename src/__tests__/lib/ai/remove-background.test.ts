/**
 * remove-background.ts 단위 테스트
 * Replicate API는 global fetch mock으로 대체한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { removeImageBackgrounds } from '@/lib/ai/remove-background';

// 1x1 투명 PNG (배경 제거 출력 시뮬레이션용)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const REF = { base64: TINY_PNG_BASE64, mimeType: 'image/jpeg' as const };

describe('removeImageBackgrounds', () => {
  beforeEach(() => {
    vi.stubEnv('REPLICATE_API_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('API 키가 없으면 원본을 반환하고 anyRemoved: false', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', '');
    const result = await removeImageBackgrounds([REF]);
    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });

  it('Replicate API 호출 성공 시 JPEG 변환 + anyRemoved: true', async () => {
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'pred-123', status: 'succeeded', output: 'https://cdn.replicate.com/out.png' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
        } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(true);
    expect(result.refs[0].mimeType).toBe('image/jpeg');
    // 변환 후 base64는 달라야 함
    expect(result.refs[0].base64).not.toBe(TINY_PNG_BASE64);
  });

  it('Replicate API 실패(5xx) 시 원본 ref 반환 (graceful fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });

  it('2장 중 1장 실패 시 성공한 이미지만 변환, anyRemoved: true', async () => {
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');

    vi.stubGlobal(
      'fetch',
      vi.fn()
        // 첫 번째 이미지 — Replicate 호출 실패
        .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
        // 두 번째 이미지 — 성공
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'pred-456', status: 'succeeded', output: 'https://cdn.replicate.com/out.png' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
        } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF, REF]);

    expect(result.anyRemoved).toBe(true);
    expect(result.refs[0]).toEqual(REF);                   // 원본 유지
    expect(result.refs[1].mimeType).toBe('image/jpeg');    // 변환됨
  });

  it('Replicate prediction이 failed 상태로 끝나면 원본 반환', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-789', status: 'failed', error: 'model error' }),
      } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });
});
