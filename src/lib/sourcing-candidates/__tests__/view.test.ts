import { describe, it, expect } from 'vitest';
import { buildListingView, offerCny, recentShare } from '@/lib/sourcing-candidates/view';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

const listing: ListingRow = {
  id: 'l1', scan_id: 's1', rank: 1, title: '가죽 핸들 토시', seller: '체니모', price: 14390,
  list_price: null, discount_pct: null, review_count: 812, rating: 4.8, badges: [], number_check: null,
  starred: true, excluded_override: null, memo: null, size: 'small', price_override: null, category_path: null,
  recent6m_review_count: null, recent6m_rating: null, naver_url: null,
};
function offer(over: Partial<OfferRow>): OfferRow {
  return {
    id: 'o1', listing_id: 'l1', image_paths: [], url: null, title_cn: null,
    tiers: [{ min_qty: 100, cny: 8.5 }, { min_qty: 2, cny: 9.2 }], options: [], sold_count: 22,
    sale_unit: '件', tier_check: null, match_verdict: 'same', match_reason: '', cny_override: null,
    adopted: false, parse_status: 'parsed', parse_error: null, ...over,
  };
}

describe('offerCny', () => {
  it('최소 주문 구간 단가를 쓴다', () => {
    expect(offerCny(offer({}))).toBe(9.2);
  });
  it('사람이 넣은 값이 이긴다', () => {
    expect(offerCny(offer({ cny_override: 7 }))).toBe(7);
  });
  it('구간가가 없으면 null', () => {
    expect(offerCny(offer({ tiers: [] }))).toBeNull();
  });
  it('tiers가 null이면 null', () => {
    expect(offerCny(offer({ tiers: null }))).toBeNull();
  });
});

describe('buildListingView', () => {
  it('채택 업체에 두 공식 판정이 붙는다', () => {
    const v = buildListingView(listing, [offer({ adopted: true })]);
    expect(v.adopted?.lecture?.pass).toBe(true);
    expect(v.adopted?.real?.margin).toBe(4533);
    expect(v.adopted?.daily).toBeCloseTo(22 / 180, 5);
  });
  it('판매가 수정값으로 판정한다', () => {
    const v = buildListingView({ ...listing, price_override: 9900 }, []);
    expect(v.flags).toContain('below_floor');
    expect(v.excluded).toBe(true);
    expect(v.effective_price).toBe(9900);
  });
  it('채택이 없으면 adopted는 null', () => {
    expect(buildListingView(listing, [offer({})]).adopted).toBeNull();
  });
  it('최근 6개월 리뷰·누적 리뷰가 있으면 recent_share를 계산한다 (도블레 도마: 2793/12066)', () => {
    const v = buildListingView(
      { ...listing, review_count: 12066, recent6m_review_count: 2793, recent6m_rating: 4.88 },
      [],
    );
    expect(v.recent_share).toBeCloseTo(2793 / 12066, 4);
  });
  it('recent6m_review_count가 없으면 recent_share는 null', () => {
    expect(buildListingView({ ...listing, recent6m_review_count: null }, []).recent_share).toBeNull();
  });
  it('누적 review_count가 null이면 recent_share는 null', () => {
    expect(buildListingView({ ...listing, review_count: null, recent6m_review_count: 10 }, []).recent_share).toBeNull();
  });
  it('누적 review_count가 0이면 recent_share는 null', () => {
    expect(buildListingView({ ...listing, review_count: 0, recent6m_review_count: 10 }, []).recent_share).toBeNull();
  });
});

describe('recentShare', () => {
  it('2793/12066 ≈ 0.2315', () => {
    expect(recentShare(2793, 12066)).toBeCloseTo(0.2315, 4);
  });
  it('recent이 null이면 null', () => {
    expect(recentShare(null, 12066)).toBeNull();
  });
  it('total이 null이면 null', () => {
    expect(recentShare(2793, null)).toBeNull();
  });
  it('total이 0이면 null', () => {
    expect(recentShare(2793, 0)).toBeNull();
  });
  it('recent이 total을 넘어도 그대로 둔다(오독 가능성은 UI가 표시)', () => {
    expect(recentShare(15000, 12066)).toBeGreaterThan(1);
  });
});
