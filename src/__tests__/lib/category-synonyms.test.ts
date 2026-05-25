import { describe, it, expect } from 'vitest';
import { expandKeyword } from '@/lib/listing/category-synonyms';

describe('expandKeyword', () => {
  it('매핑 있는 키워드는 원본을 첫 번째로, 동의어를 뒤에 반환', () => {
    const result = expandKeyword('등산가방');
    expect(result[0]).toBe('등산가방');
    expect(result).toContain('배낭');
    expect(result).toContain('트레킹백');
    expect(result.length).toBeGreaterThan(1);
  });

  it('매핑 없는 키워드는 원본만 포함한 길이 1 배열 반환', () => {
    expect(expandKeyword('없는키워드')).toEqual(['없는키워드']);
  });

  it('앞뒤 공백은 trim 처리 후 매핑 탐색', () => {
    const result = expandKeyword('  등산가방  ');
    expect(result[0]).toBe('등산가방');
    expect(result).toContain('배낭');
  });

  it('원본 키워드가 항상 배열의 첫 번째 요소', () => {
    const result = expandKeyword('텐트');
    expect(result[0]).toBe('텐트');
    expect(result.length).toBeGreaterThan(1);
  });

  it('텀블러 매핑 확인', () => {
    const result = expandKeyword('보온병');
    expect(result).toContain('텀블러');
  });
});
