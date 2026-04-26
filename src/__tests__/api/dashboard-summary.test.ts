/**
 * GET /api/dashboard/summary 통합 테스트
 * 외부 API/Supabase는 모두 mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/dashboard/product-count', () => ({
  countCoupangProducts: vi.fn(),
  countNaverProducts: vi.fn(),
}));
vi.mock('@/lib/listing/coupang-client', () => ({
  getCoupangClient: vi.fn(),
}));
vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: vi.fn(),
}));
vi.mock('@/lib/dashboard/settlement-clients', () => ({
  fetchCoupangSettlement: vi.fn(),
  fetchNaverSettlement: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { fetchCoupangSettlement, fetchNaverSettlement } from '@/lib/dashboard/settlement-clients';

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockCountCoupang = countCoupangProducts as ReturnType<typeof vi.fn>;
const mockCountNaver = countNaverProducts as ReturnType<typeof vi.fn>;
const mockCoupangClient = getCoupangClient as ReturnType<typeof vi.fn>;
const mockNaverClient = getNaverCommerceClient as ReturnType<typeof vi.fn>;
const mockSettleCoupang = fetchCoupangSettlement as ReturnType<typeof vi.fn>;
const mockSettleNaver = fetchNaverSettlement as ReturnType<typeof vi.fn>;

const { GET, _resetDashboardCacheForTests } = await import('@/app/api/dashboard/summary/route');

function makeRequest(period?: string): NextRequest {
  const url = period
    ? `http://localhost/api/dashboard/summary?period=${period}`
    : 'http://localhost/api/dashboard/summary';
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDashboardCacheForTests();
    mockAuth.mockResolvedValue({ userId: 'test-user' });
    mockCountCoupang.mockResolvedValue(312);
    mockCountNaver.mockResolvedValue(198);
    mockSettleCoupang.mockResolvedValue({ count: 0, amount: 0, available: false });
    mockSettleNaver.mockResolvedValue({ count: 0, amount: 0, available: false });
    mockCoupangClient.mockReturnValue({
      getOrders: vi.fn().mockImplementation(({ status }: { status: string }) =>
        Promise.resolve({
          items: status === 'ACCEPT'
            ? [{ orderId: 1, status: 'ACCEPT', orderItems: [{ orderPrice: 10000 }] }]
            : [],
          nextToken: null,
        }),
      ),
    });
    mockNaverClient.mockReturnValue({
      getOrders: vi.fn().mockResolvedValue({
        contents: [{ productOrderId: 'p1', productOrderStatus: 'PAYED', totalPaymentAmount: 5000 }],
      }),
    });
  });

  it('인증 실패 시 401을 반환한다', async () => {
    mockAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('잘못된 period는 400을 반환한다', async () => {
    const res = await GET(makeRequest('forever'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('기본 period=today로 응답 셰이프를 충족한다', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.products).toEqual({ coupang: 312, naver: 198 });
    expect(body.data.pipeline.coupang.주문.count).toBeGreaterThanOrEqual(0);
    expect(body.data.pipeline.naver.주문.count).toBeGreaterThanOrEqual(0);
    expect(body.data.revenue12w.weeks).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(body.data.revenue12w.target).toEqual([50,100,200,300,400,500,600,700,800,900,950,1000]);
    expect(body.data.revenue12w.actual).toEqual(new Array(12).fill(null));
    expect(body.data.pipeline.coupang.주문.amount).toBe(10000); // C2 regression guard
  });

  it('정산 실패 시 정산완료만 available:false로 떨어지고 다른 stage는 정상', async () => {
    mockSettleCoupang.mockRejectedValue(new Error('credentials missing'));
    const res = await GET(makeRequest('30d'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.pipeline.coupang.정산완료.available).toBe(false);
    expect(body.data.pipeline.coupang.주문).toBeDefined();
  });

  it('한 채널 주문 API 실패해도 다른 채널은 정상', async () => {
    mockCoupangClient.mockReturnValue({
      getOrders: vi.fn().mockRejectedValue(new Error('Coupang API down')),
    });
    const res = await GET(makeRequest('today'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.pipeline.coupang.주문.count).toBe(0);
    expect(body.data.pipeline.naver.주문.count).toBe(1);
  });
});
