/**
 * 프록시를 통한 외부 API 호출 유틸리티
 *
 * PROXY_URL 환경변수가 설정된 경우 해당 프록시 서버를 통해 요청을 전달합니다.
 * 설정되지 않은 경우 직접 요청합니다 (로컬 개발용).
 */

// 일부 환경에서 PROXY_URL 끝에 literal "\n" (2 chars: backslash+n) 또는 실제 개행이 붙은 채로
// 등록되는 경우가 있어 URL parse가 깨졌음(쿠팡 API 호출 전부 실패 → dashboard 0원/0개 노출).
// 방어적으로 trailing whitespace + literal \\n 모두 제거.
function sanitizeProxyUrl(raw: string | undefined): string | undefined {
  return raw?.replace(/(\\n|\s)+$/g, '');
}

export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = sanitizeProxyUrl(process.env.PROXY_URL);
  const proxySecret = sanitizeProxyUrl(process.env.PROXY_SECRET);

  if (proxyUrl && proxySecret) {
    const headers = new Headers(init?.headers);
    headers.set('x-proxy-secret', proxySecret);
    headers.set('x-target-url', url);

    return fetch(`${proxyUrl}/proxy`, {
      ...init,
      headers,
    });
  }

  return fetch(url, init);
}
