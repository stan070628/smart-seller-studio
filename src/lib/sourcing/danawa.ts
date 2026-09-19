/**
 * 다나와 가격비교 검색
 *
 * 🔴 왜 다나와인가 (2026-09-06)
 *   네이버 쇼핑 검색 API(`openapi.naver.com/v1/search/shop.json`)가 2026-08-01에 종료돼
 *   `SE05 — 존재하지 않는 검색 api`를 반환한다. 재등록·설정 변경으로 복구되지 않는다.
 *   쿠팡 파트너스 API는 발급 불가 상태이고, 쿠팡 직접 조회는 403(봇 차단)이다.
 *   다나와는 Vercel 서버에서 HTTP 200으로 열리는 것을 실측 확인했다(396KB, 파싱 정상).
 *
 * ⚠️ HTML 파싱이라 사이트 개편에 깨진다. 셀렉터가 안 맞으면 빈 배열을 돌려주므로
 *    호출부는 「시세 없음」으로 표시하고 죽지 않는다. 파트너스 API가 열리면 그쪽으로 옮긴다.
 */

const SEARCH_URL = 'https://search.danawa.com/dsearch.php';

/** 브라우저로 위장하지 않으면 봇 차단에 걸린다 */
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};

const TIMEOUT_MS = 15_000;

export interface DanawaItem {
  title: string;
  /** 최저가(원) */
  price: number;
  link: string | null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 다나와에서 상품을 검색해 최저가 목록을 돌려준다.
 *
 * 광고 슬롯이 섞이므로 상품명과 가격을 같은 블록에서 함께 뽑는다 —
 * 가격만 따로 긁으면 광고 상품의 가격이 엉뚱한 상품명에 붙는다.
 */
export async function searchDanawa(query: string, limit = 8): Promise<DanawaItem[]> {
  const url = `${SEARCH_URL}?query=${encodeURIComponent(query)}`;

  let html: string;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[danawa] HTTP ${res.status} · query="${query}"`);
      return [];
    }
    html = await res.text();
  } catch (e) {
    console.warn(`[danawa] 요청 실패 · query="${query}" · ${String((e as Error).message).slice(0, 100)}`);
    return [];
  }

  // 상품 목록은 <li class="prod_item ..."> 단위로 반복된다. 블록을 먼저 자른 뒤
  // 그 안에서 이름·가격·링크를 뽑아야 광고와 섞이지 않는다.
  const blocks = html.split(/<li[^>]+class="[^"]*prod_item[^"]*"/).slice(1);

  const items: DanawaItem[] = [];
  for (const b of blocks) {
    const nameM = b.match(/<p class="prod_name">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    if (!nameM) continue;
    const title = stripTags(nameM[1] ?? '');
    if (!title) continue;

    // 가격은 <strong>12,340</strong> 형태. 블록 내 첫 값이 최저가다.
    const priceM = b.match(/<strong>\s*([\d,]{3,})\s*<\/strong>/);
    if (!priceM) continue;
    const price = Number((priceM[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;

    const linkM = b.match(/<a[^>]+href="(https?:\/\/[^"]+)"/);

    items.push({ title, price, link: linkM?.[1] ?? null });
    if (items.length >= limit) break;
  }

  console.log(`[danawa] "${query}" → ${items.length}건`);
  return items;
}
