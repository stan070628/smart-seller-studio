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

  it('"생활용품" 카테고리 → null (안전)', () => {
    expect(checkBlockedCategory('생활용품 > 수납')).toBeNull();
  });

  it('빈 문자열/undefined → null', () => {
    expect(checkBlockedCategory('')).toBeNull();
    expect(checkBlockedCategory(undefined)).toBeNull();
  });
});
