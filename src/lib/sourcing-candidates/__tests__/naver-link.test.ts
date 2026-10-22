import { describe, it, expect } from 'vitest';
import { naverSearchUrl, listingHref } from '@/lib/sourcing-candidates/naver-link';

const SEARCH_BASE = 'https://search.shopping.naver.com/search/all?query=';

describe('naverSearchUrl', () => {
  it('끝의 말줄임표(…)를 지운다', () => {
    const url = naverSearchUrl({ seller: '테르헨', title: '테르헨 316 스테인레스…' });
    expect(url).toBe(`${SEARCH_BASE}${encodeURIComponent('테르헨 316 스테인레스')}`);
  });

  it('끝의 말줄임표(...)를 지운다', () => {
    const url = naverSearchUrl({ seller: '테르헨', title: '테르헨 316 스테인레스...' });
    expect(url).toBe(`${SEARCH_BASE}${encodeURIComponent('테르헨 316 스테인레스')}`);
  });

  it('제목이 이미 판매자로 시작하면 판매자를 또 붙이지 않는다', () => {
    const url = naverSearchUrl({ seller: '테르헨', title: '테르헨 316 스테인레스 도마' });
    expect(url).toBe(`${SEARCH_BASE}${encodeURIComponent('테르헨 316 스테인레스 도마')}`);
  });

  it('제목이 판매자로 시작하지 않으면 판매자를 앞에 붙인다', () => {
    const url = naverSearchUrl({ seller: '들꽃잠', title: '행복 눈 찜질팩 핑크' });
    expect(url).toBe(`${SEARCH_BASE}${encodeURIComponent('들꽃잠 행복 눈 찜질팩 핑크')}`);
  });

  it('공백을 한 칸으로 합친다', () => {
    const url = naverSearchUrl({ seller: '들꽃잠', title: '들꽃잠  행복   눈찜질팩' });
    expect(url).toBe(`${SEARCH_BASE}${encodeURIComponent('들꽃잠 행복 눈찜질팩')}`);
  });

  it('한글·공백을 인코딩한다(공백은 %20)', () => {
    const url = naverSearchUrl({ seller: '들꽃잠', title: '들꽃잠 행복 눈찜질팩' });
    expect(url).toContain('%20');
    expect(url).not.toContain(' ');
  });
});

describe('listingHref', () => {
  it('naver_url이 있으면 그걸 그대로 쓴다(검색 링크로 만들지 않는다)', () => {
    const href = listingHref({ seller: '테르헨', title: '테르헨 316 스테인레스…', naver_url: 'https://shopping.naver.com/products/123' });
    expect(href).toBe('https://shopping.naver.com/products/123');
  });

  it('naver_url이 없으면 검색 링크로 대신한다', () => {
    const href = listingHref({ seller: '테르헨', title: '테르헨 316 스테인레스', naver_url: null });
    expect(href).toBe(`${SEARCH_BASE}${encodeURIComponent('테르헨 316 스테인레스')}`);
  });
});
