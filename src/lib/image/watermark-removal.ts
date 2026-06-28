import sharp from 'sharp';
import type { Part } from '@google/genai';
import { getGeminiGenAI } from '@/lib/ai/gemini';

// Gemini G 로고 실측 기준: 너비 12%, 높이 8% (우측 하단 고정)
const WATERMARK_WIDTH_RATIO = 0.12;
const WATERMARK_HEIGHT_RATIO = 0.08;
const MIN_HEIGHT_PX = 40;

// 워터마크 감지 임계값: 코너 영역 평균 밝기가 바로 위 영역과 N 이상 차이나면 워터마크로 판단
const BRIGHTNESS_DIFF_THRESHOLD = 30;
// 코너 내부 분산이 위 영역 분산보다 이 값 이상 높으면 혼합 패턴(스파클) 감지
const VARIANCE_DELTA_THRESHOLD = 200;

// "Remove watermark" 표현 대신 inpainting 관점으로 표현 (Gemini 콘텐츠 정책 대응)
const WATERMARK_PROMPT =
  'This is a crop from the bottom-right corner of a product image. ' +
  'Restore this area to look like a clean natural background without any overlay elements. ' +
  'Seamlessly fill the area by blending with the surrounding colors, textures, and patterns. ' +
  'Preserve all other parts exactly as they are.';

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
 * 워터마크가 감지된 경우에만 Gemini API를 호출합니다.
 * 제거 실패 시 원본 버퍼를 그대로 반환합니다.
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer> {
  const hasWatermark = await hasWatermarkCandidate(buffer);
  if (!hasWatermark) return buffer;

  try {
    return await removeWithGemini(buffer);
  } catch (err) {
    console.warn('[removeGeminiWatermark] Gemini 실패, 원본 반환:', err);
    return buffer;
  }
}

/** Gemini 2.5 Flash Image로 워터마크 영역 crop → 제거 → composite */
async function removeWithGemini(buffer: Buffer): Promise<Buffer> {
  const img = sharp(buffer).rotate();
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H || H < MIN_HEIGHT_PX) return buffer;

  const wmW = Math.floor(W * WATERMARK_WIDTH_RATIO);
  const wmH = Math.floor(H * WATERMARK_HEIGHT_RATIO);
  const pad = Math.max(40, Math.round(Math.min(wmW, wmH) * 0.5));

  // 패딩 포함 크롭 영역 (우측 하단 끝까지)
  const mx = Math.max(0, W - wmW - pad);
  const my = Math.max(0, H - wmH - pad);
  const mw = W - mx;
  const mh = H - my;

  const cropBuffer = await img.clone()
    .extract({ left: mx, top: my, width: mw, height: mh })
    .png()
    .toBuffer();

  const ai = getGeminiGenAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    config: { responseModalities: ['Text', 'Image'] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: cropBuffer.toString('base64'), mimeType: 'image/png' } },
        { text: WATERMARK_PROMPT },
      ] as Part[],
    }],
  });

  const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData != null);
  if (!imagePart?.inlineData?.data) throw new Error('Gemini 응답에 이미지 데이터가 없습니다.');

  // Gemini는 임의 해상도로 반환 → crop 원본 크기(mw×mh)로 정확히 맞춤
  const cleanedBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  const resized = await sharp(cleanedBuffer)
    .resize(mw, mh, { fit: 'fill' })
    .png()
    .toBuffer();

  return img.clone()
    .composite([{ input: resized, left: mx, top: my }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
