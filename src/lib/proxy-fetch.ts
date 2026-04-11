/**
 * 프록시를 통한 외부 API 호출 유틸리티
 *
 * PROXY_URL 환경변수가 설정된 경우 해당 프록시 서버를 통해 요청을 전달합니다.
 * 설정되지 않은 경우 직접 요청합니다 (로컬 개발용).
 */

export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = process.env.PROXY_URL?.trim();
  const proxySecret = process.env.PROXY_SECRET?.trim();

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
