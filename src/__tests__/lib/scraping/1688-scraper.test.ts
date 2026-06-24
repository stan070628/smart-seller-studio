import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted()로 호이스팅 안전하게 모킹 변수 선언
const {
  mockClose,
  mockEvaluate,
  mockGoto,
  mockUrl,
  mockWaitForSelector,
  mockNewPage,
  mockLaunch,
} = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockEvaluate = vi.fn();
  const mockGoto = vi.fn().mockResolvedValue(null);
  const mockUrl = vi.fn().mockReturnValue('https://detail.1688.com/offer/123.html');
  const mockWaitForSelector = vi.fn().mockResolvedValue(null);
  const mockNewPage = vi.fn().mockResolvedValue({
    goto: mockGoto,
    url: mockUrl,
    evaluate: mockEvaluate,
    waitForSelector: mockWaitForSelector,
  });
  const mockLaunch = vi.fn().mockResolvedValue({
    newPage: mockNewPage,
    close: mockClose,
  });
  return { mockClose, mockEvaluate, mockGoto, mockUrl, mockWaitForSelector, mockNewPage, mockLaunch };
});

vi.mock('puppeteer-core', () => ({ default: { launch: mockLaunch } }));

import { scrape1688 } from '@/lib/scraping/1688-scraper';

beforeEach(() => {
  vi.clearAllMocks();
  mockGoto.mockResolvedValue(null);
  mockUrl.mockReturnValue('https://detail.1688.com/offer/123.html');
  mockNewPage.mockResolvedValue({
    goto: mockGoto,
    url: mockUrl,
    evaluate: mockEvaluate,
    waitForSelector: mockWaitForSelector,
  });
  mockLaunch.mockResolvedValue({ newPage: mockNewPage, close: mockClose });
});

describe('scrape1688', () => {
  it('window JSON state에서 상품명과 스펙을 추출한다', async () => {
    mockEvaluate.mockImplementation((fn: Function) => {
      return Promise.resolve({
        found: true,
        productName: '코튼 오버핏 티셔츠',
        specs: [
          { label: '소재', value: '면 100%' },
          { label: '사이즈', value: 'M, L, XL' },
        ],
      });
    });
    mockWaitForSelector.mockResolvedValue(null);

    const result = await scrape1688('https://detail.1688.com/offer/123.html');

    expect(result.productName).toBe('코튼 오버핏 티셔츠');
    expect(result.specs).toHaveLength(2);
    expect(result.specs[0]).toEqual({ label: '소재', value: '면 100%' });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('JSON state 실패 시 DOM fallback으로 추출한다', async () => {
    mockEvaluate
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({
        productName: '지퍼백 4.5L',
        specs: [{ label: '용량', value: '4.5L' }],
      });

    const result = await scrape1688('https://detail.1688.com/offer/456.html');

    expect(result.productName).toBe('지퍼백 4.5L');
    expect(result.specs[0].label).toBe('용량');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('캡차/로그인 페이지 감지 시 에러를 던진다', async () => {
    mockUrl.mockReturnValue('https://login.1688.com/member/signin.htm');

    await expect(scrape1688('https://detail.1688.com/offer/789.html'))
      .rejects.toThrow('로그인');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('스펙 0개이면 빈 배열을 반환한다 (에러 아님)', async () => {
    mockEvaluate
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ productName: '알 수 없는 상품', specs: [] });

    const result = await scrape1688('https://detail.1688.com/offer/000.html');
    expect(result.specs).toHaveLength(0);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('각 스펙 value를 200자로 자른다', async () => {
    const longValue = 'A'.repeat(250);
    mockEvaluate.mockResolvedValueOnce({
      found: true,
      productName: '테스트',
      specs: [{ label: '설명', value: longValue }],
    });

    const result = await scrape1688('https://detail.1688.com/offer/111.html');
    expect(result.specs[0].value.length).toBeLessThanOrEqual(200);
  });

  it('스펙을 최대 20개로 제한한다', async () => {
    const manySpecs = Array.from({ length: 30 }, (_, i) => ({
      label: `항목${i}`, value: `값${i}`,
    }));
    mockEvaluate.mockResolvedValueOnce({
      found: true,
      productName: '테스트',
      specs: manySpecs,
    });

    const result = await scrape1688('https://detail.1688.com/offer/222.html');
    expect(result.specs.length).toBeLessThanOrEqual(20);
  });
});
