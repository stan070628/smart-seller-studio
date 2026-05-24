/**
 * costco-naver-compare-handler.test.ts
 * GET /api/sourcing/costco/naver-compare 핸들러 통합 테스트
 *
 * vi.mock으로 DB·네이버 API·인증을 격리하고
 * 필터링 로직과 에러 경로를 포함한 전체 분기를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// 의존성 mock — import보다 먼저 선언해야 hoisting이 적용된다
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: vi.fn(),
}));

vi.mock('@/lib/sourcing/naver-shopping', () => ({
  normalizeProductQuery: vi.fn((s: string) => s),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

import { getSourcingPool } from '@/lib/sourcing/db';
import { requireAuth } from '@/lib/supabase/auth';

const mockGetSourcingPool = getSourcingPool as ReturnType<typeof vi.fn>;
const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;

// 핸들러는 mock 설정 후 동적으로 import
const { GET } = await import('@/app/api/sourcing/costco/naver-compare/route');

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(params: { title?: string; code?: string } = {}): NextRequest {
  const url = new URL('http://localhost/api/sourcing/costco/naver-compare');
  if (params.title !== undefined) url.searchParams.set('title', params.title);
  if (params.code !== undefined) url.searchParams.set('code', params.code);
  return new NextRequest(url);
}

/** 정상적인 네이버 쇼핑 응답 아이템 2개 */
const NAVER_ITEMS = [
  { title: 'Test Product', lprice: '22400', link: 'https://shopping.naver.com/1' },
  { title: 'Test Product 2', lprice: '24800', link: 'https://shopping.naver.com/2' },
];

/** fetch mock을 정상 응답으로 설정하는 헬퍼 */
function mockNaverSuccess(items = NAVER_ITEMS) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items }),
    text: async () => '',
  } as unknown as Response);
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/sourcing/costco/naver-compare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 기본값: 인증 통과
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
    // 기본값: DB 쿼리 성공(unit_price_label 없음)
    mockGetSourcingPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    });
    // 환경변수 설정 — 없으면 fetchNaverItems가 즉시 [] 반환
    process.env.NAVER_CLIENT_ID = 'test-id';
    process.env.NAVER_CLIENT_SECRET = 'test-secret';
  });

  it('requireAuth가 Response를 반환하면 401 응답을 그대로 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(401);
  });

  it('title 파라미터가 누락되면 400을 반환한다', async () => {
    // title 없이 요청
    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('Naver API가 정상 응답하면 최대 3개의 items를 반환한다', async () => {
    mockNaverSuccess();

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2); // NAVER_ITEMS가 2개이므로 최대 2개
    expect(body.items[0].title).toBe('Test Product');
    expect(body.items[0].totalPrice).toBe(22400);
    expect(body.items[0].link).toBe('https://shopping.naver.com/1');
    expect(body.source).toBe('total');
  });

  it('Naver API가 5개 아이템을 반환해도 최대 3개만 잘라낸다', async () => {
    mockNaverSuccess([
      { title: 'A', lprice: '10000', link: 'https://shopping.naver.com/a' },
      { title: 'B', lprice: '11000', link: 'https://shopping.naver.com/b' },
      { title: 'C', lprice: '12000', link: 'https://shopping.naver.com/c' },
      { title: 'D', lprice: '13000', link: 'https://shopping.naver.com/d' },
      { title: 'E', lprice: '14000', link: 'https://shopping.naver.com/e' },
    ]);

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(3);
  });

  it('Naver API가 비정상 응답(500)하면 빈 items 배열을 반환한다', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as unknown as Response);

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('Naver API가 네트워크 에러(throw)하면 빈 items 배열을 반환한다', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('lprice가 0인 아이템은 필터링된다', async () => {
    mockNaverSuccess([
      { title: 'Valid', lprice: '22400', link: 'https://shopping.naver.com/1' },
      { title: 'Zero Price', lprice: '0', link: 'https://shopping.naver.com/2' },
    ]);

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // lprice=0인 아이템은 제외되어 1개만 반환
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Valid');
  });

  it('link가 https://로 시작하지 않는 아이템은 필터링된다', async () => {
    mockNaverSuccess([
      { title: 'HTTPS OK', lprice: '22400', link: 'https://shopping.naver.com/1' },
      { title: 'HTTP Bad', lprice: '22400', link: 'http://shopping.naver.com/2' },
      { title: 'No Protocol', lprice: '22400', link: 'shopping.naver.com/3' },
    ]);

    const res = await GET(makeRequest({ title: '올리브오일' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // https가 아닌 링크 2개가 필터링되어 1개만 반환
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('HTTPS OK');
    expect(body.items[0].link).toBe('https://shopping.naver.com/1');
  });
});
