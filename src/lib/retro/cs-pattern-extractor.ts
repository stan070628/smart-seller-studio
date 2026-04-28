/**
 * CS 문의 TOP 5 패턴 자동 추출
 * 단순 키워드 카운팅 (1차)
 */

const KEYWORD_BUCKETS: Record<string, string[]> = {
  '배송조회': ['배송', '언제', '도착', '운송장', '발송'],
  '반품/교환': ['반품', '교환', '환불', '취소'],
  '사이즈': ['사이즈', '크기', '치수', '둘레'],
  '색상/디자인': ['색상', '컬러', '디자인', '모양'],
  '상품 문의': ['재질', '소재', '성분', '사양', '스펙'],
};

export interface CsPattern {
  category: string;
  count: number;
  examples: string[];
}

export function extractTopPatterns(
  inquiries: Array<{ questionText: string }>,
  topN = 5,
): CsPattern[] {
  const counts: Record<string, { count: number; examples: string[] }> = {};

  for (const i of inquiries) {
    const text = i.questionText.toLowerCase();
    for (const [cat, keywords] of Object.entries(KEYWORD_BUCKETS)) {
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        counts[cat] = counts[cat] ?? { count: 0, examples: [] };
        counts[cat].count++;
        if (counts[cat].examples.length < 3) {
          counts[cat].examples.push(i.questionText);
        }
        break;
      }
    }
  }

  return Object.entries(counts)
    .map(([category, v]) => ({ category, count: v.count, examples: v.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
