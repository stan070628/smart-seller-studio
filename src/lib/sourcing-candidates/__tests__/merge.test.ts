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
    // B는 A와 리뷰 수를 다르게 둔다 — 값이 전부 같으면(제목 한 글자 차이) 새 퍼지 겹침
    // 판정에 우연히 걸릴 수 있는데, 이 테스트가 보려는 것은 그 경로가 아니다.
    const r = mergePages([
      page({ sort_bar_seen: true, category_path: '건강/의료용품 > 냉온/찜질용품', sort_label: '판매 많은순',
        products: [card({ row: 0, col: 0, title: 'A' }), card({ row: 1, col: 4, ...dup })] }),
      page({ products: [card({ row: 0, col: 0, ...dup }), card({ row: 0, col: 1, title: 'B', review_count: 999 })] }),
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

  describe('조각 경계 오독 — 값은 같은데 이름이 살짝 다르게 읽힌 겹침', () => {
    // 실측(2026-09-27 컨트롤러 E2E): 인접 조각에서 같은 카드가 판매자명·상품명을
    // 한두 글자 다르게 읽혔다. 가격·리뷰 수·평점이 모두 같고 정규화한 이름의
    // 편집거리가 3 이하이면 같은 카드로 본다.
    //
    // 퍼지 판정은 "같은 조각에서 완전 일치가 확인된 행"까지만 허용하므로, 같은 행에
    // 완전히 겹치는 닻(anchor) 카드를 하나 같이 둔다 — 실제 캡처에서도 겹친 행에는
    // 오독 없이 그대로 읽힌 카드가 같이 있었다.
    function merged2(prev: Partial<ExtractedListing>, cur: Partial<ExtractedListing>) {
      const anchor = { seller: '앵커셀러', title: '앵커 상품', price: 9999, review_count: 1, rating: 4.0 };
      return mergePages([
        page({ products: [card({ row: 0, col: 0, ...prev }), card({ row: 0, col: 1, ...anchor })] }),
        page({ products: [card({ row: 0, col: 0, ...cur }), card({ row: 0, col: 1, ...anchor })] }),
      ]);
    }

    it('짐샌더스 vs 짐샌더슨(같은 판매자·오리지니크)', () => {
      const r = merged2(
        { seller: '오리지니크', title: '짐샌더스 테라조 컬러 커팅보드', price: 40400, review_count: 216, rating: 4.8 },
        { seller: '오리지니크', title: '짐샌더슨 테라조 컬러 커팅보드', price: 40400, review_count: 216, rating: 4.8 },
      );
      expect(r.listings).toHaveLength(2); // 오리지니크 카드 1 + 앵커 카드 1
    });

    it('더샤키친 vs 더사키친(판매자명만 한 글자 차이·제목 동일)', () => {
      const r = merged2(
        { seller: '더샤키친', title: '국산 업소용 도마 횟집 정육 식당 고기 영업용 칼라', price: 15500, review_count: 493, rating: 4.84 },
        { seller: '더사키친', title: '국산 업소용 도마 횟집 정육 식당 고기 영업용 칼라', price: 15500, review_count: 493, rating: 4.84 },
      );
      expect(r.listings).toHaveLength(2);
    });

    it('럭키카아 vs 럭키아울(Keep Fruit)', () => {
      const r = merged2(
        { seller: 'Keep Fruit', title: '럭키카아 국산 순면 복부 팥 어깨 현미 세트 찜질팩', price: 25800, review_count: 15040, rating: 4.81 },
        { seller: 'Keep Fruit', title: '럭키아울 국산 순면 복부 팥 어깨 현미 세트 찜질팩', price: 25800, review_count: 15040, rating: 4.81 },
      );
      expect(r.listings).toHaveLength(2);
    });

    it('프란īcz vs 프란프란(같은 제목, list_price 오독은 무시)', () => {
      const r = merged2(
        { seller: '프란īcz', title: '상품', price: 26800, review_count: 2528, rating: 4.86, list_price: 28000 },
        { seller: '프란프란', title: '상품', price: 26800, review_count: 2528, rating: 4.86, list_price: 28800 },
      );
      expect(r.listings).toHaveLength(2);
    });
  });

  describe('퍼지 겹침의 오탐 방지 — 색상 변형 상품을 지우지 않는다', () => {
    it('변형 상품이 겹침 구간 밖(앞 조각의 겹침 없는 자리)에 있으면 둘 다 남긴다', () => {
      // p-1: Q(row0, 겹침 확인용) + 블루(row5, 겹침 구간 밖의 형제 상품).
      // p: Q'(row0, Q의 완전 겹침 사본) + 핑크(row1, 블루와 값은 같고 이름만 다름).
      // 완전 일치는 row0에서만 확인됐으므로(maxExactRow=0), row1의 핑크는 퍼지 판정
      // 대상이 아니다 — 블루와 값이 같아도 지우면 안 된다.
      const q = { seller: '판매자', title: 'Q 상품', price: 5000, review_count: 3, rating: 4.2 };
      const blue = { seller: '판매자', title: '쿠션 블루', price: 12000, review_count: 88, rating: 4.7 };
      const pink = { seller: '판매자', title: '쿠션 핑크', price: 12000, review_count: 88, rating: 4.7 };
      const r = mergePages([
        page({ products: [card({ row: 0, col: 0, ...q }), card({ row: 5, col: 0, ...blue })] }),
        page({ products: [card({ row: 0, col: 0, ...q }), card({ row: 1, col: 0, ...pink })] }),
      ]);
      const titles = r.listings.map((l) => l.title);
      expect(titles).toContain(blue.title);
      expect(titles).toContain(pink.title);
      expect(r.listings).toHaveLength(3); // Q(중복 제거 후 1) + 블루 + 핑크
    });

    it('완전 일치 카드가 퍼지 카드보다 뒤에 나와도(열 순서) 자기 짝을 먼저 가져간다 — 퍼지가 훔치지 않는다', () => {
      // p-1: X 1장. p: 핑크(row0,col0, X와 퍼지 매치되지만 실제로는 다른 상품) +
      // X의 완전 사본(row0,col1). 완전 일치를 먼저 처리하지 않으면 핑크가 먼저
      // X를 가로채, X의 완전 사본은 갈 곳이 없어 새 상품으로 잘못 남는다.
      const x = { seller: '판매자', title: '상품 블루', price: 10000, review_count: 50, rating: 4.5 };
      const pinkVariant = { seller: '판매자', title: '상품 핑크', price: 10000, review_count: 50, rating: 4.5 };
      const r = mergePages([
        page({ products: [card({ row: 0, col: 0, ...x })] }),
        page({ products: [
          card({ row: 0, col: 0, ...pinkVariant }),
          card({ row: 0, col: 1, ...x }), // X의 완전 겹침 사본
        ] }),
      ]);
      expect(r.listings.map((l) => l.title)).toEqual([x.title, pinkVariant.title]);
    });
  });

  it('같은 조각 안의 비슷한 카드는 퍼지 겹침으로 합치지 않는다 — 다른 상품이다(집앤콕)', () => {
    const r = mergePages([
      page({ products: [
        card({ row: 0, col: 0, seller: '집앤콕', title: '다린홈 집앤콕 찜질팩 어깨 배 복부 허리 온열찜질팩', price: 29900, review_count: 747, rating: 4.96 }),
        card({ row: 0, col: 1, seller: '집앤콕', title: '집앤콕 찜질팩 어깨 배 복부 허리 온열찜질팩 브라운', price: 29900, review_count: 747, rating: 4.96 }),
      ] }),
    ]);
    expect(r.listings).toHaveLength(2);
  });

  it('값이 같아도 인접 조각에서 제목이 크게 다르면 다른 상품으로 남긴다', () => {
    const r = mergePages([
      page({ products: [card({ row: 0, col: 0, seller: '판매자', title: '완전히 다른 첫 번째 상품명 텍스트', price: 19900, review_count: 100, rating: 4.5 })] }),
      page({ products: [card({ row: 0, col: 0, seller: '판매자', title: '전혀 관계없는 두 번째 물건 이름', price: 19900, review_count: 100, rating: 4.5 })] }),
    ]);
    expect(r.listings).toHaveLength(2);
  });
});
