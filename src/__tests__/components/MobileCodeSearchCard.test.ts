import { describe, it, expect } from 'vitest';

const isProductCode = (s: string) => /^\d{7}$/.test(s);

function calcOfflineUnitPrice(
  offlinePrice: number,
  onlinePrice: number,
  unitPrice: number,
): number {
  return offlinePrice * (unitPrice / onlinePrice);
}

function calcSavingRate(naverUnitPrice: number, offlineUnitPrice: number): number {
  return (naverUnitPrice / offlineUnitPrice - 1) * 100;
}

describe('상품코드 감지', () => {
  it('7자리 숫자는 코드로 인식한다', () => {
    expect(isProductCode('1234567')).toBe(true);
  });
  it('6자리는 코드가 아니다', () => {
    expect(isProductCode('123456')).toBe(false);
  });
  it('8자리는 코드가 아니다', () => {
    expect(isProductCode('12345678')).toBe(false);
  });
  it('문자 포함은 코드가 아니다', () => {
    expect(isProductCode('123456a')).toBe(false);
  });
  it('빈 문자열은 코드가 아니다', () => {
    expect(isProductCode('')).toBe(false);
  });
});

describe('오프라인 단위가 계산', () => {
  it('오프라인 가격으로 단위가를 환산한다', () => {
    const result = calcOfflineUnitPrice(29900, 32900, 16450);
    expect(result).toBeCloseTo(14950, 0);
  });
});

describe('절감율 계산', () => {
  it('네이버 단위가가 더 높으면 양수 절감율', () => {
    const rate = calcSavingRate(22400, 14950);
    expect(rate).toBeCloseTo(49.8, 0);
  });
  it('네이버 단위가가 더 낮으면 음수 절감율(코스트코가 비쌈)', () => {
    const rate = calcSavingRate(10000, 15000);
    expect(rate).toBeCloseTo(-33.3, 0);
  });
});
