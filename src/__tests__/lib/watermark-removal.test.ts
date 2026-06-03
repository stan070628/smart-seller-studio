import { describe, it, expect } from 'vitest';
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

describe('removeGeminiWatermark', () => {
  it('우측 하단 워터마크 영역이 위 영역 픽셀로 덮어씌워진다', async () => {
    const width = 100;
    const height = 100;
    const wmWidth = Math.floor(width * 0.28);  // 28px
    const wmHeight = Math.floor(height * 0.05); // 5px

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
