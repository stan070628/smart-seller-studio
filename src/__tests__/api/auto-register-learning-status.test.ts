/**
 * auto-register-learning-status.test.ts
 * GET /api/auto-register/learning-status — sourceType 검증·성공·오류 검증
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auto-register/learning-engine', () => ({
  getAutoModeStatus: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { getAutoModeStatus } from '@/lib/auto-register/learning-engine';
import type { AutoModeStatus } from '@/lib/auto-register/types';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockGetAutoModeStatus = getAutoModeStatus as ReturnType<typeof vi.fn>;

const { GET } = await import('@/app/api/auto-register/learning-status/route');

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function makeRequest(sourceType?: string): NextRequest {
  const url = sourceType
    ? `http://localhost/api/auto-register/learning-status?sourceType=${sourceType}`
    : 'http://localhost/api/auto-register/learning-status';
  return new NextRequest(url, { method: 'GET' });
}

const availableStatus: AutoModeStatus = {
  isAvailable: true,
  fieldsTrusted: 9,
  fieldsTotal: 9,
  untrustedFields: [],
};

const partialStatus: AutoModeStatus = {
  isAvailable: false,
  fieldsTrusted: 6,
  fieldsTotal: 9,
  untrustedFields: ['displayCategoryCode', 'deliveryChargeType', 'searchTags'],
};

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('GET /api/auto-register/learning-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await GET(makeRequest('domeggook') as never);
    expect(res.status).toBe(401);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('인증이 필요합니다.');
  });

  // ── sourceType 검증 ──────────────────────────────────────────────────────

  it('sourceType 없으면 400을 반환한다', async () => {
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('sourceType');
  });

  it('sourceType=invalid이면 400을 반환한다', async () => {
    const res = await GET(makeRequest('naver') as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('domeggook');
  });

  // ── 성공 ─────────────────────────────────────────────────────────────────

  it('sourceType=domeggook이면 200과 status를 반환한다', async () => {
    mockGetAutoModeStatus.mockResolvedValue(availableStatus);

    const res = await GET(makeRequest('domeggook') as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { status: AutoModeStatus };
    expect(data.status.isAvailable).toBe(true);
    expect(data.status.fieldsTrusted).toBe(9);
    expect(mockGetAutoModeStatus).toHaveBeenCalledWith('domeggook');
  });

  it('sourceType=costco이면 200과 status를 반환한다', async () => {
    mockGetAutoModeStatus.mockResolvedValue(partialStatus);

    const res = await GET(makeRequest('costco') as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { status: AutoModeStatus };
    expect(data.status.isAvailable).toBe(false);
    expect(data.status.untrustedFields).toHaveLength(3);
    expect(mockGetAutoModeStatus).toHaveBeenCalledWith('costco');
  });

  // ── 오류 ─────────────────────────────────────────────────────────────────

  it('getAutoModeStatus 오류 시 500을 반환한다', async () => {
    mockGetAutoModeStatus.mockRejectedValue(new Error('Supabase Error'));

    const res = await GET(makeRequest('domeggook') as never);
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('학습 상태 조회 중 오류');
  });
});
