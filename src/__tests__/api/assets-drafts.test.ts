/**
 * GET/POST /api/listing/assets/drafts 단위 테스트
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

const { GET, POST } = await import('@/app/api/listing/assets/drafts/route');

function makeGet(): NextRequest {
  return new NextRequest('http://localhost/api/listing/assets/drafts', { method: 'GET' });
}
function makePost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/listing/assets/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// SELECT: from → select → eq → order → limit
function buildSelectMock(result: { data: unknown; error: null | { message: string } }) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  };
}

// INSERT: from → insert → select → single
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: 'test-user-id' });
});

describe('GET /api/listing/assets/drafts', () => {
  it('인증 없으면 requireAuth가 반환한 401 Response를 그대로 반환한다', async () => {
    mockAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: '인증 필요' }), { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('임시저장 목록을 200으로 반환한다', async () => {
    const rows = [
      { id: 'uuid-1', name: '작업1', draft_data: { mode: 'url' }, created_at: '2026-05-10T00:00:00Z' },
    ];
    mockGetSupabase.mockReturnValue(buildSelectMock({ data: rows, error: null }));

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0].id).toBe('uuid-1');
    expect(body.drafts[0].name).toBe('작업1');
    expect(body.drafts[0].draftData).toEqual({ mode: 'url' });
  });

  it('DB 오류 시 500을 반환한다', async () => {
    mockGetSupabase.mockReturnValue(
      buildSelectMock({ data: null, error: { message: 'DB connection failed' } }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/listing/assets/drafts', () => {
  it('name 없으면 400을 반환한다', async () => {
    const res = await POST(makePost({ draftData: {} }));
    expect(res.status).toBe(400);
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it('draftData 없으면 400을 반환한다', async () => {
    const res = await POST(makePost({ name: '작업1' }));
    expect(res.status).toBe(400);
  });

  it('정상 저장 시 201과 id를 반환한다', async () => {
    mockGetSupabase.mockReturnValue(
      buildInsertMock({ data: { id: 'new-uuid' }, error: null }),
    );
    const res = await POST(makePost({ name: '작업1', draftData: { mode: 'url', url: 'https://example.com' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('new-uuid');
  });

  it('유효하지 않은 JSON body 시 400을 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/listing/assets/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('DB 오류 시 500을 반환한다', async () => {
    mockGetSupabase.mockReturnValue(
      buildInsertMock({ data: null, error: { message: 'insert failed' } }),
    );
    const res = await POST(makePost({ name: '작업1', draftData: { mode: 'url' } }));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/listing/assets/drafts/[id] 테스트
// ─────────────────────────────────────────────────────────────

// DELETE 체인: from → delete → eq → eq
function buildDeleteMock(result: { error: null | { message: string } }) {
  return {
    from: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  };
}

const { DELETE } = await import('@/app/api/listing/assets/drafts/[id]/route');

function makeDeleteReq(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/listing/assets/drafts/${id}`, { method: 'DELETE' });
}
function makeDeleteCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/listing/assets/drafts/[id]', () => {
  it('인증 없으면 401을 반환한다', async () => {
    mockAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: '인증 필요' }), { status: 401 }),
    );
    const res = await DELETE(makeDeleteReq('uuid-1'), makeDeleteCtx('uuid-1'));
    expect(res.status).toBe(401);
  });

  it('존재하지 않는 id면 404를 반환한다', async () => {
    mockGetSupabase.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
            }),
          }),
        }),
      }),
    });
    const res = await DELETE(makeDeleteReq('no-such-id'), makeDeleteCtx('no-such-id'));
    expect(res.status).toBe(404);
  });

  it('정상 삭제 시 200을 반환한다', async () => {
    // 소유권 확인용 SELECT mock
    const ownerMock = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
            }),
          }),
        }),
      }),
    };
    const deleteMock = buildDeleteMock({ error: null });

    mockGetSupabase
      .mockReturnValueOnce(ownerMock)
      .mockReturnValueOnce(deleteMock);

    const res = await DELETE(makeDeleteReq('uuid-1'), makeDeleteCtx('uuid-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
