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

  it('하위 경로는 경로 전체를 식별자로 쓴다 — 부모와 별개 탭이 된다', () => {
    expect(routeIdOf('/listing/detail-maker')).toBe('listing/detail-maker');
  });

  it('부모와 하위 경로는 서로 다른 식별자를 갖는다', () => {
    expect(routeIdOf('/listing')).not.toBe(routeIdOf('/listing/detail-maker'));
  });

  it('쿼리가 붙어도 경로 전체를 식별자로 쓴다', () => {
    expect(routeIdOf('/listing/detail-maker?draftId=42')).toBe('listing/detail-maker');
  });

  it('루트는 dashboard로 본다', () => {
    expect(routeIdOf('/')).toBe('dashboard');
  });

  it('해시 프래그먼트를 무시한다', () => {
    expect(routeIdOf('/orders#top')).toBe('orders');
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

  it('형제 경로가 하위 항목 라벨을 훔치지 않는다', () => {
    expect(labelForHref('/listing/detail-maker-pro')).toBe('상품등록');
  });

  it('부모 경로 자체는 부모 라벨을 쓴다', () => {
    expect(labelForHref('/listing')).toBe('상품등록');
  });

  it('부모 서브트리 밖에 있는 하위 항목도 찾는다', () => {
    expect(labelForHref('/editor')).toBe('에디터');
  });

  it('루트는 대시보드 라벨을 쓴다', () => {
    expect(labelForHref('/')).toBe('대시보드');
  });

  it('중복 슬래시를 정규화한다', () => {
    expect(labelForHref('//listing')).toBe('상품등록');
  });

  it('NAV_ITEMS에 없는 하위 경로는 EXTRA_LABEL_RULES에서 구분되는 라벨을 얻는다', () => {
    expect(labelForHref('/listing/auto-register')).toBe('쿠팡 자동등록');
    expect(labelForHref('/listing/import-1688')).toBe('1688에서 가져오기');
  });

  it('동적 세그먼트가 낀 경로도 EXTRA_LABEL_RULES로 매칭된다', () => {
    expect(labelForHref('/listing/abc123/detail-maker-pro')).toBe('PRO 상세페이지 만들기');
  });

  it('형제 하위 경로끼리 라벨이 겹치지 않는다 — 탭이 분리됐을 때 서로 구분돼야 한다', () => {
    const labels = [
      labelForHref('/listing/auto-register'),
      labelForHref('/listing/import-1688'),
      labelForHref('/listing/detail-maker'),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('EXTRA_LABEL_RULES가 부모 항목의 접두사 매칭보다 우선한다', () => {
    // /listing 접두사에 먼저 걸리면 전부 "상품등록"이 되어버린다
    expect(labelForHref('/listing/auto-register')).not.toBe('상품등록');
  });
});
