/**
 * multipart 업로드 검사. 브라우저가 이미 JPEG 조각으로 만들어 보내므로
 * 여기는 백스톱이다 — Vercel은 4.5MB 넘는 본문을 함수에 넘기지 않는다(receipt/downscale.ts).
 */
export const MAX_FILES = 12;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export function validateFiles(files: File[]): string | null {
  if (files.length === 0) return 'files 필드가 비어 있습니다.';
  if (files.length > MAX_FILES) return `이미지는 한 번에 ${MAX_FILES}장까지입니다. 나눠서 올려 주세요.`;
  if (files.some((f) => f.type !== 'image/jpeg')) return 'JPEG만 받습니다 (화면이 변환해 보냅니다).';
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return '합계 용량이 너무 큽니다. 나눠서 올려 주세요.';
  return null;
}
