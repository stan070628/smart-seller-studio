import { describe, it, expect } from 'vitest';
import { buildListingView, offerCny } from '@/lib/sourcing-candidates/view';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

const listing: ListingRow = {
  id: 'l1', scan_id: 's1', rank: 1, title: '가죽 핸들 토시', seller: '체니모', price: 14390,
  list_price: null, discount_pct: null, review_count: 812, rating: 4.8, badges: [], number_check: null,
  starred: true, excluded_override: null, memo: null, size: 'small', price_override: null, category_path: null,
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
});
