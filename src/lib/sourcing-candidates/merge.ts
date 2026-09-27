import { checkListingNumbers } from '@/lib/sourcing-candidates/verify';
import type { ExtractedListing, ExtractedNaverPage, MergedListing } from '@/lib/sourcing-candidates/types';

/** 구두점(마침표·쉼표·가운뎃점·말줄임표)은 조각마다 다르게 끊겨 보이므로 위치 상관없이 없앤다 */
const PUNCTUATION = /[.,·…]/g;

function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, '').replace(PUNCTUATION, '').toLowerCase();
}

/** 편집거리(Levenshtein). 짧은 문자열 비교용이라 행 하나만 유지하는 단순 구현으로 충분하다. */
function levenshtein(a: string, b: string): number {
  const prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prevRow[0];
    prevRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prevRow[j];
      prevRow[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prevRow[j], prevRow[j - 1]);
      diag = temp;
    }
  }
  return prevRow[b.length];
}

/**
 * 인접 조각 겹침으로 같은 카드가 다시 찍혔는지 "퍼지"하게 판정한다(실측: 2026-09-27
 * 컨트롤러 E2E — 판매자명·상품명이 한두 글자 다르게 읽히는 경우가 실제로 있었다).
 * 키는 다르지만 가격·리뷰 수(둘 다 not null)·평점이 전부 같고 정규화한 판매자·
 * 상품명의 편집거리가 각각 3 이하이면 겹침 사본으로 본다.
 *
 * 완전 일치는 이 함수가 아니라 dedupKey 비교로 먼저(1단계) 처리한다 — 색상·용량
 * 변형 상품이 값은 같고 이름만 한두 글자 다를 때, 퍼지 판정을 먼저 돌리면 진짜
 * 겹침 사본이 가져가야 할 이전 카드를 변형 상품이 가로챌 수 있기 때문이다.
 */
function isFuzzyOverlap(prev: ExtractedListing, cur: ExtractedListing): boolean {
  if (prev.review_count === null || cur.review_count === null) return false;
  if (prev.price !== cur.price) return false;
  if (prev.review_count !== cur.review_count) return false;
  if (prev.rating !== cur.rating) return false;
  if (levenshtein(normalize(prev.title), normalize(cur.title)) > 3) return false;
  if (levenshtein(normalize(prev.seller), normalize(cur.seller)) > 3) return false;
  return true;
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

  // 겹침은 "바로 앞 조각"과만 비교한다 — 조각은 스크롤 한 칸만큼만 겹치므로 그보다
  // 먼 조각과 같은 키가 나오면 우연이거나 실제로 다른 상품이다.
  // usedSuffix는 그 키에 지금까지 부여한 접미사 중 가장 큰 값 — 남긴 카드가 같은 키를
  // 쓰면 #2, #3…을 이어 붙인다((scan_id, dedup_key) 유니크 인덱스 대응).
  const usedSuffix = new Map<string, number>();
  const listings: MergedListing[] = [];
  let prevPage: ExtractedListing[] | null = null;
  for (const p of used) {
    const ordered = [...p.products].sort((a, b) => a.row - b.row || a.col - b.col);
    // 앞 조각 카드 하나는 겹침 사본을 최대 하나만 흡수한다(같은 카드가 두 번 겹쳐 찍히진 않는다)
    const claimedPrev = new Set<number>();
    const droppedCur = new Set<number>(); // 이번 조각에서 겹침 사본으로 판정해 버린 카드의 인덱스

    // 1단계: 완전 일치만 먼저 잇는다. 퍼지 판정이 나중(2단계)에 돌아 진짜 겹침 사본이
    // 가져가야 할 이전 카드를 색상·용량 변형 상품이 가로채는 것을 막는다.
    let maxExactRow = -1;
    let hadExactMatch = false;
    ordered.forEach((c, ci) => {
      if (!prevPage) return;
      const key = dedupKey(c);
      for (let pi = 0; pi < prevPage.length; pi++) {
        if (claimedPrev.has(pi)) continue;
        if (dedupKey(prevPage[pi]) === key) {
          claimedPrev.add(pi);
          droppedCur.add(ci);
          hadExactMatch = true;
          maxExactRow = Math.max(maxExactRow, c.row);
          break;
        }
      }
    });

    // 2단계: 퍼지 판정은 "겹침이 증명된 앞쪽 구간"에만 적용한다 — 이번 조각에서 완전
    // 일치가 나온 가장 아래 행까지만 허용하고(그 행까지는 실제로 겹침이 확인됐으므로),
    // 완전 일치가 하나도 없었으면 첫 행(0)에만 조심스럽게 적용한다. 그 아래는 겹침이라는
    // 증거가 없는 신상품 구간이므로 값이 같아 보여도 절대 지우지 않는다(색상 변형 보호).
    const rowLimit = hadExactMatch ? maxExactRow : 0;
    const prevPageForFuzzy = prevPage; // let이라 클로저 안에서 null 좁히기가 안 돼 지역 const로 다시 잡는다
    if (prevPageForFuzzy) {
      ordered.forEach((c, ci) => {
        if (droppedCur.has(ci) || c.row > rowLimit) return;
        for (let pi = 0; pi < prevPageForFuzzy.length; pi++) {
          if (claimedPrev.has(pi)) continue;
          if (isFuzzyOverlap(prevPageForFuzzy[pi], c)) {
            claimedPrev.add(pi);
            droppedCur.add(ci);
            break;
          }
        }
      });
    }

    ordered.forEach((c, ci) => {
      if (droppedCur.has(ci)) return;
      const key = dedupKey(c);
      const suffix = (usedSuffix.get(key) ?? 0) + 1;
      usedSuffix.set(key, suffix);
      const dedup_key = suffix === 1 ? key : `${key}#${suffix}`;
      const { row: _row, col: _col, ...rest } = c;
      listings.push({ ...rest, rank: listings.length + 1, dedup_key, number_check: checkListingNumbers(c) });
    });
    prevPage = ordered;
  }

  return {
    category_path: used.find((p) => p.category_path)?.category_path ?? null,
    sort_label: used.find((p) => p.sort_label)?.sort_label ?? null,
    listings,
  };
}
