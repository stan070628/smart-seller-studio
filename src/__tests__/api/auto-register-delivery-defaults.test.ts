/**
 * auto-register-delivery-defaults.test.ts
 * GET /api/auto-register/delivery-defaults — 인증·환경변수 반환 검증
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;

const { GET } = await import('@/app/api/auto-register/delivery-defaults/route');

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function makeRequest(): Request {
  return new Request('http://localhost/api/auto-register/delivery-defaults', {
    method: 'GET',
  });
}

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('GET /api/auto-register/delivery-defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('인증이 필요합니다.');
  });

  // ── 환경변수 반환 ─────────────────────────────────────────────────────────

  it('환경변수가 설정된 경우 200과 코드를 반환한다', async () => {
    const originalOutbound = process.env.COUPANG_OUTBOUND_CODE;
    const originalReturn = process.env.COUPANG_RETURN_CENTER_CODE;

    process.env.COUPANG_OUTBOUND_CODE = 'OUTBOUND_123';
    process.env.COUPANG_RETURN_CENTER_CODE = 'RETURN_456';

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      outboundShippingPlaceCode: string;
      returnCenterCode: string;
    };
    expect(data.outboundShippingPlaceCode).toBe('OUTBOUND_123');
    expect(data.returnCenterCode).toBe('RETURN_456');

    process.env.COUPANG_OUTBOUND_CODE = originalOutbound;
    process.env.COUPANG_RETURN_CENTER_CODE = originalReturn;
  });

  it('환경변수가 없는 경우 빈 문자열을 반환한다', async () => {
    const originalOutbound = process.env.COUPANG_OUTBOUND_CODE;
    const originalReturn = process.env.COUPANG_RETURN_CENTER_CODE;

    delete process.env.COUPANG_OUTBOUND_CODE;
    delete process.env.COUPANG_RETURN_CENTER_CODE;

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      outboundShippingPlaceCode: string;
      returnCenterCode: string;
    };
    expect(data.outboundShippingPlaceCode).toBe('');
    expect(data.returnCenterCode).toBe('');

    process.env.COUPANG_OUTBOUND_CODE = originalOutbound;
    process.env.COUPANG_RETURN_CENTER_CODE = originalReturn;
  });
});
