/**
 * auto-register-save-corrections.test.ts
 * POST /api/auto-register/save-corrections — 인증·입력 검증·성공·오류 검증
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auto-register/learning-engine', () => ({
  saveCorrections: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { saveCorrections } from '@/lib/auto-register/learning-engine';
import type { FieldCorrection } from '@/lib/auto-register/types';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockSaveCorrections = saveCorrections as ReturnType<typeof vi.fn>;

const { POST } = await import('@/app/api/auto-register/save-corrections/route');

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auto-register/save-corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request('http://localhost/api/auto-register/save-corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
}

const sampleCorrections: FieldCorrection[] = [
  {
    sourceType: 'domeggook',
    fieldName: 'sellerProductName',
    aiValue: 'AI 추천 이름',
    acceptedValue: '사용자 수정 이름',
    wasCorrected: true,
  },
  {
    sourceType: 'domeggook',
    fieldName: 'salePrice',
    aiValue: '20000',
    acceptedValue: '20000',
    wasCorrected: false,
  },
];

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('POST /api/auto-register/save-corrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await POST(makeRequest({ corrections: sampleCorrections }) as never);
    expect(res.status).toBe(401);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('인증이 필요합니다.');
  });

  // ── 입력 검증 ────────────────────────────────────────────────────────────

  it('유효하지 않은 JSON이면 400을 반환한다', async () => {
    const res = await POST(makeInvalidJsonRequest() as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('corrections 배열');
  });

  it('corrections 필드가 없으면 400을 반환한다', async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('corrections 배열');
  });

  it('corrections가 배열이 아니면 400을 반환한다', async () => {
    const res = await POST(makeRequest({ corrections: 'not-an-array' }) as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('corrections 배열');
  });

  // ── 성공 ─────────────────────────────────────────────────────────────────

  it('유효한 corrections 배열이면 200과 ok:true를 반환한다', async () => {
    mockSaveCorrections.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ corrections: sampleCorrections }) as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(mockSaveCorrections).toHaveBeenCalledWith(sampleCorrections);
  });

  it('빈 배열도 200을 반환한다', async () => {
    mockSaveCorrections.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ corrections: [] }) as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  // ── 오류 ─────────────────────────────────────────────────────────────────

  it('saveCorrections 오류 시 500을 반환한다', async () => {
    mockSaveCorrections.mockRejectedValue(new Error('DB Error'));

    const res = await POST(makeRequest({ corrections: sampleCorrections }) as never);
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('수정사항 저장 중 오류');
  });
});
