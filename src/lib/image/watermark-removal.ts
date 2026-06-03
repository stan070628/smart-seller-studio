import sharp from 'sharp';

// 이미지 너비 대비 워터마크 너비 비율 (Gemini 기준 실측값)
const WATERMARK_WIDTH_RATIO = 0.28;
// 이미지 높이 대비 워터마크 높이 비율
const WATERMARK_HEIGHT_RATIO = 0.05;
// 처리를 건너뛸 최소 이미지 높이 (px)
const MIN_HEIGHT_PX = 40;
// 패치 영역에 적용할 블러 강도 (sigma)
const BLUR_SIGMA = 3;

/**
 * 이미지 우측 하단의 Gemini 워터마크를 인접 픽셀로 덮어 제거합니다.
 * 실패 시 원본 버퍼를 그대로 반환합니다 (non-fatal).
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer> {
  try {
    const { width, height } = await sharp(buffer).metadata();
    if (!width || !height || height < MIN_HEIGHT_PX) return buffer;

    const wmWidth = Math.floor(width * WATERMARK_WIDTH_RATIO);
    const wmHeight = Math.floor(height * WATERMARK_HEIGHT_RATIO);
    const wmLeft = width - wmWidth;
    const wmTop = height - wmHeight;

    // 워터마크 바로 위 동일 크기 구간을 추출하여 블렌딩 소스로 사용
    const patchBuffer = await sharp(buffer)
      .extract({ left: wmLeft, top: wmTop - wmHeight, width: wmWidth, height: wmHeight })
      .blur(BLUR_SIGMA)
      .toBuffer();

    return sharp(buffer)
      .composite([{ input: patchBuffer, left: wmLeft, top: wmTop }])
      .toBuffer();
  } catch {
    return buffer;
  }
}
