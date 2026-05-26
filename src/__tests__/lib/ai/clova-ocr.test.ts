import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractTextFromImage } from '@/lib/ai/clova-ocr';

describe('extractTextFromImage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('환경변수 미설정 시 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', '');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', '');
    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual([]);
  });

  it('SUCCESS 응답에서 고신뢰 텍스트만 추출', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          images: [
            {
              inferResult: 'SUCCESS',
              fields: [
                { inferText: '500ml', inferConfidence: 0.99 },
                { inferText: 'BPA-FREE', inferConfidence: 0.95 },
                { inferText: '', inferConfidence: 0.99 },      // 빈 텍스트 — 제거 대상
                { inferText: '저신뢰', inferConfidence: 0.5 }, // 0.7 미만 — 제거 대상
              ],
            },
          ],
        }),
    } as Response);

    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual(['500ml', 'BPA-FREE']);
  });

  it('inferResult가 EMPTY면 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ images: [{ inferResult: 'EMPTY' }] }),
    } as Response);

    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual([]);
  });

  it('API 오류 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(extractTextFromImage('base64data', 'image/jpeg')).rejects.toThrow(
      'CLOVA OCR API 오류: 500'
    );
  });
});
