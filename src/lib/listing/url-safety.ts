/**
 * SSRF 방어: https-only + private/loopback/link-local 차단
 * 외부 이미지 URL을 fetch하기 전 호출.
 */
export function assertSafeUrl(rawUrl: string): void {
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
