import { describe, it, expect } from 'vitest';
import { listingFlags, isExcluded } from '@/lib/sourcing-candidates/filters';

const base = { price: 20000, badges: [] as string[], title: '실리콘 도마', review_count: 500 };
const FLOOR = 12097;

describe('listingFlags', () => {
  it('9,900원은 하한선 아래', () => {
    expect(listingFlags({ ...base, price: 9900 }, FLOOR)).toContain('below_floor');
  });
  it('12,200원은 통과', () => {
    expect(listingFlags({ ...base, price: 12200 }, FLOOR)).not.toContain('below_floor');
  });
  it('공식 배지', () => {
    expect(listingFlags({ ...base, badges: ['공식', '우수셀러'] }, FLOOR)).toContain('official');
  });
  it('전기·의료 단어', () => {
    expect(listingFlags({ ...base, title: '한일의료기 전기 온열 찜질기' }, FLOOR)).toContain('electric');
  });
  it('정전기는 전기가 아니다', () => {
    expect(listingFlags({ ...base, title: '정전기 방지 장갑' }, FLOOR)).not.toContain('electric');
  });
  it('전동 단어도 electric', () => {
    expect(listingFlags({ ...base, title: '전동 마사지기' }, FLOOR)).toContain('electric');
  });
  it('리뷰 1만 이상은 강자', () => {
    expect(listingFlags({ ...base, review_count: 45929 }, FLOOR)).toContain('strong');
    expect(listingFlags({ ...base, review_count: null }, FLOOR)).not.toContain('strong');
  });
});

describe('isExcluded', () => {
  it('하한선 아래만 자동 제외', () => {
    expect(isExcluded(['below_floor'], null)).toBe(true);
    expect(isExcluded(['official', 'strong'], null)).toBe(false);
  });
  it('사람이 뒤집은 값이 이긴다', () => {
    expect(isExcluded(['below_floor'], false)).toBe(false);
    expect(isExcluded([], true)).toBe(true);
  });
});
