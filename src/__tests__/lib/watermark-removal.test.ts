import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { removeGeminiWatermark, hasWatermarkCandidate } from '@/lib/image/watermark-removal';

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

/** 우측 하단에 밝은 G 워터마크 시뮬레이션이 있는 이미지를 생성합니다. */
async function makeWatermarkedImage(width: number, height: number): Promise<Buffer> {
  // 중간 회색 배경 (워터마크와 밝기 대비)
  const base = await makeTestImage({ width, height, bg: { r: 100, g: 100, b: 100 } });
  const wmW = Math.floor(width * 0.12);
  const wmH = Math.floor(height * 0.08);
  const brightPatch = await sharp({
    create: { width: wmW, height: wmH, channels: 3, background: { r: 245, g: 245, b: 245 } },
  }).jpeg().toBuffer();
  return sharp(base)
    .composite([{ input: brightPatch, left: width - wmW, top: height - wmH }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ── 워터마크 자동 감지 ────────────────────────────────────────────────────────

describe('hasWatermarkCandidate', () => {
  it('우측 하단에 밝은 스파클 패턴이 있으면 true를 반환한다', async () => {
    const width = 200, height = 200;

    // 균일한 회색 배경
    const base = await makeTestImage({ width, height, bg: { r: 120, g: 120, b: 120 } });

    // 우측 하단 12%×8% 영역에 밝은 흰 픽셀 군집 합성 (G 워터마크 시뮬레이션)
    const wmW = Math.floor(width * 0.12);  // 24px
    const wmH = Math.floor(height * 0.08); // 16px
    const brightPatch = await sharp({
      create: { width: wmW, height: wmH, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg().toBuffer();

    const withWatermark = await sharp(base)
      .composite([{ input: brightPatch, left: width - wmW, top: height - wmH }])
      .jpeg({ quality: 95 })
      .toBuffer();

    expect(await hasWatermarkCandidate(withWatermark)).toBe(true);
  });

  it('균일한 배경 이미지는 false를 반환한다', async () => {
    const clean = await makeTestImage({ width: 200, height: 200, bg: { r: 255, g: 255, b: 255 } });
    expect(await hasWatermarkCandidate(clean)).toBe(false);
  });

  it('높이 40px 미만 이미지는 false를 반환한다', async () => {
    const tiny = await makeTestImage({ width: 200, height: 30 });
    expect(await hasWatermarkCandidate(tiny)).toBe(false);
  });
});

// ── API 키 없음 — 원본 반환 ───────────────────────────────────────────────────

describe('removeGeminiWatermark — STABILITY_API_KEY 없음', () => {
  beforeEach(() => {
    delete process.env.STABILITY_API_KEY;
  });

  it('API 키 없으면 원본 버퍼를 그대로 반환한다 (이미지 수정 없음)', async () => {
    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);
    expect(result).toBe(input);
  });

  it('높이가 40px 미만인 이미지도 원본 버퍼를 그대로 반환한다', async () => {
    const tinyBuffer = await makeTestImage({ width: 100, height: 30 });
    const result = await removeGeminiWatermark(tinyBuffer);
    expect(result).toBe(tinyBuffer);
  });

  it('손상된 버퍼를 입력해도 예외 없이 원본 버퍼를 반환한다', async () => {
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

  it('Stability AI API가 실패(401)하면 원본 버퍼를 반환한다 (이미지 수정 없음)', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(result).toBe(input);
  });

  it('STABILITY_API_KEY가 없으면 fetch를 전혀 호출하지 않는다', async () => {
    delete process.env.STABILITY_API_KEY;

    const input = await makeTestImage({ width: 200, height: 200 });
    await removeGeminiWatermark(input);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('네트워크 오류(fetch throw)가 발생하면 원본 버퍼를 반환한다 (이미지 수정 없음)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(result).toBe(input);
  });

  it('Stability AI가 빈 응답 바디를 반환하면 원본 버퍼를 반환한다', async () => {
    mockFetch.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));

    const input = await makeTestImage({ width: 200, height: 200 });
    const result = await removeGeminiWatermark(input);

    expect(result).toBe(input);
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
