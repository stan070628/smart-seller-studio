import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { expandKeywords } from '@/lib/naver-ad';

beforeEach(() => {
  vi.stubEnv('NAVER_AD_API_KEY', 'test-key');
  vi.stubEnv('NAVER_AD_SECRET_KEY', 'test-secret');
  vi.stubEnv('NAVER_AD_CUSTOMER_ID', '123');
  vi.stubEnv('NAVER_CLIENT_ID', 'client-id');
  vi.stubEnv('NAVER_CLIENT_SECRET', 'client-secret');
});

describe('expandKeywords', () => {
  it('씨드에서 관련 키워드를 확장해 KeywordStat[]을 반환한다', async () => {
    // 검색광고 API mock (관련 키워드 반환)
    server.use(
      http.get('https://api.searchad.naver.com/keywordstool', () => {
        return HttpResponse.json({
          keywordList: [
            { relKeyword: '캠핑의자', monthlyPcQcCnt: 3000, monthlyMobileQcCnt: 5000 },
            { relKeyword: '접이식의자', monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 2000 },
          ],
        });
      }),
      // 네이버 쇼핑 mock (경쟁상품수) — 키워드별 순차 응답
      http.get('https://openapi.naver.com/v1/search/shop.json', ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get('query');
        const total = query === '캠핑의자' ? 300 : 600;
        return HttpResponse.json({ total });
      }),
    );

    const result = await expandKeywords(['캠핑']);
    expect(result).toHaveLength(2);
    expect(result[0].keyword).toBe('캠핑의자');
    expect(result[0].searchVolume).toBe(8000);
    expect(result[0].competitorCount).toBe(300);
    expect(result[1].competitorCount).toBe(600);
  });

  it('API 키 없으면 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_AD_API_KEY', '');
    const result = await expandKeywords(['캠핑']);
    expect(result).toEqual([]);
  });

  it('5개 초과 씨드는 배치로 나눠 요청한다', async () => {
    // 요청 URL을 기록하기 위한 배열
    const capturedUrls: string[] = [];

    server.use(
      http.get('https://api.searchad.naver.com/keywordstool', ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({ keywordList: [] });
      }),
    );

    await expandKeywords(['a', 'b', 'c', 'd', 'e', 'f']);
    const adCalls = capturedUrls.filter((url) => url.includes('keywordstool'));
    expect(adCalls).toHaveLength(2);
  });
});
