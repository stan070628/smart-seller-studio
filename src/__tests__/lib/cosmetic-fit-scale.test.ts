import { describe, it, expect } from 'vitest';
import { fitScale } from '@/lib/label/cosmetic-fields';

describe('fitScale — 전성분 칸 자동 맞춤', () => {
  it('내용이 칸 안에 들어가면 배율을 건드리지 않는다', () => {
    expect(fitScale(1.4, 80, 100)).toBe(1.4);
    expect(fitScale(1.4, 100, 100)).toBe(1.4);
  });

  it('넘치면 높이가 배율의 제곱에 비례하는 만큼 줄인다', () => {
    // 내용 400 / 가용 100 → 4배 초과 → sqrt(1/4) = 0.5배
    expect(fitScale(1.4, 400, 100)).toBeCloseTo(1.4 * 0.5, 1);
  });

  it('배율을 0.5 밑으로는 줄이지 않는다', () => {
    expect(fitScale(1, 10000, 10)).toBe(0.5);
  });

  it('측정값이 0이면 배율을 유지한다 (레이아웃 전)', () => {
    expect(fitScale(1.4, 0, 0)).toBe(1.4);
    expect(fitScale(1.4, 200, 0)).toBe(1.4);
  });
});
