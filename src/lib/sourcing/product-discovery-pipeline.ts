import { fetchKeywordDetails } from '@/lib/naver-ad';
import { NaverShoppingClient } from '@/lib/niche/naver-shopping';

export interface ValidationInput {
  /** 사용자가 확정한 키워드 셋 (5~7개) */
  keywords: string[];
}

export interface ValidationResult {
  keyword: string;
  searchVolume: number | null;
  competitorCount: number | null;
  compIdx: '낮음' | '중간' | '높음' | null;
  avgCtr: number | null;
}

/**
 * 키워드 셋 → 검색량 + 경쟁강도 + CTR + 경쟁상품수 일괄 검증
 *
 * Naver Ad keywordstool 5개 배치 호출 + Naver Shopping search 병렬 호출.
 * 데이터 없는 키워드는 null로 표시 (탈락 아님).
 */
export async function validateKeywords(
  input: ValidationInput,
): Promise<ValidationResult[]> {
  const trimmed = Array.from(new Set(
    input.keywords.map((k) => k.trim()).filter(Boolean),
  ));
  if (trimmed.length === 0) return [];

  // 1) Naver Ad: 검색량 + compIdx + CTR (5개씩 배치)
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const detailMap = new Map<string, { vol: number; compIdx: '낮음'|'중간'|'높음'|null; avgCtr: number | null }>();

  const hints = trimmed.map((s) => s.replace(/\s+/g, ''));
  for (let i = 0; i < hints.length; i += 5) {
    const batch = hints.slice(i, i + 5);
    const list = await fetchKeywordDetails(batch).catch(() => []);
    for (const d of list) {
      const n = normalize(d.keyword);
      if (!detailMap.has(n)) {
        detailMap.set(n, { vol: d.searchVolume, compIdx: d.compIdx, avgCtr: d.avgCtr });
      }
    }
    if (i + 5 < hints.length) await new Promise((r) => setTimeout(r, 300));
  }

  // 2) Naver Shopping: 경쟁상품수 (병렬)
  const naver = new NaverShoppingClient();
  const compResults = await Promise.all(
    trimmed.map((kw) =>
      naver.searchShopping(kw, 1).then((r) => r.total).catch(() => null),
    ),
  );

  // 3) 결합
  return trimmed.map((kw, i) => {
    const ad = detailMap.get(normalize(kw));
    return {
      keyword: kw,
      searchVolume: ad?.vol ?? null,
      competitorCount: compResults[i],
      compIdx: ad?.compIdx ?? null,
      avgCtr: ad?.avgCtr ?? null,
    };
  });
}
