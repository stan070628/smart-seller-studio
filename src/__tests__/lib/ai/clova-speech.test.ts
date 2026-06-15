import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from '@/lib/ai/clova-speech';

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('환경변수 미설정 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', '');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', '');
    const audio = new ArrayBuffer(5);
    await expect(transcribeAudio(audio)).rejects.toThrow('환경변수');
  });

  it('API 성공 응답에서 텍스트 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: '안녕하세요 테스트입니다' }),
    } as Response);

    const audio = new ArrayBuffer(5);
    const result = await transcribeAudio(audio);
    expect(result).toBe('안녕하세요 테스트입니다');
  });

  it('API 오류 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400 } as Response);

    const audio = new ArrayBuffer(5);
    await expect(transcribeAudio(audio)).rejects.toThrow('CLOVA Speech API 오류: 400');
  });
});
