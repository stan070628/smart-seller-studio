import { z } from 'zod';

/**
 * multipart 업로드 검사. 브라우저가 이미 JPEG 조각으로 만들어 보내므로
 * 여기는 백스톱이다 — Vercel은 4.5MB 넘는 본문을 함수에 넘기지 않는다(receipt/downscale.ts).
 */
export const MAX_FILES = 12;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export function validateFiles(files: File[]): string | null {
  if (files.length === 0) return 'files 필드가 비어 있습니다.';
  if (files.length > MAX_FILES) return `이미지는 한 번에 ${MAX_FILES}조각까지입니다. 나눠서 올려 주세요.`;
  if (files.some((f) => f.type !== 'image/jpeg')) return 'JPEG만 받습니다 (화면이 변환해 보냅니다).';
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return '합계 용량이 너무 큽니다. 나눠서 올려 주세요.';
  return null;
}

/**
 * 1688 업체 URL 검사. http/https만 받는다 — 업로드 폼과 PATCH가 함께 쓴다.
 * javascript:·data: 같은 스킴이 그대로 저장·렌더되는 것을 막는다.
 */
export const OFFER_URL_SCHEMA = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//.test(u), 'http/https URL만 허용됩니다.');

/**
 * 네이버 상품 URL 검사. OFFER_URL_SCHEMA와 같은 이유(javascript:·data: 스킴 차단)로
 * http/https만 받고, 캡처가 아니라 사람이 손으로 옮겨 적는 값이라 길이도 제한한다.
 * DB의 CHECK(naver_url ~ '^https?://')와 같은 조건을 응답 이전에 걸러준다.
 */
export const NAVER_URL_SCHEMA = z
  .string()
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), '네이버 주소는 http로 시작해야 합니다.');
