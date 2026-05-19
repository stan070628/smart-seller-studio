export type UrlCheckResult =
  | { status: 'dead'; httpStatus: number }
  | { status: 'alive' }
  | { status: 'skip'; reason: string };

export async function checkUrl(url: string): Promise<UrlCheckResult> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 SmartSellerStudio/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });

    // 명시적으로 죽은 페이지 (404, 410)
    if (res.status === 404 || res.status === 410) {
      return { status: 'dead', httpStatus: res.status };
    }

    // 문제가 있어서 스킵해야 할 상태 (서버 오류, Geo-block, Rate Limit)
    if (res.status >= 500 || res.status === 403 || res.status === 429) {
      return { status: 'skip', reason: `HTTP ${res.status}` };
    }

    // 그 외 모든 상태 (200, 301, 302, 등등)는 alive로 간주
    // redirect: 'follow'로 설정했으므로 리다이렉트는 자동으로 따라가짐
    return { status: 'alive' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'skip', reason: 'timeout' };
    }
    return { status: 'skip', reason: `network: ${String(err)}` };
  }
}
