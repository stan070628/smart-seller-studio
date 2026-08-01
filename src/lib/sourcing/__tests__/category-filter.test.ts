import { describe, it, expect } from 'vitest';
import { checkBlockedCategory } from '../legal/category-filter';

describe('checkBlockedCategory — 회피 카테고리 RED 차단', () => {
  it('"유아용품" 카테고리 → RED', () => {
    const issue = checkBlockedCategory('유아용품 > 젖병');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('category');
    expect(issue?.code).toBe('BLOCKED_CATEGORY');
  });

  it('"식품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('식품 > 가공식품')?.severity).toBe('RED');
  });

  it('"의약품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('의약품/위생용품')?.severity).toBe('RED');
  });

  it('"건강기능식품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('건강기능식품 > 비타민')?.severity).toBe('RED');
  });

  // 화장품책임판매업 등록이 없으면 못 판다. 목록에서 빠져 있어 새어 들어왔다.
  it('"화장품" 카테고리 → RED', () => {
    expect(checkBlockedCategory('화장품 > 스킨케어')?.severity).toBe('RED');
    expect(checkBlockedCategory('생활용품 > 화장품용기')?.severity).toBe('RED');
  });

  it('"생활용품" 카테고리 → null (안전)', () => {
    expect(checkBlockedCategory('생활용품 > 수납')).toBeNull();
  });

  it('빈 문자열/undefined → null', () => {
    expect(checkBlockedCategory('')).toBeNull();
    expect(checkBlockedCategory(undefined)).toBeNull();
  });
});
