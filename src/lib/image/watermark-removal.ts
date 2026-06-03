import sharp from 'sharp';

const WATERMARK_WIDTH_RATIO = 0.28;
const WATERMARK_HEIGHT_RATIO = 0.07;
const MIN_HEIGHT_PX = 40;
const BLUR_SIGMA = 3;

/**
 * 이미지 우측 하단의 Gemini 워터마크를 제거합니다.
 * STABILITY_API_KEY 환경변수가 설정된 경우 AI 인페인팅을 사용하고,
 * 없거나 실패하면 Sharp 패치 복사 방식으로 fallback합니다.
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (apiKey) {
    try {
      return await inpaintWithStabilityAI(buffer, apiKey);
    } catch (err) {
      console.warn('[removeGeminiWatermark] Stability AI 실패, Sharp fallback:', err);
    }
  }
  return patchWatermarkWithSharp(buffer);
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

/** Sharp 패치 복사 방식 (API 키 없을 때 fallback) */
async function patchWatermarkWithSharp(buffer: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height || height < MIN_HEIGHT_PX) return buffer;

    const wmWidth = Math.floor(width * WATERMARK_WIDTH_RATIO);
    const wmHeight = Math.floor(height * WATERMARK_HEIGHT_RATIO);
    if (wmWidth < 1 || wmHeight < 1) return buffer;

    const wmLeft = width - wmWidth;
    const wmTop = height - wmHeight;
    const patchTop = wmTop - wmHeight;
    if (patchTop < 0) return buffer;

    const patchBuffer = await sharp(buffer)
      .extract({ left: wmLeft, top: patchTop, width: wmWidth, height: wmHeight })
      .blur(BLUR_SIGMA)
      .toBuffer();

    return sharp(buffer)
      .composite([{ input: patchBuffer, left: wmLeft, top: wmTop }])
      .toBuffer();
  } catch (err) {
    console.warn('[removeGeminiWatermark] Sharp 처리 실패, 원본 반환:', err);
    return buffer;
  }
}
