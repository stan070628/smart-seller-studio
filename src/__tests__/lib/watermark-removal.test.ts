import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { removeGeminiWatermark } from '@/lib/image/watermark-removal';

async function makeTestImage(options: {
  width: number;
  height: number;
  bg?: { r: number; g: number; b: number };
}): Promise<Buffer> {
  const { width, height, bg = { r: 255, g: 255, b: 255 } } = options;
  return sharp({
    create: { width, height, channels: 3, background: bg },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ── Sharp fallback 경로 (API 키 없음) ────────────────────────────────────────

describe('removeGeminiWatermark — Sharp fallback (STABILITY_API_KEY 없음)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs(); // API 키 없는 상태 보장
  });

  it('우측 하단 워터마크 영역이 위 영역 픽셀로 덮어씌워진다', async () => {
    const width = 100;
    const height = 100;
    const wmWidth = Math.floor(width * 0.28);  // 28px
    const wmHeight = Math.floor(height * 0.05); // 5px (커버 영역 7% 안에 포함됨)

    const whiteBg = await makeTestImage({ width, height });
    const blackPatch = await sharp({
      create: { width: wmWidth, height: wmHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const withWatermark = await sharp(whiteBg)
      .composite([{ input: blackPatch, left: width - wmWidth, top: height - wmHeight }])
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await removeGeminiWatermark(withWatermark);

    const { data } = await sharp(result)
      .extract({ left: width - 10, top: height - 3, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 원본 흰 이미지(255) 근처여야 함 — JPEG 압축 손실 감안해 > 180
    expect(data[0]).toBeGreaterThan(180);
  });

  it('높이가 40px 미만인 이미지는 원본 버퍼를 그대로 반환한다', async () => {
    const tinyBuffer = await makeTestImage({ width: 100, height: 30 });
    const result = await removeGeminiWatermark(tinyBuffer);
    expect(result).toBe(tinyBuffer);
  });

  it('손상된 버퍼를 입력하면 예외 없이 원본 버퍼를 반환한다', async () => {
    const invalidBuffer = Buffer.from('not-an-image-at-all');
    const result = await removeGeminiWatermark(invalidBuffer);
    expect(result).toBe(invalidBuffer);
  });
});

// ── Stability AI 인페인팅 경로 ────────────────────────────────────────────────

describe('removeGeminiWatermark — Stability AI 인페인팅 경로', () => {
  const FAKE_API_KEY = 'test-stability-key-xyz';
  const FAKE_RESULT = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const mockFetch = vi.fn();

  beforeEach(() => {
    process.env.STABILITY_API_KEY = FAKE_API_KEY;
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    delete process.env.STABILITY_API_KEY;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('STABILITY_API_KEY가 설정되면 Stability AI API를 호출하고 결과를 반환한다', async () => {
    mockFetch.mockResolvedValue(new Response(FAKE_RESULT, { status: 200 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('stability.ai');
    expect(Buffer.compare(result, FAKE_RESULT)).toBe(0);
  });

  it('Stability AI API가 실패(401)하면 Sharp fallback으로 버퍼를 반환한다', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(result).toBeInstanceOf(Buffer);
  });

  it('STABILITY_API_KEY가 없으면 fetch를 전혀 호출하지 않는다', async () => {
    delete process.env.STABILITY_API_KEY;

    const input = await makeTestImage({ width: 200, height: 200 });
    await removeGeminiWatermark(input);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('네트워크 오류(fetch throw)가 발생해도 Sharp fallback으로 유효한 버퍼를 반환한다', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('Stability AI가 빈 응답 바디를 반환하면 Sharp fallback으로 유효한 이미지를 반환한다', async () => {
    mockFetch.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    // 빈 버퍼(length 0)가 아닌 유효한 이미지여야 한다
    expect(result.length).toBeGreaterThan(100);
  });

  it('Stability AI 요청에 Bearer 형식의 Authorization 헤더가 포함된다', async () => {
    mockFetch.mockResolvedValue(new Response(FAKE_RESULT, { status: 200 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    await removeGeminiWatermark(input);

    const [, requestInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);
  });
});
