import sharp from 'sharp';

const CANVAS_SIZE = 1200;
const FILL_RATIO = 0.92;
const TRIM_THRESHOLD = 12;

/**
 * 쿠팡 정책을 강제하는 결정적 후처리:
 * 1) 흰 배경 trim → 상품 윤곽 추출
 * 2) 1200×1200 흰 캔버스 중앙에 92% 크기로 재배치
 * 3) JPEG q92 인코딩
 *
 * trim 실패 시(배경이 흰색이 아닌 경우) 원본 buffer 그대로 반환.
 */
export async function enforceCoupangPolicy(
  inputBuffer: Buffer,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const trimmed = await sharp(inputBuffer)
      .trim({
        background: { r: 255, g: 255, b: 255 },
        threshold: TRIM_THRESHOLD,
      })
      .toBuffer();

    const meta = await sharp(trimmed).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
      return { buffer: inputBuffer, mimeType: 'image/jpeg' };
    }

    const longEdge = Math.max(w, h);
    const targetLongEdge = Math.round(CANVAS_SIZE * FILL_RATIO);
    const scale = targetLongEdge / longEdge;
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));

    const resized = await sharp(trimmed)
      .resize(newW, newH, { fit: 'fill' })
      .toBuffer();

    const result = await sharp({
      create: {
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: resized, gravity: 'center' }])
      .jpeg({ quality: 92, progressive: true })
      .toBuffer();

    return { buffer: result, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn(
      '[coupang-policy] enforceCoupangPolicy 실패, 원본 유지:',
      err instanceof Error ? err.message : err,
    );
    return { buffer: inputBuffer, mimeType: 'image/jpeg' };
  }
}
