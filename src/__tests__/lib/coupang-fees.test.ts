import { describe, it, expect } from 'vitest';
import { resolveCoupangFee, COUPANG_DEFAULT_FEE } from '@/lib/calculator/coupang-fees';

describe('resolveCoupangFee — empty path 처리', () => {
  it('빈 문자열은 matched=false + 기본값 10.8%', () => {
    const r = resolveCoupangFee('');
    expect(r.matched).toBe(false);
    expect(r.rate).toBe(0.108);
    expect(r.matchedPrefix).toBeNull();
  });
  it('null 입력은 matched=false', () => {
    expect(resolveCoupangFee(null).matched).toBe(false);
  });
  it('undefined 입력은 matched=false', () => {
    expect(resolveCoupangFee(undefined).matched).toBe(false);
  });
  it('COUPANG_DEFAULT_FEE 노출', () => {
    expect(COUPANG_DEFAULT_FEE.rate).toBe(0.108);
    expect(COUPANG_DEFAULT_FEE.categoryName).toBe('기타');
  });
});
