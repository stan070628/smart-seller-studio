/**
 * 쿠팡 상품 등록 시 필수 ENV 사전 검증.
 *
 * 누락 시 쿠팡 API가 "'반품지주소' 최소 1자 이상…" 같은 검증 에러를 반환한다.
 * 라우트 진입 시점에 한 번에 점검해 어떤 키가 빠졌는지 명확한 한국어 메시지로
 * 알려준다.
 */

const REQUIRED_RETURN_ENV: ReadonlyArray<readonly [string, string]> = [
  ['COUPANG_RETURN_NAME', '반품지담당자명'],
  ['COUPANG_CONTACT_NUMBER', '반품지연락처'],
  ['COUPANG_RETURN_ZIPCODE', '반품지우편번호'],
  ['COUPANG_RETURN_ADDRESS', '반품지주소'],
  ['COUPANG_RETURN_ADDRESS_DETAIL', '반품지주소상세'],
  ['COUPANG_VENDOR_USER_ID', 'vendorUserId'],
];

export function assertCoupangReturnEnv(): void {
  const missing = REQUIRED_RETURN_ENV.filter(
    ([key]) => !(process.env[key] ?? '').trim(),
  ).map(([key, label]) => `${key}(${label})`);

  if (missing.length > 0) {
    throw new Error(
      `[쿠팡 등록 차단] 필수 환경변수가 비어있습니다: ${missing.join(', ')}. ` +
        `Vercel Project → Settings → Environment Variables 에 등록 후 재배포하세요.`,
    );
  }
}
