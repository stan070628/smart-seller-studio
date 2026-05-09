/**
 * GET/POST/DELETE /api/label/templates 단위 테스트
 * Supabase와 requireAuth는 모두 mock 처리.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockGetSupabase = getSupabaseServerClient as ReturnType<typeof vi.fn>;

const { GET, POST, DELETE } = await import('@/app/api/label/templates/route');

// ─────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────

function makeGet(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/label/templates');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/label/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDelete(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/label/templates');
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString(), { method: 'DELETE' });
}

// ─────────────────────────────────────────
// Supabase 체이닝 mock 빌더
// ─────────────────────────────────────────

/** SELECT 체인: from → select → eq → eq → order */
function buildSelectMock(result: { data: unknown; error: null | { message: string } }) {
  const chain = {
    order: vi.fn().mockResolvedValue(result),
  };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(chain),
        }),
      }),
    }),
  };
}

/** INSERT 체인: from → insert → select → single */
function buildInsertMock(result: { data: unknown; error: null | { message: string } }) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  };
}

/** DELETE 체인: from → delete → eq → eq */
function buildDeleteMock(result: { error: null | { message: string } }) {
  const chain = {
    eq: vi.fn().mockResolvedValue(result),
  };
  return {
    from: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue(chain),
      }),
    }),
  };
}

// ─────────────────────────────────────────
// 공통 beforeEach
// ─────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: 'test-user-id' });
});

// ─────────────────────────────────────────
// GET 테스트
// ─────────────────────────────────────────

describe('GET /api/label/templates', () => {
  it('type=event 쿼리 시 event 타입 데이터를 반환한다 (status 200)', async () => {
    const fakeTemplates = [{ id: '1', label_type: 'event', name: '이벤트 템플릿' }];
    mockGetSupabase.mockReturnValue(buildSelectMock({ data: fakeTemplates, error: null }));

    const res = await GET(makeGet({ type: 'event' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toEqual(fakeTemplates);
  });

  it('type 파라미터 없으면 quality 타입으로 조회한다 (status 200)', async () => {
    const fakeTemplates = [{ id: '2', label_type: 'quality', name: '품질 템플릿' }];

    // eq('label_type', ...) 호출 인자를 캡처하기 위한 spy
    const capturedEqArgs: unknown[][] = [];
    const orderMock = vi.fn().mockResolvedValue({ data: fakeTemplates, error: null });
    const secondEqMock = vi.fn().mockReturnValue({ order: orderMock });
    const firstEqMock = vi.fn().mockReturnValue({ eq: (col: unknown, val: unknown) => {
      capturedEqArgs.push([col, val]);
      return secondEqMock(col, val);
    } });
    mockGetSupabase.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: (col: unknown, val: unknown) => {
            capturedEqArgs.push([col, val]);
            return { eq: (c: unknown, v: unknown) => {
              capturedEqArgs.push([c, v]);
              return { order: orderMock };
            } };
          },
        }),
      }),
    });

    const res = await GET(makeGet());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toEqual(fakeTemplates);

    // fallback label_type=quality로 eq가 호출됐는지 확인
    expect(capturedEqArgs.some(([col, val]) => col === 'label_type' && val === 'quality')).toBe(true);

    // firstEqMock은 이 테스트에서 직접 사용되지 않으므로 lint 억제
    void firstEqMock;
  });

  it('유효하지 않은 type(invalid)은 quality로 fallback한다 (status 200)', async () => {
    const capturedEqArgs: unknown[][] = [];
    const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockGetSupabase.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: (col: unknown, val: unknown) => {
            capturedEqArgs.push([col, val]);
            return { eq: (c: unknown, v: unknown) => {
              capturedEqArgs.push([c, v]);
              return { order: orderMock };
            } };
          },
        }),
      }),
    });

    const res = await GET(makeGet({ type: 'invalid' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toEqual([]);

    // 유효하지 않은 type이 quality로 fallback됐는지 확인
    expect(capturedEqArgs.some(([col, val]) => col === 'label_type' && val === 'quality')).toBe(true);
  });
});

// ─────────────────────────────────────────
// POST 테스트
// ─────────────────────────────────────────

describe('POST /api/label/templates', () => {
  it('name 없으면 400을 반환한다', async () => {
    const res = await POST(makePost({ labelType: 'quality', fields: {} }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('유효하지 않은 labelType이면 400을 반환한다', async () => {
    const res = await POST(makePost({ name: '테스트', labelType: 'unknown_type', fields: {} }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('정상 저장 시 201을 반환하고 template를 포함한다', async () => {
    const savedTemplate = {
      id: 'new-id',
      user_id: 'test-user-id',
      name: '새 템플릿',
      label_type: 'quality',
      fields: {},
      image_url: '',
      created_at: '2026-05-10T00:00:00Z',
    };
    mockGetSupabase.mockReturnValue(buildInsertMock({ data: savedTemplate, error: null }));

    const res = await POST(makePost({ name: '새 템플릿', labelType: 'quality', fields: {} }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.template).toEqual(savedTemplate);
  });
});

// ─────────────────────────────────────────
// DELETE 테스트
// ─────────────────────────────────────────

describe('DELETE /api/label/templates', () => {
  it('id 없으면 400을 반환한다', async () => {
    const res = await DELETE(makeDelete());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('id 있으면 200을 반환한다', async () => {
    mockGetSupabase.mockReturnValue(buildDeleteMock({ error: null }));

    const res = await DELETE(makeDelete({ id: 'template-uuid-123' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
