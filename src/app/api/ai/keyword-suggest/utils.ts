/**
 * keyword-suggest 라우트에서 사용하는 순수 유틸리티 함수 및 타입 모음.
 * Next.js 16 Route 파일은 HTTP 핸들러와 Route Segment Config만 export할 수 있으므로
 * 테스트 대상 함수/타입은 이 파일에서 export하고 route.ts에서 import한다.
 */

export interface SuggestedKeyword {
  keyword: string;
  reason: string;
  searchVolume: number | null;
  competitorCount: number | null;
  pass: boolean | null;
  reasoning: string | null;
}

export function parseKeywordSuggestResponse(raw: string): { keyword: string; reason: string }[] {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) return [];
    return parsed.keywords.filter(
      (k: unknown): k is { keyword: string; reason: string } =>
        typeof k === 'object' &&
        k !== null &&
        typeof (k as Record<string, unknown>).keyword === 'string' &&
        typeof (k as Record<string, unknown>).reason === 'string',
    );
  } catch {
    return [];
  }
}
