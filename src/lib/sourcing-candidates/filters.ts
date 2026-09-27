/**
 * 후보 표 자동 거름망.
 * 자동 「제외」는 하한선 하나뿐이고 나머지는 경고다 — 제외한 줄도 숨기지 않고 접어 둔다.
 * 근거: 하한선 = 위키 「장갑 카테고리 판정과 판매가 하한선 2026-08-23」,
 * 강자·전기 = 「도제 상담 1회차 전인규 2026-09-27」.
 */
export type FilterFlag = 'below_floor' | 'official' | 'electric' | 'strong';

export const ELECTRIC_WORDS = ['전기', '온열기', '의료기기', '충전식'];
export const STRONG_REVIEW_COUNT = 10_000;

export function listingFlags(
  l: { price: number; badges: string[]; title: string; review_count: number | null },
  floor: number,
): FilterFlag[] {
  const flags: FilterFlag[] = [];
  if (l.price < floor) flags.push('below_floor');
  if (l.badges.includes('공식')) flags.push('official');
  if (ELECTRIC_WORDS.some((w) => l.title.includes(w))) flags.push('electric');
  if ((l.review_count ?? 0) >= STRONG_REVIEW_COUNT) flags.push('strong');
  return flags;
}

/** 사람이 뒤집은 값(excluded_override)이 있으면 그것이 이긴다 */
export function isExcluded(flags: FilterFlag[], override: boolean | null): boolean {
  return override ?? flags.includes('below_floor');
}
