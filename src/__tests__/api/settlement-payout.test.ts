/**
 * GET /api/settlement/payout?month= — 쿠팡 지급 확정 조회
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/listing/coupang-client', () => ({ getCoupangClient: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

const mockUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockClient = getCoupangClient as ReturnType<typeof vi.fn>;

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/payout?${qs}`);
}

describe('GET settlement/payout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
  });

  it('month 형식 틀리면 400', async () => {
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-7'));
    expect(res.status).toBe(400);
  });

  it('지급 데이터 있으면 payout 반환', async () => {
    mockClient.mockReturnValue({
      getSettlementHistories: vi.fn().mockResolvedValue({
        finalAmount: 12450000, settlementTargetAmount: 13500000, serviceFee: 1500000,
        settlementDate: '2026-08-03', status: 'SUBJECT',
      }),
    });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.payout.finalAmount).toBe(12450000);
    expect(json.payout.settlementDate).toBe('2026-08-03');
  });

  it('데이터 없으면 payout null', async () => {
    mockClient.mockReturnValue({ getSettlementHistories: vi.fn().mockResolvedValue(null) });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payout).toBeNull();
  });

  it('API 실패해도 500 대신 payout null', async () => {
    mockClient.mockReturnValue({ getSettlementHistories: vi.fn().mockRejectedValue(new Error('coupang down')) });
    const { GET } = await import('@/app/api/settlement/payout/route');
    const res = await GET(req('month=2026-07'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payout).toBeNull();
  });
});
