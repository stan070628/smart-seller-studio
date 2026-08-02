/**
 * draft-creative-state-fallback.test.ts
 *
 * creative_state 컬럼이 아직 없는 DB(마이그레이션 100 미적용)에서
 * POST/GET /api/detail-page/draft 가 42703(undefined_column)을 받았을 때
 * 그 필드만 제외하고 재시도해 나머지 저장/복원을 살려내는지 검증한다.
 * Supabase 호출은 체이닝 가능한 스텁으로 대체하고, 실제 네트워크/DB는 타지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ userId: 'user-test-001' })),
}));

// insert/update의 select(...).single() 응답 큐 — shift() 순서대로 소비된다.
let singleQueue: Array<{ data: unknown; error: unknown }> = [];
// GET의 select(...).order().limit().maybeSingle() 응답 큐.
let maybeSingleQueue: Array<{ data: unknown; error: unknown }> = [];

const insertRows: Record<string, unknown>[] = [];
const updateRows: Record<string, unknown>[] = [];
const selectArgs: string[] = [];

// undefined_column(42703) 에러 흉내 — 실제 Supabase/postgrest 에러 형태를 모사한다.
const CREATIVE_STATE_COLUMN_ERROR = {
  code: '42703',
  message: 'column "creative_state" of relation "detail_page_drafts" does not exist',
};

function makeChain() {
  const chain = {
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    select: vi.fn((cols: string) => {
      selectArgs.push(cols);
      return chain;
    }),
    single: vi.fn(() => Promise.resolve(singleQueue.shift() ?? { data: null, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve(maybeSingleQueue.shift() ?? { data: null, error: null })),
  };
  return chain;
}

const mockFrom = vi.fn(() => {
  const chain = makeChain();
  return {
    insert: vi.fn((row: Record<string, unknown>) => {
      insertRows.push(row);
      return chain;
    }),
    update: vi.fn((row: Record<string, unknown>) => {
      updateRows.push(row);
      return chain;
    }),
    select: chain.select,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({ from: mockFrom })),
}));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/detail-page/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/detail-page/draft — creative_state 컬럼 부재 폴백', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    singleQueue = [];
    maybeSingleQueue = [];
    insertRows.length = 0;
    updateRows.length = 0;
    selectArgs.length = 0;
  });

  it('신규 저장(insert) 중 42703을 받으면 creative_state를 뺀 페이로드로 재시도해 성공한다', async () => {
    singleQueue = [
      { data: null, error: { ...CREATIVE_STATE_COLUMN_ERROR } },
      { data: { id: 'draft-new-1' }, error: null },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { POST } = await import('@/app/api/detail-page/draft/route');
    const res = await POST(
      makeRequest({
        productName: '테스트 상품',
        sections: [],
        theme: {},
        creativeState: { referenceText: '참고 텍스트', brandName: 'QA브랜드' },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.id).toBe('draft-new-1');
    // 두 번 시도했고, 첫 시도에만 creative_state가 있었다.
    expect(insertRows).toHaveLength(2);
    expect(insertRows[0]).toHaveProperty('creative_state');
    expect(insertRows[1]).not.toHaveProperty('creative_state');
    // 나머지 필드는 재시도 페이로드에도 그대로 남아있어야 한다.
    expect(insertRows[1]).toMatchObject({ product_name: '테스트 상품' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('creative_state'), expect.anything());
  });

  it('기존 드래프트 갱신(update) 중 42703을 받으면 creative_state를 뺀 페이로드로 재시도해 성공한다', async () => {
    singleQueue = [
      { data: null, error: { ...CREATIVE_STATE_COLUMN_ERROR } },
      { data: { id: 'draft-1' }, error: null },
    ];
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { POST } = await import('@/app/api/detail-page/draft/route');
    const res = await POST(
      makeRequest({
        id: '11111111-1111-4111-8111-111111111111',
        sections: [],
        theme: {},
        creativeState: { category: 'fashion' },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe('draft-1');
    expect(updateRows).toHaveLength(2);
    expect(updateRows[0]).toHaveProperty('creative_state');
    expect(updateRows[1]).not.toHaveProperty('creative_state');
  });

  it('creative_state와 무관한 42703 오류는 재시도하지 않고 그대로 500을 반환한다', async () => {
    // 다른 컬럼이 없는 상황을 흉내 — creative_state 문자열이 메시지에 없으므로
    // isMissingCreativeStateColumn 판별을 통과하지 못해야 한다 (오판별로 다른 버그를 가리면 안 됨).
    singleQueue = [
      { data: null, error: { code: '42703', message: 'column "some_other_column" does not exist' } },
    ];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { POST } = await import('@/app/api/detail-page/draft/route');
    const res = await POST(
      makeRequest({ sections: [], theme: {}, creativeState: { referenceText: 'x' } }),
    );

    expect(res.status).toBe(500);
    // 재시도가 없었으므로 insert는 1번만 호출된다.
    expect(insertRows).toHaveLength(1);
  });

  it('creative_state 컬럼이 정상 존재하면(1번 시도로 성공) 재시도 경로를 타지 않는다', async () => {
    singleQueue = [{ data: { id: 'draft-new-2' }, error: null }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { POST } = await import('@/app/api/detail-page/draft/route');
    const res = await POST(
      makeRequest({ sections: [], theme: {}, creativeState: { referenceText: 'x' } }),
    );

    expect(res.status).toBe(201);
    expect(insertRows).toHaveLength(1);
    expect(insertRows[0]).toHaveProperty('creative_state');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/detail-page/draft — creative_state 컬럼 부재 폴백', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    singleQueue = [];
    maybeSingleQueue = [];
    insertRows.length = 0;
    updateRows.length = 0;
    selectArgs.length = 0;
  });

  it('42703을 받으면 creative_state 없이 재조회해 나머지 필드는 정상 복원한다', async () => {
    maybeSingleQueue = [
      { data: null, error: { ...CREATIVE_STATE_COLUMN_ERROR } },
      {
        data: {
          id: 'draft-1',
          listing_id: null,
          product_name: '테스트 상품',
          sections: [{ id: 's1', type: 'hero' }],
          theme: { palette: 'warm_cream' },
          thumbnail_url: null,
          updated_at: '2026-08-02T00:00:00.000Z',
          shoot_session: {},
          // creative_state 컬럼 자체가 없으므로 이 응답에는 아예 키가 없다.
        },
        error: null,
      },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { GET } = await import('@/app/api/detail-page/draft/route');
    const req = new NextRequest('http://localhost/api/detail-page/draft?id=11111111-1111-4111-8111-111111111111');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.draft.id).toBe('draft-1');
    expect(json.draft.productName).toBe('테스트 상품');
    expect(json.draft.sections).toEqual([{ id: 's1', type: 'hero' }]);
    expect(json.draft.creativeState).toBeUndefined();
    // 첫 조회는 creative_state를 포함, 재조회는 포함하지 않는다.
    expect(selectArgs[0]).toContain('creative_state');
    expect(selectArgs[1]).not.toContain('creative_state');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('creative_state'), expect.anything());
  });

  it('creative_state 컬럼이 정상 존재하면 1번 조회로 끝나고 값도 그대로 내려온다', async () => {
    maybeSingleQueue = [
      {
        data: {
          id: 'draft-1',
          listing_id: null,
          product_name: '테스트 상품',
          sections: [],
          theme: {},
          thumbnail_url: null,
          updated_at: '2026-08-02T00:00:00.000Z',
          shoot_session: {},
          creative_state: { referenceText: '복원됨' },
        },
        error: null,
      },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { GET } = await import('@/app/api/detail-page/draft/route');
    const req = new NextRequest('http://localhost/api/detail-page/draft?id=11111111-1111-4111-8111-111111111111');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.draft.creativeState).toEqual({ referenceText: '복원됨' });
    expect(selectArgs).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
