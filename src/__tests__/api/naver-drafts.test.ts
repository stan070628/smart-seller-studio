/**
 * naver-drafts.test.ts
 * GET /api/listing/naver/drafts  — 목록 조회
 * POST /api/listing/naver/drafts — 새 draft 저장
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock 헬퍼: 체이닝 가능한 Supabase 쿼리 빌더
function createMockQueryBuilder(resolvedValue: unknown) {
  const mock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    }),
  });
  return mock;
}

function createMockInsertBuilder(resolvedValue: unknown) {
  return vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(resolvedValue),
    }),
  });
}

let mockSelectBuilder: ReturnType<typeof createMockQueryBuilder>;
let mockInsertBuilder: ReturnType<typeof createMockInsertBuilder>;

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelectBuilder,
      insert: mockInsertBuilder,
    })),
  })),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-123' }),
}));

describe('GET /api/listing/naver/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectBuilder = createMockQueryBuilder({
      data: [
        {
          id: 'draft-1',
          product_name: '테스트 상품',
          source_url: null,
          source_type: 'costco',
          status: 'draft',
          draft_data: { name: '테스트 상품', salePrice: 15000 },
          created_at: '2026-04-26T00:00:00Z',
          updated_at: '2026-04-26T00:00:00Z',
        },
      ],
      error: null,
    });
  });

  it('인증된 사용자의 draft 목록을 반환한다', async () => {
    const { GET } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.drafts).toHaveLength(1);
    expect(json.drafts[0].id).toBe('draft-1');
    expect(json.drafts[0].productName).toBe('테스트 상품');
  });
});

describe('POST /api/listing/naver/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertBuilder = createMockInsertBuilder({
      data: { id: 'new-draft-id' },
      error: null,
    });
  });

  it('새 draft를 생성하고 id를 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts', {
      method: 'POST',
      body: JSON.stringify({
        productName: '테스트 상품',
        sourceType: 'costco',
        draftData: { name: '테스트 상품', leafCategoryId: '50000795', salePrice: 15000 },
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.id).toBe('new-draft-id');
  });

  it('draftData 없으면 400을 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts', {
      method: 'POST',
      body: JSON.stringify({ productName: '이름만' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
