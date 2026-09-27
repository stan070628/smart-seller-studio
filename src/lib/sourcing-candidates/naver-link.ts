import type { ListingRow } from '@/lib/sourcing-candidates/types';

/**
 * 네이버 쇼핑 목록 캡처는 상품 페이지 주소를 남기지 않는다 — 제목·판매자로 검색
 * 링크를 만들어 대신한다. 정확한 주소가 필요하면 사람이 naver_url을 직접 입력한다
 * (⭐ 후보 카드에서만 — listingHref가 있으면 그걸 우선한다).
 */

/** 끝의 말줄임표(…·...)를 지우고 공백을 한 칸으로 합친다 */
function cleanTitle(title: string): string {
  const collapsed = title.replace(/\s+/g, ' ').trim();
  return collapsed.replace(/(\.{3}|…)\s*$/u, '').trim();
}

/**
 * 제목·판매자로 네이버 쇼핑 검색 링크를 만든다.
 * 제목이 이미 판매자(브랜드)로 시작하면 또 붙이지 않는다 — "테르헨 316 스테인레스…"처럼
 * 상품명 앞에 브랜드가 이미 있는 경우가 많다.
 */
export function naverSearchUrl(l: Pick<ListingRow, 'seller' | 'title'>): string {
  const title = cleanTitle(l.title);
  const seller = l.seller.trim();
  const query = seller && !title.startsWith(seller) ? `${seller} ${title}` : title;
  return `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`;
}

/** 사람이 입력한 정확한 주소가 있으면 그것을, 없으면 검색 링크를 쓴다 */
export function listingHref(l: Pick<ListingRow, 'seller' | 'title' | 'naver_url'>): string {
  return l.naver_url ?? naverSearchUrl(l);
}
