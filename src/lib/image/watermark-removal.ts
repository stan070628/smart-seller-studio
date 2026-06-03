import sharp from 'sharp';

// Gemini G 로고 실측 기준: 너비 12%, 높이 8% (우측 하단 고정)
const WATERMARK_WIDTH_RATIO = 0.12;
const WATERMARK_HEIGHT_RATIO = 0.08;
const MIN_HEIGHT_PX = 40;

// 워터마크 감지 임계값: 코너 영역 평균 밝기가 바로 위 영역과 N 이상 차이나면 워터마크로 판단
const BRIGHTNESS_DIFF_THRESHOLD = 30;
// 코너 내부 분산이 위 영역 분산보다 이 값 이상 높으면 혼합 패턴(스파클) 감지
const VARIANCE_DELTA_THRESHOLD = 200;

/**
 * 픽셀 배열의 평균 밝기를 계산합니다.
 */
function calcMean(pixels: Buffer): number {
  if (pixels.length === 0) return 0;
  return pixels.reduce((s, v) => s + v, 0) / pixels.length;
}

/**
 * 픽셀 배열의 분산을 계산합니다.
 */
function calcVariance(pixels: Buffer): number {
  if (pixels.length === 0) return 0;
  const m = calcMean(pixels);
  return pixels.reduce((s, v) => s + (v - m) ** 2, 0) / pixels.length;
}

/**
 * 이미지 우측 하단에 Gemini 워터마크 후보가 있는지 감지합니다.
 * 워터마크 코너 영역을 바로 위 동일 크기 영역과 비교합니다.
 *   - 밝기 차이가 크다 → 밝은 G 로고가 어두운 배경 위에 있음 (또는 반대)
 *   - 분산 차이가 크다 → 코너에 혼합 패턴(스파클) 존재
 */
export async function hasWatermarkCandidate(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || height < MIN_HEIGHT_PX) return false;

    const wmW = Math.floor(width * WATERMARK_WIDTH_RATIO);
    const wmH = Math.floor(height * WATERMARK_HEIGHT_RATIO);
    if (wmW < 1 || wmH < 1) return false;

    const patchTop = height - wmH * 2;
    if (patchTop < 0) return false;

    // 우측 하단 코너 (워터마크 위치)
    const cornerPixels = await sharp(buffer)
      .extract({ left: width - wmW, top: height - wmH, width: wmW, height: wmH })
      .grayscale()
      .raw()
      .toBuffer();

    // 코너 바로 위 (참조 — 워터마크 없는 배경 영역)
    const abovePixels = await sharp(buffer)
      .extract({ left: width - wmW, top: patchTop, width: wmW, height: wmH })
      .grayscale()
      .raw()
      .toBuffer();

    const brightnessDiff = Math.abs(calcMean(cornerPixels) - calcMean(abovePixels));
    const varianceDelta = calcVariance(cornerPixels) - calcVariance(abovePixels);

    return brightnessDiff > BRIGHTNESS_DIFF_THRESHOLD || varianceDelta > VARIANCE_DELTA_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * 이미지 우측 하단의 Gemini 워터마크를 제거합니다.
 * hasWatermarkCandidate()로 먼저 감지한 뒤, 감지된 경우에만 Stability AI를 호출합니다.
 * API 키 미설정, 워터마크 미감지, 호출 실패 시 원본 버퍼를 그대로 반환합니다.
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return buffer;

  const detected = await hasWatermarkCandidate(buffer);
  if (!detected) return buffer;

  try {
    return await inpaintWithStabilityAI(buffer, apiKey);
  } catch (err) {
    console.warn('[removeGeminiWatermark] Stability AI 실패, 원본 반환:', err);
    return buffer;
  }
}

/** Stability AI Stable Image Edit - Erase 엔드포인트로 워터마크 영역 제거 */
async function inpaintWithStabilityAI(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height || height < MIN_HEIGHT_PX) return buffer;

  const wmWidth = Math.floor(width * WATERMARK_WIDTH_RATIO);
  const wmHeight = Math.floor(height * WATERMARK_HEIGHT_RATIO);
  if (wmWidth < 1 || wmHeight < 1) return buffer;

  const wmLeft = width - wmWidth;
  const wmTop = height - wmHeight;

  // 마스크: 전체 검정 배경 + 워터마크 영역 흰색 PNG (white = erase)
  const whiteRectPng = await sharp({
    create: { width: wmWidth, height: wmHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer();

  const maskBuffer = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: whiteRectPng, left: wmLeft, top: wmTop }])
    .png()
    .toBuffer();

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'image.jpg');
  form.append('mask', new Blob([new Uint8Array(maskBuffer)], { type: 'image/png' }), 'mask.png');
  form.append('output_format', 'jpeg');

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(30_000)
      : undefined;

  const res = await fetch('https://api.stability.ai/v2beta/stable-image/edit/erase', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
    },
    body: form,
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stability AI erase 실패 (${res.status}): ${text.slice(0, 120)}`);
  }

  const resultBuffer = Buffer.from(await res.arrayBuffer());
  if (resultBuffer.length === 0) {
    throw new Error('Stability AI erase 응답 바디가 비어 있습니다.');
  }
  return resultBuffer;
}
