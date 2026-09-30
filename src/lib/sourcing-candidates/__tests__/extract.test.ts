import { describe, it, expect } from 'vitest';
import { NAVER_PAGE_SCHEMA, NAVER_PROMPT, naverJsonSchema } from '@/lib/sourcing-candidates/extract-naver';
import { OFFER_SCHEMA, offerPrompt, offerJsonSchema } from '@/lib/sourcing-candidates/extract-1688';

const naverSample = {
  screen: 'naver_list', sort_bar_seen: true,
  category_path: '주방용품 > 도마', sort_label: '판매 많은순',
  products: [{
    row: 0, col: 0, title: '테르헨 국산 스텐도마 316 스테인레스 주방도마 43x25cm', seller: '테르헨',
    price: 41300, list_price: null, discount_pct: null, review_count: 3831, rating: 4.77, badges: [],
  }],
};

describe('NAVER_PAGE_SCHEMA', () => {
  it('도마 캡처 1위 카드를 통과시킨다', () => {
    expect(NAVER_PAGE_SCHEMA.safeParse(naverSample).success).toBe(true);
  });
  it('price가 없으면 거부 — 순위·거름망의 근거다', () => {
    const broken = { ...naverSample, products: [{ ...naverSample.products[0], price: null }] };
    expect(NAVER_PAGE_SCHEMA.safeParse(broken).success).toBe(false);
  });
  it('API용 스키마에 정수 제약이 없다', () => {
    expect(JSON.stringify(naverJsonSchema())).not.toMatch(/minimum|maximum/);
  });
  it('프롬프트가 추천 블록·잘린 카드·로딩 칸을 다룬다', () => {
    expect(NAVER_PROMPT).toMatch(/정렬 바/);
    expect(NAVER_PROMPT).toMatch(/잘려/);
    expect(NAVER_PROMPT).toMatch(/로딩/);
  });
});

describe('OFFER_SCHEMA', () => {
  it('같은 물건 판정을 필수로 받는다', () => {
    const ok = {
      screen: '1688', title_cn: '皮革车把套', tiers: [{ min_qty: 2, cny: 9.2 }], options: [],
      sold_count: 22, sale_unit: '件', match_verdict: 'diff', match_reason: '판매 단위가 한 짝일 수 있음',
    };
    expect(OFFER_SCHEMA.safeParse(ok).success).toBe(true);
    expect(OFFER_SCHEMA.safeParse({ ...ok, match_verdict: undefined }).success).toBe(false);
  });
  it('프롬프트에 대상 네이버 상품이 들어간다', () => {
    const p = offerPrompt({ title: '가죽 핸들 토시', price: 14390 });
    expect(p).toContain('가죽 핸들 토시');
    expect(p).toContain('14,390');
    expect(p).toMatch(/판매 단위/);
  });
  it('API용 스키마', () => {
    expect(JSON.stringify(offerJsonSchema())).not.toMatch(/minimum|maximum/);
  });
});
