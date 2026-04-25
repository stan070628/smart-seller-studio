/**
 * dompurify-ssr.ts
 * DOMPurify는 browser-only 패키지라 SSR/빌드 환경에서 resolve 실패.
 * next.config.ts 에서 서버 컨텍스트의 'dompurify'를 이 파일로 대체.
 * 실제 sanitize는 클라이언트에서만 수행되므로 여기선 identity 반환.
 */
const DOMPurify = {
  sanitize: (html: string) => html,
};

export default DOMPurify;
