/**
 * auto-register-parse-url.test.ts
 * POST /api/auto-register/parse-url — 인증·파싱·소스별 분기 검증
 *
 * 실제 DB/외부 API 없이 mock으로 핵심 분기를 모두 커버한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auto-register/url-parser', () => ({
  parseSourceUrl: vi.fn(),
}));

vi.mock('@/lib/sourcing/domeggook-client', () => ({
  getDomeggookClient: vi.fn(),
}));

vi.mock('@/lib/sourcing/costco-client', () => ({
  fetchCostcoProduct: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockParseSourceUrl = parseSourceUrl as ReturnType<typeof vi.fn>;
const mockGetDomeggookClient = getDomeggookClient as ReturnType<typeof vi.fn>;
const mockFetchCostcoProduct = fetchCostcoProduct as ReturnType<typeof vi.fn>;

// ── route handler 동적 import (mock 설정 후) ──────────────────────────────
const { POST } = await import('@/app/api/auto-register/parse-url/route');

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auto-register/parse-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request('http://localhost/api/auto-register/parse-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ invalid json',
  });
}

const VALID_DOMEGGOOK_URL = 'https://domeggook.com/product/detail/123456';
const VALID_COSTCO_URL = 'https://www.costco.co.kr/p/PROD-001';
const UNRELATED_URL = 'https://example.com/product/123';

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────

const domeggookParsed = { source: 'domeggook' as const, itemId: '123456' };
const costcoParsed = { source: 'costco' as const, itemId: 'PROD-001' };

const domeggookItemDetail = {
  basis: { title: '도매꾹 테스트 상품' },
  price: { dome: 15000, resale: { Recommand: 25000 } },
  thumb: { original: 'https://img.domeggook.com/test.jpg' },
  desc: { contents: { item: '<p>상품 설명</p>' } },
  seller: { nick: '테스트판매자' },
  category: { current: { name: '생활용품' } },
};

const costcoItem = {
  title: '코스트코 테스트 상품',
  price: 20000,
  originalPrice: 25000,
  imageUrl: 'https://img.costco.co.kr/test.jpg',
  brand: '코스트코브랜드',
  categoryName: '식품',
};

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('POST /api/auto-register/parse-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본: 인증 통과
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ────────────────────────────────────────────────────────────────

  describe('인증', () => {
    it('인증 실패 시 401을 반환한다', async () => {
      mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

      const res = await POST(makeRequest({ url: VALID_DOMEGGOOK_URL }) as never);
      expect(res.status).toBe(401);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('인증이 필요합니다.');
    });
  });

  // ── 입력 검증 ────────────────────────────────────────────────────────────

  describe('입력 검증', () => {
    it('유효하지 않은 JSON이면 400을 반환한다', async () => {
      const res = await POST(makeInvalidJsonRequest() as never);
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('유효한 JSON 형식이 아닙니다.');
    });

    it('url 필드 없으면 400을 반환한다', async () => {
      const res = await POST(makeRequest({}) as never);
      expect(res.status).toBe(400);
    });

    it('url이 유효한 URL 형식이 아니면 400을 반환한다', async () => {
      const res = await POST(makeRequest({ url: 'not-a-url' }) as never);
      expect(res.status).toBe(400);
    });
  });

  // ── URL 파싱 ─────────────────────────────────────────────────────────────

  describe('URL 파싱', () => {
    it('지원하지 않는 URL이면 422를 반환한다', async () => {
      mockParseSourceUrl.mockReturnValue(null);

      const res = await POST(makeRequest({ url: UNRELATED_URL }) as never);
      expect(res.status).toBe(422);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('지원하지 않는 URL');
    });
  });

  // ── 도매꾹 분기 ──────────────────────────────────────────────────────────

  describe('도매꾹 분기', () => {
    beforeEach(() => {
      mockParseSourceUrl.mockReturnValue(domeggookParsed);
    });

    it('도매꾹 상품 정상 반환 시 200 + product를 반환한다', async () => {
      const mockClient = { getItemView: vi.fn().mockResolvedValue(domeggookItemDetail) };
      mockGetDomeggookClient.mockReturnValue(mockClient);

      const res = await POST(makeRequest({ url: VALID_DOMEGGOOK_URL }) as never);
      expect(res.status).toBe(200);
      const data = await res.json() as { product: { source: string; title: string } };
      expect(data.product.source).toBe('domeggook');
      expect(data.product.title).toBe('도매꾹 테스트 상품');
    });

    it('itemId가 NaN이면 422를 반환한다', async () => {
      mockParseSourceUrl.mockReturnValue({ source: 'domeggook', itemId: 'abc' });

      const res = await POST(makeRequest({ url: VALID_DOMEGGOOK_URL }) as never);
      expect(res.status).toBe(422);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('유효하지 않은 도매꾹 상품 번호');
    });

    it('도매꾹 상품을 찾을 수 없으면 404를 반환한다', async () => {
      const mockClient = { getItemView: vi.fn().mockResolvedValue(null) };
      mockGetDomeggookClient.mockReturnValue(mockClient);

      const res = await POST(makeRequest({ url: VALID_DOMEGGOOK_URL }) as never);
      expect(res.status).toBe(404);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('도매꾹 상품을 찾을 수 없습니다');
    });

    it('도매꾹 API 오류 시 404를 반환한다', async () => {
      // 구현이 Promise.allSettled를 사용하므로 getItemView reject → apiRes.status === 'rejected'
      // → "도매꾹 상품을 찾을 수 없습니다." 404 반환 (500이 아님)
      const mockClient = { getItemView: vi.fn().mockRejectedValue(new Error('API Error')) };
      mockGetDomeggookClient.mockReturnValue(mockClient);

      const res = await POST(makeRequest({ url: VALID_DOMEGGOOK_URL }) as never);
      expect(res.status).toBe(404);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('도매꾹 상품을 찾을 수 없습니다');
    });
  });

  // ── 코스트코 분기 ─────────────────────────────────────────────────────────

  describe('코스트코 분기', () => {
    beforeEach(() => {
      mockParseSourceUrl.mockReturnValue(costcoParsed);
    });

    it('코스트코 상품 정상 반환 시 200 + product를 반환한다', async () => {
      mockFetchCostcoProduct.mockResolvedValue(costcoItem);

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      expect(res.status).toBe(200);
      const data = await res.json() as { product: { source: string; title: string } };
      expect(data.product.source).toBe('costco');
      expect(data.product.title).toBe('코스트코 테스트 상품');
    });

    it('코스트코 상품을 찾을 수 없으면 404를 반환한다', async () => {
      mockFetchCostcoProduct.mockResolvedValue(null);

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      expect(res.status).toBe(404);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('코스트코 상품을 찾을 수 없습니다');
    });

    it('코스트코 API 오류 시 500을 반환한다', async () => {
      mockFetchCostcoProduct.mockRejectedValue(new Error('Network Error'));

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      expect(res.status).toBe(500);
    });

    it('코스트코 상품 응답에 detailHtml 필드가 포함된다', async () => {
      mockFetchCostcoProduct.mockResolvedValue(costcoItem);

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { detailHtml?: string } };

      expect(data.product.detailHtml).toBeDefined();
      expect(typeof data.product.detailHtml).toBe('string');
      expect((data.product.detailHtml ?? '').length).toBeGreaterThan(10);
    });

    it('코스트코 상품 detailHtml은 제품명을 HTML 요소로 포함한다', async () => {
      mockFetchCostcoProduct.mockResolvedValue(costcoItem);

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { detailHtml?: string } };

      expect(data.product.detailHtml).toContain('코스트코 테스트 상품');
    });

    it('코스트코 상품 detailHtml은 이미지 URL을 포함한다', async () => {
      mockFetchCostcoProduct.mockResolvedValue(costcoItem);

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { detailHtml?: string } };

      expect(data.product.detailHtml).toContain('img.costco.co.kr/test.jpg');
    });

    it('galleryImages가 있으면 imageUrls에 포함된다', async () => {
      mockFetchCostcoProduct.mockResolvedValue({
        ...costcoItem,
        galleryImages: [
          'https://img.costco.co.kr/gallery1.jpg',
          'https://img.costco.co.kr/gallery2.jpg',
        ],
      });

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { imageUrls?: string[] } };

      expect(data.product.imageUrls).toContain('https://img.costco.co.kr/gallery1.jpg');
      expect(data.product.imageUrls).toContain('https://img.costco.co.kr/gallery2.jpg');
    });

    it('galleryImages가 있으면 detailHtml에 갤러리 이미지가 포함된다', async () => {
      mockFetchCostcoProduct.mockResolvedValue({
        ...costcoItem,
        galleryImages: ['https://img.costco.co.kr/gallery1.jpg'],
      });

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { detailHtml?: string } };

      expect(data.product.detailHtml).toContain('img.costco.co.kr/gallery1.jpg');
    });

    it('OCC description이 있으면 detailHtml에 포함된다', async () => {
      mockFetchCostcoProduct.mockResolvedValue({
        ...costcoItem,
        description: '고품질 코스트코 제품입니다. 신선하게 배송됩니다.',
      });

      const res = await POST(makeRequest({ url: VALID_COSTCO_URL }) as never);
      const data = await res.json() as { product: { detailHtml?: string; description?: string } };

      expect(data.product.detailHtml).toContain('고품질 코스트코 제품입니다');
      expect(data.product.description).toContain('고품질 코스트코 제품입니다');
    });
  });
});
