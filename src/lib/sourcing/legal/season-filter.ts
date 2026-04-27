/**
 * Layer: season
 *
 * 시즌 한정 상품 RED 차단
 * 채널 spec v2 §2.3 — 크리스마스/설/추석/할로윈 등 한정 상품은 재입고 불투명
 */

import type { LegalIssue } from './types';

const SEASON_KEYWORDS = [
  '크리스마스', 'christmas', 'xmas',
  '설날', '구정',
  '추석', '한가위',
  '할로윈', 'halloween',
  '밸런타인', 'valentine',
  '화이트데이',
  '빼빼로데이',
  '어버이날', '스승의날',
  '어린이날',
  '광복절',
] as const;

export function checkSeasonLimited(title: string): LegalIssue | null {
  const lower = title.toLowerCase();
  for (const kw of SEASON_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        layer: 'season',
        severity: 'RED',
        code: 'SEASON_LIMITED',
        message: `시즌 한정 상품 의심: '${kw}' (재입고 불투명)`,
        detail: { matched: kw },
      };
    }
  }
  return null;
}
