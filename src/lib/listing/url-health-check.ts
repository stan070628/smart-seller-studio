export type UrlCheckResult =
  | { status: 'dead'; httpStatus: number }
  | { status: 'alive' }
  | { status: 'skip'; reason: string };

function isCostcoKoreaUrl(url: string): boolean {
  return url.includes('costco.co.kr');
}

// 정상 페이지: "상품명 | Costco" / 소프트 404: "Costco"
function isCostcoSoftNotFound(html: string): boolean {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return false;
  return match[1].trim() === 'Costco';
}

async function checkCostcoUrl(url: string): Promise<UrlCheckResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 SmartSellerStudio/1.0' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'skip', reason: 'timeout' };
    }
    return { status: 'skip', reason: `network: ${String(err)}` };
  }

  if (res.status === 404 || res.status === 410) {
    return { status: 'dead', httpStatus: res.status };
  }
  if (res.status >= 500 || res.status === 403 || res.status === 429) {
    return { status: 'skip', reason: `HTTP ${res.status}` };
  }

  let html = '';
  try {
    html = await res.text();
  } catch {
    return { status: 'alive' };
  }

  return isCostcoSoftNotFound(html)
    ? { status: 'dead', httpStatus: 200 }
    : { status: 'alive' };
}

export async function checkUrl(url: string): Promise<UrlCheckResult> {
  // Costco Korea는 삭제 상품에도 HTTP 200을 반환하므로 본문 title로 판별
  if (isCostcoKoreaUrl(url)) {
    return checkCostcoUrl(url);
  }

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
