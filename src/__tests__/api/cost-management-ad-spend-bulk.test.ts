/**
 * POST /api/cost-management/ad-spend/bulk
 * 쿠팡 광고 표 붙여넣기 → 하루치 광고비 일괄 저장 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/cost-management/ad-spend/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 매칭 쿼리는 resolve, 저장 쿼리는 insert로 분기해 응답을 흉내낸다 */
function poolWith(resolveRows: Record<string, unknown>[], insertRows: Record<string, unknown>[] = []) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO product_ad_spend_daily')) return Promise.resolve({ rows: insertRows });
    return Promise.resolve({ rows: resolveRows });
  });
  mockGetPool.mockReturnValue({ query });
  return query;
}

describe('POST /api/cost-management/ad-spend/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1', email: 't@e.com' });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    poolWith([]);
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({ ad_date: '2026-08-08', items: [{ external_id: '1', ad_spend: 1 }] }));
    expect(res.status).toBe(401);
  });

  it('ad_date 형식이 틀리면 400', async () => {
    poolWith([]);
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({ ad_date: '2026-08', items: [{ external_id: '1', ad_spend: 1 }] }));
    expect(res.status).toBe(400);
  });

  it('items가 비면 400', async () => {
    poolWith([]);
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({ ad_date: '2026-08-08', items: [] }));
    expect(res.status).toBe(400);
  });

  it('음수 광고비는 400', async () => {
    poolWith([]);
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({ ad_date: '2026-08-08', items: [{ external_id: '95', ad_spend: -1 }] }));
    expect(res.status).toBe(400);
  });

  it('매칭된 상품은 저장하고 안 된 상품은 unmatched로 돌려준다', async () => {
    const query = poolWith(
      [
        { external_id: '95373359497', product_id: 'p-1', product_name: '극세사 타월' },
        { external_id: '99999999999', product_id: null, product_name: null },
      ],
      [{ product_id: 'p-1' }],
    );
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({
      ad_date: '2026-08-08',
      items: [
        { external_id: '95373359497', ad_spend: 5016 },
        { external_id: '99999999999', ad_spend: 300 },
      ],
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.matched).toHaveLength(1);
    expect(json.data.unmatched).toEqual([{ external_id: '99999999999', ad_spend: 300 }]);
    expect(json.data.saved_products).toBe(1);
    expect(json.data.matched_total).toBe(5016);

    // 파라미터 순서: [userId, productIds, spends, impressions, clicks, adOrders, adRevenue, date]
    const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO product_ad_spend_daily'));
    expect(insertCall?.[1]?.[1]).toEqual(['p-1']);
    expect(insertCall?.[1]?.[2]).toEqual([5016]);
    expect(insertCall?.[1]?.[7]).toBe('2026-08-08');
  });

  it('노출·클릭·전환 지표를 함께 저장한다', async () => {
    const query = poolWith(
      [{ external_id: '95373359497', product_id: 'p-1', product_name: '극세사 타월' }],
      [{ product_id: 'p-1' }],
    );
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    await POST(makeRequest({
      ad_date: '2026-08-08',
      items: [{ external_id: '95373359497', ad_spend: 5016, impressions: 4673, clicks: 47, ad_orders: 3, ad_revenue: 38400 }],
    }));
    const args = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO product_ad_spend_daily'))?.[1];
    expect(args?.[3]).toEqual([4673]);  // impressions
    expect(args?.[4]).toEqual([47]);    // clicks
    expect(args?.[5]).toEqual([3]);     // ad_orders
    expect(args?.[6]).toEqual([38400]); // ad_revenue
  });

  it('지표가 없으면 0이 아니라 null로 저장한다 — 미수집과 0을 구분한다', async () => {
    const query = poolWith(
      [{ external_id: '95373359497', product_id: 'p-1', product_name: '극세사 타월' }],
      [{ product_id: 'p-1' }],
    );
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    await POST(makeRequest({
      ad_date: '2026-08-08',
      items: [{ external_id: '95373359497', ad_spend: 5016, impressions: null, clicks: null, ad_orders: null, ad_revenue: null }],
    }));
    const args = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO product_ad_spend_daily'))?.[1];
    expect(args?.[3]).toEqual([null]);
    expect(args?.[6]).toEqual([null]);
  });

  it('한 상품이 두 채널로 광고되면 합산해 한 번만 저장한다', async () => {
    const query = poolWith(
      [
        { external_id: '95268506578', product_id: 'p-1', product_name: '커클랜드 티셔츠' },
        { external_id: '95304537914', product_id: 'p-1', product_name: '커클랜드 티셔츠' },
      ],
      [{ product_id: 'p-1' }],
    );
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    await POST(makeRequest({
      ad_date: '2026-08-08',
      items: [
        { external_id: '95268506578', ad_spend: 1000 },
        { external_id: '95304537914', ad_spend: 500 },
      ],
    }));
    const args = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO product_ad_spend_daily'))?.[1];
    expect(args?.[1]).toEqual(['p-1']);
    expect(args?.[2]).toEqual([1500]);
  });

  it('dry_run이면 저장하지 않고 매칭 결과만 준다', async () => {
    const query = poolWith([{ external_id: '95373359497', product_id: 'p-1', product_name: '극세사 타월' }]);
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    const res = await POST(makeRequest({
      ad_date: '2026-08-08',
      dry_run: true,
      items: [{ external_id: '95373359497', ad_spend: 5016 }],
    }));
    const json = await res.json();
    expect(json.data.matched).toHaveLength(1);
    expect(json.data.saved_products).toBe(0);
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO'))).toBe(false);
  });

  it('0원도 저장한다 — 그날 광고를 안 돌린 사실을 기록한다', async () => {
    const query = poolWith(
      [{ external_id: '95661320049', product_id: 'p-2', product_name: '리본 파우치' }],
      [{ product_id: 'p-2' }],
    );
    const { POST } = await import('@/app/api/cost-management/ad-spend/bulk/route');
    await POST(makeRequest({ ad_date: '2026-08-08', items: [{ external_id: '95661320049', ad_spend: 0 }] }));
    const args = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO product_ad_spend_daily'))?.[1];
    expect(args?.[1]).toEqual(['p-2']);
    expect(args?.[2]).toEqual([0]);
  });
});
