import { describe, it, expect } from 'vitest';
import { matchAdProduct } from './match';
import type { RawProduct } from './types';

function makeProduct(name: string, overrides: Partial<RawProduct> = {}): RawProduct {
  return {
    name,
    sellerProductId: '0',
    isItemWinner: false,
    stock: 0,
    salePrice: 0,
    monthlySales: 0,
    imageViolation: false,
    ...overrides,
  };
}

describe('matchAdProduct', () => {
  it('완전 일치 이름으로 매칭된다', () => {
    const products = [makeProduct('사과 주스 500ml'), makeProduct('오렌지 주스 500ml')];
    const result = matchAdProduct(products, '사과 주스 500ml');
    expect(result?.name).toBe('사과 주스 500ml');
  });

  it('앞 10자 prefix가 포함되면 매칭된다', () => {
    const products = [makeProduct('사과 주스 500ml 냉장 보관 제품')];
    // '사과 주스 50'가 adProduct 이름에 포함됨
    const result = matchAdProduct(products, '사과 주스 500ml');
    expect(result).toBeDefined();
  });

  it('상품명에 adProduct 이름 prefix가 포함되면 매칭된다', () => {
    const adName = '사과 주스 500'; // 10자
    const products = [makeProduct(adName)];
    const result = matchAdProduct(products, '사과 주스 500ml 대용량 냉장');
    expect(result?.name).toBe(adName);
  });

  it('일치하는 상품이 없으면 undefined를 반환한다', () => {
    const products = [makeProduct('포도 주스 500ml')];
    const result = matchAdProduct(products, '사과 주스 500ml');
    expect(result).toBeUndefined();
  });

  it('빈 배열이면 undefined를 반환한다', () => {
    expect(matchAdProduct([], '사과 주스 500ml')).toBeUndefined();
  });

  it('완전 일치가 prefix 매칭보다 우선한다', () => {
    const exactMatch = makeProduct('사과 주스');
    const fuzzyMatch = makeProduct('사과 주스 500ml 대용량');
    const products = [fuzzyMatch, exactMatch]; // 순서 반대로
    const result = matchAdProduct(products, '사과 주스');
    expect(result?.name).toBe('사과 주스');
  });
});
