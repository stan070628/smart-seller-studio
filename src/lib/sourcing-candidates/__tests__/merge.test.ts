import { describe, it, expect } from 'vitest';
import { dedupKey, mergePages } from '@/lib/sourcing-candidates/merge';
import type { ExtractedListing, ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

function card(over: Partial<ExtractedListing>): ExtractedListing {
  return {
    row: 0, col: 0, title: '상품', seller: '판매자', price: 10000,
    list_price: null, discount_pct: null, review_count: 10, rating: 4.8, badges: [],
    ...over,
  };
}
function page(over: Partial<ExtractedNaverPage>): ExtractedNaverPage {
  return { screen: 'naver_list', sort_bar_seen: false, category_path: null, sort_label: null, products: [], ...over };
}

describe('dedupKey', () => {
  it('공백·말줄임표·대소문자를 무시한다', () => {
    expect(dedupKey(card({ seller: '들꽃잠 ', title: '들꽃잠 행복 눈 찜질팩...' })))
      .toBe(dedupKey(card({ seller: '들꽃잠', title: '들꽃잠 행복 눈찜질팩…' })));
  });
  it('가격이 다르면 다른 상품', () => {
    expect(dedupKey(card({ price: 25200 }))).not.toBe(dedupKey(card({ price: 25900 })));
  });
  it('구두점(., · …)이 중간에 있어도 같은 키', () => {
    expect(dedupKey(card({ title: '들꽃잠 행복 눈 찜질팩, 1개..' })))
      .toBe(dedupKey(card({ title: '들꽃잠 행복 눈 찜질팩 1개…' })));
  });
});

describe('mergePages', () => {
  it('겹친 카드는 한 번만, 순위는 먼저 나온 자리', () => {
    const dup = { seller: '들꽃잠', title: '들꽃잠 행복 눈 찜질팩 핑크, 1개', price: 25200 };
    const r = mergePages([
      page({ sort_bar_seen: true, category_path: '건강/의료용품 > 냉온/찜질용품', sort_label: '판매 많은순',
        products: [card({ row: 0, col: 0, title: 'A' }), card({ row: 1, col: 4, ...dup })] }),
      page({ products: [card({ row: 0, col: 0, ...dup }), card({ row: 0, col: 1, title: 'B' })] }),
    ]);
    expect(r.listings.map((l) => l.title)).toEqual(['A', dup.title, 'B']);
    expect(r.listings.map((l) => l.rank)).toEqual([1, 2, 3]);
    expect(r.category_path).toBe('건강/의료용품 > 냉온/찜질용품');
    expect(r.sort_label).toBe('판매 많은순');
  });

  it('한 조각 안에서는 행 우선·왼쪽부터 순위를 매긴다', () => {
    const r = mergePages([page({ products: [
      card({ row: 1, col: 0, title: 'C' }), card({ row: 0, col: 1, title: 'B' }), card({ row: 0, col: 0, title: 'A' }),
    ] })]);
    expect(r.listings.map((l) => l.title)).toEqual(['A', 'B', 'C']);
  });

  it('정렬 바가 처음 보인 조각보다 앞 조각의 상품은 버린다 — 추천 블록이다', () => {
    const r = mergePages([
      page({ products: [card({ title: '광고' })] }),
      page({ sort_bar_seen: true, products: [card({ title: '1위' })] }),
    ]);
    expect(r.listings.map((l) => l.title)).toEqual(['1위']);
  });

  it('정렬 바가 어디에도 없으면(중간 스크롤 캡처) 전부 쓴다', () => {
    const r = mergePages([page({ products: [card({ title: 'X' })] })]);
    expect(r.listings).toHaveLength(1);
  });

  it('숫자 검증 결과를 줄에 싣는다', () => {
    const r = mergePages([page({ products: [card({ price: 12200, list_price: 15200, discount_pct: 50 })] })]);
    expect(r.listings[0].number_check).toMatch(/할인율/);
  });

  it('같은 페이지 안에서 키가 겹치면 서로 다른 상품으로 보고 #2를 붙인다', () => {
    const same = { seller: '판매자', title: '상품', price: 10000 };
    const r = mergePages([
      page({ products: [card({ row: 0, col: 0, ...same }), card({ row: 0, col: 1, ...same })] }),
    ]);
    expect(r.listings).toHaveLength(2);
    expect(r.listings.map((l) => l.dedup_key)).toEqual([dedupKey(card(same)), `${dedupKey(card(same))}#2`]);
  });

  it('다음 조각에 같은 키가 이전 조각보다 더 많이 나오면, 겹친 만큼만 버리고 나머지는 남긴다', () => {
    // page1에 K 1개, page2에 K가 2개(첫 번째는 겹침 사본, 두 번째는 실제 다른 상품).
    const k = { seller: '판매자', title: '상품', price: 10000 };
    const r = mergePages([
      page({ products: [card({ row: 0, col: 0, ...k })] }),
      page({ products: [card({ row: 0, col: 0, ...k }), card({ row: 0, col: 1, ...k })] }),
    ]);
    expect(r.listings.map((l) => l.dedup_key)).toEqual([dedupKey(card(k)), `${dedupKey(card(k))}#2`]);
  });
});
