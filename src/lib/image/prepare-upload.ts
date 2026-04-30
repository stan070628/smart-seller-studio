'use client';

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;
// Vercel 함수 페이로드 한계 4.5MB. multipart overhead 고려해 4.0MB로 가드.
const SAFE_RAW_BYTES = 4 * 1024 * 1024;
const SAFE_MIME = /^image\/(jpeg|png|webp)$/;

export interface PreparedUpload {
  blob: Blob;
  filename: string;
}

/**
 * 큰 이미지를 클라이언트에서 2000px JPEG q85로 다운스케일해
 * multipart 업로드 페이로드를 Vercel 함수 한계(4.5MB) 이하로 만든다.
 * 서버의 Sharp 파이프라인과 동일한 결과를 미리 만들기 때문에 화질 저하 없음.
 *
 * - 작고 안전한 JPEG/PNG/WebP는 재인코딩하지 않고 통과.
 * - HEIC 등 createImageBitmap이 거부하는 포맷은 원본 그대로 반환 (서버에서 처리/거절).
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (file.size <= SAFE_RAW_BYTES && SAFE_MIME.test(file.type)) {
    return { blob: file, filename: file.name };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, filename: file.name };
  }

  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return { blob: file, filename: file.name };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) return { blob: file, filename: file.name };

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return { blob, filename: `${baseName}.jpg` };
}
