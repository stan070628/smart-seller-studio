// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { measureTextWidth, fitFontSize } from '@/lib/listing/sharp-overlay';

describe('measureTextWidth', () => {
  it('한국어 문자열의 픽셀 폭을 양수로 반환한다', () => {
    const w = measureTextWidth('테스트', 16);
    expect(w).toBeGreaterThan(0);
  });

  it('폰트 크기가 커지면 폭도 비례해서 커진다', () => {
    const small = measureTextWidth('테스트', 16);
    const big = measureTextWidth('테스트', 32);
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeCloseTo(2, 0);
  });

  it('빈 문자열의 폭은 0이다', () => {
    expect(measureTextWidth('', 16)).toBe(0);
  });
});

describe('fitFontSize', () => {
  it('초기 크기에 들어가면 그대로 반환한다', () => {
    const size = fitFontSize('가', { boxWidth: 1000, initialSize: 20, minSize: 8 });
    expect(size).toBe(20);
  });

  it('박스에 안 들어가면 점진적으로 축소한다', () => {
    const size = fitFontSize('가나다라마바사아자차카타파하', {
      boxWidth: 30,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThanOrEqual(8);
  });

  it('최소 크기 미만으로는 내려가지 않는다', () => {
    const size = fitFontSize('매우매우매우매우매우긴문자열입니다', {
      boxWidth: 5,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBe(8);
  });
});
