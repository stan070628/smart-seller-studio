/**
 * GET /api/settlement/daily
 * 광고비가 product_ad_spend_daily 날짜 합계에서 주입되는지 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/daily?${qs}`);
}

describe('GET /api/settlement/daily — 광고비 소스', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
  });

  it('그날 상품별 광고비 합계가 adSpend로 반영', async () => {
    // Promise.all 순서: sales, entries, expenses(daily_expenses), adDaily, cancel(voided)
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { sold_at: '2026-07-17', sale_amount: '30000', selling_price: '30000', quantity: '1', coupon_discount: '0', platform_fee_rate: '0.1' },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { expense_date: '2026-07-17', ad_spend: '99999', box_cost: '0', parcel_cost: '0' },
      ] })
      .mockResolvedValueOnce({ rows: [
        { ad_date: '2026-07-17', ad_spend: '12000' },
      ] })
      .mockResolvedValueOnce({ rows: [
        { sold_at: '2026-07-17', amount: '5000' },
      ] });
    mockGetPool.mockReturnValue({ query: mockQuery });

    const { GET } = await import('@/app/api/settlement/daily/route');
    const res = await GET(req('from=2026-07-01&to=2026-07-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    const row = json.rows.find((r: { date: string }) => r.date === '2026-07-17');
    // daily_expenses.ad_spend(99999)은 무시, product_ad_spend_daily 합계(12000)만 반영
    expect(row.adSpend).toBe(12000);
    expect(row.netProfit).toBe(30000 - 3000 - 12000);
    // 취소분(voided)은 별도 라인, 순이익엔 영향 없음
    expect(row.cancelled).toBe(5000);
  });
});
