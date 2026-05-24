/**
 * costco-lookup-handler.test.ts
 * GET /api/sourcing/costco/lookup 핸들러 통합 테스트
 *
 * vi.mock으로 DB·OCC API·인증을 모두 격리해
 * 실제 라우트 핸들러를 실행하며 에러 경로를 포함한 전체 분기를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// 의존성 mock — import 보다 먼저 선언해야 hoisting이 적용된다
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn(),
}));

vi.mock('@/lib/sourcing/costco-client', () => ({
  fetchCostcoProduct: vi.fn(),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import { requireAuth } from '@/lib/supabase/auth';

const mockGetSourcingPool = getSourcingPool as ReturnType<typeof vi.fn>;
const mockFetchCostcoProduct = fetchCostcoProduct as ReturnType<typeof vi.fn>;
const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;

// 핸들러는 mock 설정 후 동적으로 import
const { GET } = await import('@/app/api/sourcing/costco/lookup/route');

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(code?: string): NextRequest {
  const url = new URL(
    `http://localhost/api/sourcing/costco/lookup${code !== undefined ? `?code=${code}` : ''}`,
  );
  return new NextRequest(url);
}

/** DB에서 상품이 발견될 때 반환하는 mock 행 */
const DB_ROW = {
  product_code: '1234567',
  title: 'Test',
  price: 32900,
  image_url: null,
  category_name: null,
  average_rating: null,
  review_count: 0,
  unit_price_label: null,
  unit_price: null,
  market_lowest_price: null,
  market_unit_price: null,
  product_url: 'https://costco.co.kr',
  unit_type: null,
  total_quantity: null,
  is_active: true,
};

/** OCC API가 상품을 반환할 때 사용하는 mock 객체 */
const OCC_PRODUCT = {
  productCode: '1234567',
  title: 'OCC Product',
  price: 32900,
  imageUrl: null,
  categoryName: null,
  averageRating: null,
  reviewCount: 0,
  productUrl: 'https://costco.co.kr',
};

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/sourcing/costco/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본값: 인증 통과
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  it('requireAuth가 Response를 반환하면 그 401 응답을 그대로 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(401);
    // DB나 OCC API가 호출되지 않아야 한다
    expect(mockGetSourcingPool).not.toHaveBeenCalled();
    expect(mockFetchCostcoProduct).not.toHaveBeenCalled();
  });

  it('code 파라미터가 누락(null)이면 400을 반환한다', async () => {
    // code 쿼리 파라미터 없이 요청
    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('문자를 포함한 코드(ABC123)이면 400을 반환한다', async () => {
    const res = await GET(makeRequest('ABC123'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('DB에서 상품을 찾으면 source:"db"로 200을 반환하고 fetchCostcoProduct는 호출하지 않는다', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [DB_ROW] });
    mockGetSourcingPool.mockReturnValue({ query: mockQuery });

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('db');
    expect(body.productCode).toBe('1234567');
    expect(body.title).toBe('Test');
    // OCC API는 호출되지 않아야 한다
    expect(mockFetchCostcoProduct).not.toHaveBeenCalled();
  });

  it('DB에 상품이 없고 OCC API가 null을 반환하면 404를 반환한다', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockGetSourcingPool.mockReturnValue({ query: mockQuery });
    mockFetchCostcoProduct.mockResolvedValue(null);

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('DB에 상품이 없고 OCC API가 상품을 반환하면 source:"api"로 200을 반환한다', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockGetSourcingPool.mockReturnValue({ query: mockQuery });
    mockFetchCostcoProduct.mockResolvedValue(OCC_PRODUCT);

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('api');
    expect(body.productCode).toBe('1234567');
    expect(body.title).toBe('OCC Product');
  });

  it('DB에 상품이 없고 OCC API가 throw하면 500을 반환한다', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    mockGetSourcingPool.mockReturnValue({ query: mockQuery });
    mockFetchCostcoProduct.mockRejectedValue(new Error('OCC error'));

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('DB 자체가 throw하면 500을 반환하고 OCC API는 호출하지 않는다', async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error('DB error'));
    mockGetSourcingPool.mockReturnValue({ query: mockQuery });

    const res = await GET(makeRequest('1234567'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // DB가 실패했으므로 OCC API를 호출해서는 안 된다
    expect(mockFetchCostcoProduct).not.toHaveBeenCalled();
  });
});
