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

  // priorCount는 "이전 조각까지" 그 키가 몇 번 나왔는지(버려진 것 포함) 누적한다.
  // 다음 조각에서 같은 키가 그 횟수만큼 나오면 겹침 사본으로 보고 그만큼만 버리고,
  // 그보다 더 나오면 실제로 다른 상품(같은 정규화 키로 우연히 겹침)이므로 남긴다.
  // usedSuffix는 그 키에 지금까지 부여한 접미사 중 가장 큰 값 — #2, #3…을 이어 붙인다
  // (scan_id, dedup_key) 유니크 인덱스 대응).
  const priorCount = new Map<string, number>();
  const usedSuffix = new Map<string, number>();
  const listings: MergedListing[] = [];
  for (const p of used) {
    const ordered = [...p.products].sort((a, b) => a.row - b.row || a.col - b.col);
    const pageCount = new Map<string, number>();
    for (const c of ordered) {
      const key = dedupKey(c);
      const overlap = priorCount.get(key) ?? 0;
      const occurrence = (pageCount.get(key) ?? 0) + 1;
      pageCount.set(key, occurrence);
      if (occurrence <= overlap) continue; // 이전 조각과 겹치는 사본

      const suffix = (usedSuffix.get(key) ?? 0) + 1;
      usedSuffix.set(key, suffix);
      const dedup_key = suffix === 1 ? key : `${key}#${suffix}`;
      const { row: _row, col: _col, ...rest } = c;
      listings.push({ ...rest, rank: listings.length + 1, dedup_key, number_check: checkListingNumbers(c) });
    }
    for (const [key, n] of pageCount) priorCount.set(key, (priorCount.get(key) ?? 0) + n);
  }

  return {
    category_path: used.find((p) => p.category_path)?.category_path ?? null,
    sort_label: used.find((p) => p.sort_label)?.sort_label ?? null,
    listings,
  };
}
