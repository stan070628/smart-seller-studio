/**
 * nav-items.test.ts
 * 경로에서 탭 식별자와 라벨을 유도하는 함수 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { routeIdOf, labelForHref } from '@/lib/nav-items';

describe('routeIdOf', () => {
  it('첫 경로 세그먼트를 식별자로 쓴다', () => {
    expect(routeIdOf('/sourcing')).toBe('sourcing');
  });

  it('쿼리스트링을 무시한다', () => {
    expect(routeIdOf('/sourcing?tab=discovery&page=3')).toBe('sourcing');
  });

  it('하위 경로도 첫 세그먼트로 묶는다', () => {
    expect(routeIdOf('/listing/detail-maker')).toBe('listing');
  });

  it('루트는 dashboard로 본다', () => {
    expect(routeIdOf('/')).toBe('dashboard');
  });
});

describe('labelForHref', () => {
  it('최상위 항목의 라벨을 찾는다', () => {
    expect(labelForHref('/orders')).toBe('주문/매출');
  });

  it('쿼리가 붙어도 찾는다', () => {
    expect(labelForHref('/orders?tab=cost')).toBe('주문/매출');
  });

  it('하위 항목이 있으면 더 구체적인 라벨을 쓴다', () => {
    expect(labelForHref('/listing/detail-maker')).toBe('상품상세 자동만들기');
  });

  it('등록되지 않은 경로는 식별자를 라벨로 쓴다', () => {
    expect(labelForHref('/unknown-page')).toBe('unknown-page');
  });
});
