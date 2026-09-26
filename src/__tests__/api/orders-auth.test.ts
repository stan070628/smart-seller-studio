// src/__tests__/api/orders-auth.test.ts
// 주문 조회 라우트는 구매자 정보를 돌려준다 — 로그인하지 않으면 채널 API를 부르기 전에 401이어야 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, clientCalled } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  clientCalled: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/dashboard/orders-cache', () => ({
  getOrdersCache: vi.fn(async () => null),
  setOrdersCache: vi.fn(async () => undefined),
}));
vi.mock('@/lib/listing/coupang-client', () => ({
  getCoupangClient: () => { clientCalled('coupang'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: () => { clientCalled('naver'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/listing/toss-shopping-client', () => ({
  getTossShoppingClient: () => { clientCalled('toss'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/proxy-fetch', () => ({ proxyFetch: vi.fn() }));

type Handler = { GET: (req: NextRequest) => Promise<Response> };
const ROUTES: [string, () => Promise<Handler>][] = [
  ['coupang', () => import('@/app/api/orders/coupang/route')],
  ['coupang-rg', () => import('@/app/api/orders/coupang-rg/route')],
  ['naver', () => import('@/app/api/orders/naver/route')],
  ['naver/debug', () => import('@/app/api/orders/naver/debug/route')],
  ['toss', () => import('@/app/api/orders/toss/route')],
];

describe('주문 조회 라우트 인증', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(null);
  });

  it.each(ROUTES)('%s — 로그인하지 않으면 401이고 채널 API를 부르지 않는다', async (name, load) => {
    const { GET } = await load();
    const res = await GET(new NextRequest(`http://localhost/api/orders/${name}`));
    expect(res.status).toBe(401);
    expect(clientCalled).not.toHaveBeenCalled();
  });
});
