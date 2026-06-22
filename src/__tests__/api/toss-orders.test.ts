import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock: toss-shopping-client ─────────────────────────────────
const mockGetOrders = vi.fn();
vi.mock('@/lib/listing/toss-shopping-client', () => ({
  getTossShoppingClient: () => ({ getOrders: mockGetOrders }),
}));

// ─── Mock: orders-cache ─────────────────────────────────────────
const mockGetOrdersCache = vi.fn();
const mockSetOrdersCache = vi.fn();
vi.mock('@/lib/dashboard/orders-cache', () => ({
  getOrdersCache: mockGetOrdersCache,
  setOrdersCache: mockSetOrdersCache,
}));

// ─── 테스트용 주문 픽스처 ─────────────────────────────────────────
const ORDER_FIXTURE = {
  orderId: 1001,
  orderProductId: 2001,
  orderedAt: '2026-06-15T10:00:00Z',
  ordererName: '홍길동',
  ordererPhone: '01012345678',
  productName: '테스트 상품',
  optionName: '블랙/L',
  quantity: 2,
  price: 30000,
  receiverName: '김철수',
  receiverPhone: '01087654321',
  address: '서울시 강남구 테헤란로 1',
  detailAddress: '101동 202호',
  zipCode: '06234',
  deliveryCompanyCode: 'CJ',
  shippingTrackingNumber: '1234567890',
  deliveryFee: 0,
  orderProductStatus: 'PAID',
  canceledAt: null,
  confirmedAt: null,
};

describe('GET /api/orders/toss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrdersCache.mockResolvedValue(null); // 캐시 미스 기본값
    mockSetOrdersCache.mockResolvedValue(undefined);
  });

  it('기본 7일 범위로 주문을 조회하고 내림차순 정렬 반환한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    const olderOrder = { ...ORDER_FIXTURE, orderProductId: 2000, orderedAt: '2026-06-10T08:00:00Z' };
    const newerOrder = { ...ORDER_FIXTURE, orderProductId: 2001, orderedAt: '2026-06-15T10:00:00Z' };
    mockGetOrders.mockResolvedValue([olderOrder, newerOrder]);

    const req = new NextRequest('http://localhost/api/orders/toss');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.items).toHaveLength(2);
    // 내림차순: 최신 주문이 먼저
    expect(json.data.items[0].orderedAt).toBe('2026-06-15T10:00:00Z');
    expect(json.data.items[1].orderedAt).toBe('2026-06-10T08:00:00Z');
  });

  it('캐시 히트 시 클라이언트를 호출하지 않는다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    const cachedItems = [ORDER_FIXTURE];
    mockGetOrdersCache.mockResolvedValue(cachedItems);

    const req = new NextRequest('http://localhost/api/orders/toss?from=2026-06-01&to=2026-06-07');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.items).toEqual(cachedItems);
    expect(mockGetOrders).not.toHaveBeenCalled();
  });

  it('API 오류 시 success: false와 500 반환한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    mockGetOrders.mockRejectedValue(new Error('토스쇼핑 주문 조회 실패 (INVALID_REQUEST): 날짜 범위 초과'));

    const req = new NextRequest('http://localhost/api/orders/toss');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('토스쇼핑 주문 조회 실패');
  });

  it('주문이 있을 때 캐시에 저장한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    mockGetOrders.mockResolvedValue([ORDER_FIXTURE]);

    const req = new NextRequest('http://localhost/api/orders/toss?from=2026-06-01&to=2026-06-07');
    await GET(req);

    expect(mockSetOrdersCache).toHaveBeenCalledWith(
      'orders:toss:2026-06-01:2026-06-07',
      expect.any(Array),
    );
  });
});
