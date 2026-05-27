import { describe, it, expect } from 'vitest';
import { getYearMonths } from '../ad-spend';

describe('getYearMonths', () => {
  it('같은 달이면 1개 반환', () => {
    expect(getYearMonths('2026-05-01', '2026-05-31')).toEqual(['2026-05']);
  });

  it('두 달 범위면 2개 반환', () => {
    expect(getYearMonths('2026-04-15', '2026-05-10')).toEqual(['2026-04', '2026-05']);
  });

  it('3개월 범위', () => {
    expect(getYearMonths('2026-03-01', '2026-05-31')).toEqual(['2026-03', '2026-04', '2026-05']);
  });

  it('from이 null이면 빈 배열', () => {
    expect(getYearMonths(null, '2026-05-31')).toEqual([]);
  });

  it('to가 null이면 빈 배열', () => {
    expect(getYearMonths('2026-05-01', null)).toEqual([]);
  });

  it('둘 다 null이면 빈 배열', () => {
    expect(getYearMonths(null, null)).toEqual([]);
  });

  it('연도가 바뀌는 범위', () => {
    expect(getYearMonths('2025-11-01', '2026-01-31')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});
