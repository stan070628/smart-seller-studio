/**
 * Layer: category
 *
 * 도매꾹 카테고리명 기반 RED 차단
 * 채널 spec v2 §2.3 — KC인증/허가 부담이 큰 카테고리 자체 회피
 */

import type { LegalIssue } from './types';

const BLOCKED_CATEGORY_KEYWORDS = [
  '유아용품', '아동용품', '유아의류', '아기용품',
  '식품', '가공식품', '신선식품', '농산물', '수산물', '축산물',
  '의약품', '의약외품',
  '건강기능식품',
  '주류', '담배',
] as const;

export function checkBlockedCategory(categoryName?: string | null): LegalIssue | null {
  if (!categoryName || categoryName.trim().length === 0) return null;

  for (const kw of BLOCKED_CATEGORY_KEYWORDS) {
    if (categoryName.includes(kw)) {
      return {
        layer: 'category',
        severity: 'RED',
        code: 'BLOCKED_CATEGORY',
        message: `회피 카테고리: '${kw}' (KC인증/허가 부담)`,
        detail: { matched: kw, categoryName },
      };
    }
  }
  return null;
}
