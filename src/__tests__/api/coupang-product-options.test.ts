import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/listing/coupang-client', () => ({ getCoupangClient: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetCoupangClient = getCoupangClient as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(sellerProductId?: string): NextRequest {
  const url = sellerProductId
    ? `http://localhost/api/cost-management/coupang-product-options?sellerProductId=${sellerProductId}`
    : `http://localhost/api/cost-management/coupang-product-options`;
  return new NextRequest(url);
}

describe('GET /api/cost-management/coupang-product-options', () => {
  let mockGetProductDetail: ReturnType<typeof vi.fn>;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' });

    mockGetProductDetail = vi.fn().mockResolvedValue({
      sellerProductName: '테스트 상품',
      items: [
        { vendorItemId: 111, itemName: '옐로우', salePrice: 15000 },
        { vendorItemId: 222, itemName: '블루', salePrice: 15000 },
      ],
    });
    mockGetCoupangClient.mockReturnValue({ getProductDetail: mockGetProductDetail });

    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ vendor_item_id: '111' }], // 111은 이미 추가됨
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('123'));
    expect(res.status).toBe(401);
  });

  it('sellerProductId 없으면 400', async () => {
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it('productName과 options 반환, alreadyAdded 마킹', async () => {
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('16182237839'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.productName).toBe('테스트 상품');
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({ vendorItemId: '111', alreadyAdded: true });
    expect(json.data[1]).toMatchObject({ vendorItemId: '222', alreadyAdded: false });
  });

  it('vendorItemId가 0인 항목 필터링', async () => {
    mockGetProductDetail.mockResolvedValue({
      sellerProductName: '테스트',
      items: [
        { vendorItemId: 0, itemName: '옵션없음', salePrice: 0 },
        { vendorItemId: 333, itemName: '그린', salePrice: 15000 },
      ],
    });
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('999'));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].vendorItemId).toBe('333');
  });
});
