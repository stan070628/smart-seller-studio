import { describe, it, expect } from 'vitest';
import { parseSourceUrl } from '../url-parser';

describe('parseSourceUrl', () => {
  it('도매꾹 상품 상세 URL에서 itemId를 추출한다', () => {
    const result = parseSourceUrl('https://www.domeggook.com/product/detail/12345678');
    expect(result).toEqual({ source: 'domeggook', itemId: '12345678' });
  });

  it('도매꾹 모바일 URL도 처리한다', () => {
    const result = parseSourceUrl('https://m.domeggook.com/product/detail/87654321');
    expect(result).toEqual({ source: 'domeggook', itemId: '87654321' });
  });

  it('코스트코 코리아 /p/ URL에서 productCode를 추출한다', () => {
    const result = parseSourceUrl('https://www.costco.co.kr/p/123456');
    expect(result).toEqual({ source: 'costco', itemId: '123456' });
  });

  it('코스트코 쿼리스트링 포함 URL도 처리한다', () => {
    const result = parseSourceUrl('https://www.costco.co.kr/p/123456?foo=bar');
    expect(result).toEqual({ source: 'costco', itemId: '123456' });
  });

  it('지원하지 않는 URL은 null을 반환한다', () => {
    expect(parseSourceUrl('https://www.naver.com/product/123')).toBeNull();
  });

  it('빈 문자열은 null을 반환한다', () => {
    expect(parseSourceUrl('')).toBeNull();
  });

  it('도매꾹 단축 URL(숫자만) 형식에서 itemId를 추출한다', () => {
    const result = parseSourceUrl('https://domeggook.com/58847698');
    expect(result).toEqual({ source: 'domeggook', itemId: '58847698' });
  });

  it('www 포함 도매꾹 단축 URL도 처리한다', () => {
    const result = parseSourceUrl('https://www.domeggook.com/58847698');
    expect(result).toEqual({ source: 'domeggook', itemId: '58847698' });
  });
});
