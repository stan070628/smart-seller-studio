import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sourcing/domeggook-client', () => ({
  getDomeggookClient: vi.fn(),
}));

import { extractItemNoFromUrl, parseDomeggookUrl } from '@/lib/sourcing/domeggook-url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

describe('extractItemNoFromUrl', () => {
  it('정상 도매꾹 URL → itemNo 추출', () => {
    const cases: [string, number][] = [
      ['https://domeggook.com/main/item.php?id=12345678', 12345678],
      ['https://www.domeggook.com/main/item.php?id=99999', 99999],
      ['https://domeggook.com/main/item.php?id=12345&abc=def', 12345],
      ['http://domeggook.com/main/item.php?id=1', 1],
    ];
    for (const [url, expected] of cases) {
      expect(extractItemNoFromUrl(url)).toBe(expected);
    }
  });

  it('지원 안 되는 URL → null', () => {
    const cases = [
      'https://1688.com/item/123',
      'https://aliexpress.com/i/123',
      'https://coupang.com/np/products/123',
      '',
      'not a url',
      'https://domeggook.com/main/index.php',
      'https://domeggook.com/main/item.php', // id 없음
    ];
    for (const url of cases) expect(extractItemNoFromUrl(url)).toBeNull();
  });
});

describe('parseDomeggookUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('URL 파싱 + getItemView 호출 → ProductInfo', async () => {
    const mockGetItemView = vi.fn().mockResolvedValue({
      basis: { no: 12345, title: '테스트 상품' },
      thumb: { original: 'https://example.com/img.jpg' },
      price: { dome: 5000, supply: 8000 },
    });
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: mockGetItemView,
    });

    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=12345');
    expect(result).toEqual({
      source: 'domeggook',
      title: '테스트 상품',
      image: 'https://example.com/img.jpg',
      price: 5000,
      supplyPrice: 8000,
      marketPrice: null,
      itemNo: 12345,
      url: 'https://domeggook.com/main/item.php?id=12345',
    });
  });

  it('비-도매꾹 URL → null', async () => {
    const result = await parseDomeggookUrl('https://1688.com/item/123');
    expect(result).toBeNull();
  });

  it('getItemView 실패 → null', async () => {
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(new Error('차단')),
    });

    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=12345');
    expect(result).toBeNull();
  });

  it('가격이 string으로 와도 number 변환', async () => {
    (getDomeggookClient as ReturnType<typeof vi.fn>).mockReturnValue({
      getItemView: vi.fn().mockResolvedValue({
        basis: { no: 1, title: 'a' },
        price: { dome: '5000', supply: '8000' },
      }),
    });
    const result = await parseDomeggookUrl('https://domeggook.com/main/item.php?id=1');
    expect(result?.price).toBe(5000);
    expect(result?.supplyPrice).toBe(8000);
  });
});
