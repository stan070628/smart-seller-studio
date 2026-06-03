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

    // I-2: wmWidth/wmHeight가 0이면 sharp가 예외를 던지므로 조기 반환
    if (wmHeight < 1 || wmWidth < 1) return buffer;

    const wmLeft = width - wmWidth;
    const wmTop = height - wmHeight;

    // I-1: 패치 추출 시작 좌표가 음수이면 처리 불가 → 원본 반환
    const patchTop = wmTop - wmHeight;
    if (patchTop < 0) return buffer;

    // 워터마크 바로 위 동일 크기 구간을 추출하여 블렌딩 소스로 사용
    const patchBuffer = await sharp(buffer)
      .extract({ left: wmLeft, top: patchTop, width: wmWidth, height: wmHeight })
      .blur(BLUR_SIGMA)
      .toBuffer();

    return sharp(buffer)
      .composite([{ input: patchBuffer, left: wmLeft, top: wmTop }])
      .toBuffer();
  } catch (err) {
    // M-3: 처리 실패 원인을 warn으로 기록 후 원본 반환
    console.warn('[removeGeminiWatermark] 처리 실패, 원본 반환:', err);
    return buffer;
  }
}
