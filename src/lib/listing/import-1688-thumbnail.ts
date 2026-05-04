import sharp from 'sharp';
import { uploadToStorage } from '@/lib/supabase/server';

const SIZE = 500;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

// SSRF 방어: https-only + private/loopback/link-local 차단
function assertSafeUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('이미지 URL은 https만 허용됩니다.');
  const h = url.hostname;
  if (
    h === 'localhost' ||
    /^127\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^10\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
    /^192\.168\./.test(h)
  ) {
    throw new Error('허용되지 않는 이미지 URL입니다.');
  }
}

export function truncateTitle(title: string): string {
  const chars = [...title];
  return chars.length > 20 ? chars.slice(0, 20).join('') + '...' : title;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSvgOverlay(title: string): string {
  const safe = escapeXml(truncateTitle(title));
  return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="400" width="${SIZE}" height="100" fill="rgba(255,255,255,0.88)"/>
  <text x="250" y="455" font-family="sans-serif" font-size="17" font-weight="bold"
        text-anchor="middle" fill="#1a1a1a">${safe}</text>
</svg>`;
}

/**
 * 1688 이미지 URL에서 쿠팡 썸네일을 생성하여 Supabase에 업로드합니다.
 * @returns Supabase public URL
 */
export async function generateAndUploadThumbnail(
  imageUrl: string,
  title: string,
  sessionId: string
): Promise<string> {
  assertSafeUrl(imageUrl);
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');

  const inputBuffer = Buffer.from(await res.arrayBuffer());
  if (inputBuffer.length > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');

  const baseBuffer = await sharp(inputBuffer)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer();

  const svgBuffer = Buffer.from(buildSvgOverlay(title));
  const thumbnailBuffer = await sharp(baseBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const storagePath = `1688-import/${sessionId}/thumbnail.jpg`;
  const result = await uploadToStorage(
    storagePath,
    thumbnailBuffer.buffer.slice(
      thumbnailBuffer.byteOffset,
      thumbnailBuffer.byteOffset + thumbnailBuffer.byteLength
    ) as ArrayBuffer,
    'image/jpeg',
    thumbnailBuffer.length
  );
  return result.url;
}
