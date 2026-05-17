/**
 * Claude Vision 공용 헬퍼.
 *
 * 여러 라우트에서 동일하게 필요한 작업:
 * - 외부 URL → base64 변환
 * - Claude API 8000px 제한 대응 (가로·세로 7500px 초과 시 리사이즈)
 *
 * 원래 generate-detail-html 라우트 내부에 정의되어 있었으나
 * 대화식 상세페이지 사전 채움 라우트에서도 동일 기능이 필요해 추출.
 */

import sharp from 'sharp';

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface ClaudeImage {
  imageBase64: string;
  mimeType: AllowedMimeType;
}

/** Claude API 이미지 최대 허용 픽셀 (안전 마진 적용) */
const CLAUDE_MAX_IMAGE_DIMENSION = 7500;

/**
 * 이미지 base64를 받아 가로·세로 중 하나라도 7500px 초과 시 리사이즈한다.
 * 비율 유지. 지원 포맷이 아니면 JPEG으로 변환.
 */
export async function resizeForClaude(
  imageBase64: string,
  _mimeType: AllowedMimeType,
): Promise<ClaudeImage> {
  const buffer = Buffer.from(imageBase64, 'base64');
  const metadata = await sharp(buffer).metadata();
  const { width = 0, height = 0, format } = metadata;

  const detectedMime: AllowedMimeType =
    format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';

  if (width <= CLAUDE_MAX_IMAGE_DIMENSION && height <= CLAUDE_MAX_IMAGE_DIMENSION) {
    if (format === 'jpeg' || format === 'png' || format === 'webp') {
      return { imageBase64, mimeType: detectedMime };
    }
    const converted = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    return { imageBase64: converted.toString('base64'), mimeType: 'image/jpeg' };
  }

  const resized = await sharp(buffer)
    .resize(CLAUDE_MAX_IMAGE_DIMENSION, CLAUDE_MAX_IMAGE_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { imageBase64: resized.toString('base64'), mimeType: 'image/jpeg' };
}

/**
 * URL 배열을 fetch하여 base64 이미지 배열로 변환한다.
 * Content-Type 헤더가 ALLOWED_MIME_TYPES에 매칭되지 않으면 image/jpeg 가정.
 */
export async function fetchImagesFromUrls(urls: string[]): Promise<ClaudeImage[]> {
  return Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`이미지 다운로드 실패: ${url} (${res.status})`);
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const mimeType: AllowedMimeType =
        (ALLOWED_MIME_TYPES.find((m) => contentType.includes(m)) as AllowedMimeType | undefined) ??
        'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { imageBase64: buffer.toString('base64'), mimeType };
    }),
  );
}
