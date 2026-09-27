import { checkListingNumbers } from '@/lib/sourcing-candidates/verify';
import type { ExtractedListing, ExtractedNaverPage, MergedListing } from '@/lib/sourcing-candidates/types';

/** 구두점(마침표·쉼표·가운뎃점·말줄임표)은 조각마다 다르게 끊겨 보이므로 위치 상관없이 없앤다 */
const PUNCTUATION = /[.,·…]/g;

function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, '').replace(PUNCTUATION, '').toLowerCase();
}

/**
 * 같은 상품 판정 키.
 * 스크롤 캡처·겹친 조각에서 같은 카드가 두 번 찍힌다(2026-09-27 찜질 캡처의 들꽃잠).
 * 판매자+상품명+판매가가 같으면 같은 카드로 본다. 말줄임 위치가 조각마다
 * 같게 렌더되므로 상품명 앞부분 비교로 충분하다.
 */
export function dedupKey(l: Pick<ExtractedListing, 'seller' | 'title' | 'price'>): string {
  return `${normalize(l.seller)}|${normalize(l.title)}|${l.price}`;
}

export interface MergeResult {
  category_path: string | null;
  sort_label: string | null;
  listings: MergedListing[];
}

/**
 * 조각(또는 여러 장 캡처)을 순서대로 합친다.
 *
 * 정렬 바 위는 맞춤 추천·장보기 같은 광고 블록이라 순위가 아니다(도마 캡처 실측).
 * 정렬 바는 첫 조각에서만 보이므로, 정렬 바가 처음 보인 조각부터 쓰고 그 앞 조각은
 * 통째로 버린다. 그 조각 안의 정렬 바 위 상품은 판독 단계에서 이미 빠져 있다.
 */
export function mergePages(pages: ExtractedNaverPage[]): MergeResult {
  const firstSort = pages.findIndex((p) => p.sort_bar_seen);
  const used = firstSort < 0 ? pages : pages.slice(firstSort);

  // seen은 "이전 페이지까지" 나온 키만 담는다 — 조각 겹침으로 생긴 중복을 걸러낸다.
  // 같은 페이지 안의 중복 키는 다른 상품(말줄임으로 제목이 같게 잘림)이므로 걸러내지 않고
  // dedup_key에 #2, #3…을 붙여 별도 줄로 남긴다(scan_id, dedup_key) 유니크 인덱스 대응).
  const seen = new Set<string>();
  const listings: MergedListing[] = [];
  for (const p of used) {
    const ordered = [...p.products].sort((a, b) => a.row - b.row || a.col - b.col);
    const pageCount = new Map<string, number>();
    for (const c of ordered) {
      const key = dedupKey(c);
      if (seen.has(key)) continue;
      const n = (pageCount.get(key) ?? 0) + 1;
      pageCount.set(key, n);
      const dedup_key = n === 1 ? key : `${key}#${n}`;
      const { row: _row, col: _col, ...rest } = c;
      listings.push({ ...rest, rank: listings.length + 1, dedup_key, number_check: checkListingNumbers(c) });
    }
    for (const key of pageCount.keys()) seen.add(key);
  }

  return {
    category_path: used.find((p) => p.category_path)?.category_path ?? null,
    sort_label: used.find((p) => p.sort_label)?.sort_label ?? null,
    listings,
  };
}
