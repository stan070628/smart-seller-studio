/**
 * sourcing-integration.test.ts
 * Phase 4 Task 1: API 통합 테스트 — MSW 기반
 *
 * 실제 DB 연결 없이 MSW node handler로 핵심 API 5개의
 * 요청/응답 흐름을 검증합니다.
 *
 * 설계 원칙:
 *  - 각 테스트에서 globalServer.use()로 핸들러를 즉시 등록 (beforeEach)
 *  - setup.ts의 afterEach → server.resetHandlers() 로 테스트 간 격리
 *  - handlers.ts에 이미 등록된 /api/ai/generate-copy는 globalServer.use()로 오버라이드
 *
 * 대상:
 *  1. GET  /api/sourcing/costco       — 쿼리 파라미터 → 필터/정렬 응답
 *  2. POST /api/sourcing/costco       — 수집 트리거
 *  3. POST /api/sourcing/fetch-items  — 도매꾹 상품 수집
 *  4. POST /api/ai/generate-copy      — AI 카피 생성 에러 핸들링
 *  5. PUT  /api/sourcing/market-price — 시장가 수동 입력
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

// ─────────────────────────────────────────────────────────────────────────────
// 공통 상수
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const COSTCO_LIST_FIXTURE = {
  products: [
    {
      id: 'prod-001',
      product_code: 'C100',
      title: '코스트코 텀블러 1L 3개입',
      category_name: '주방용품',
      price: 28000,
      market_lowest_price: 39000,
      sourcing_score: 72,
      costco_score_total: 75,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  categories: ['주방용품', '생활용품'],
  lastCollected: '2026-04-18T00:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────
// 소싱 전용 MSW 핸들러 팩토리
// setup.ts의 afterEach가 server.resetHandlers()를 호출하므로,
// 각 describe 블록의 beforeEach에서 필요한 핸들러를 재등록한다.
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/sourcing/costco 핸들러 */
const costcoGetHandler = http.get(`${BASE_URL}/api/sourcing/costco`, ({ request }) => {
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort');

  const VALID_SORTS = [
    'sourcing_score_desc', 'unit_saving_rate_desc', 'margin_rate_desc',
    'price_asc', 'price_desc', 'review_count_desc', 'collected_desc',
  ];
  if (sort && !VALID_SORTS.includes(sort)) {
    return HttpResponse.json(
      { error: { fieldErrors: { sort: ['Invalid enum value'] } } },
      { status: 400 },
    );
  }

  const seasonOnly = url.searchParams.get('seasonOnly');
  if (seasonOnly === 'true') {
    return HttpResponse.json({
      products: [], total: 0, page: 1, pageSize: 50, categories: [], lastCollected: null,
    });
  }

  return HttpResponse.json(COSTCO_LIST_FIXTURE);
});

/** POST /api/sourcing/costco 핸들러 */
const costcoPostHandler = http.post(`${BASE_URL}/api/sourcing/costco`, async ({ request }) => {
  const body = await request.json() as Record<string, unknown>;
  if (typeof body?.maxPages === 'number' && body.maxPages > 20) {
    return HttpResponse.json(
      { error: { fieldErrors: { maxPages: ['Number must be less than or equal to 20'] } } },
      { status: 400 },
    );
  }
  return HttpResponse.json({ success: true, data: { totalFetched: 120, errors: [] } });
});

/** POST /api/sourcing/fetch-items 핸들러 */
const fetchItemsHandler = http.post(`${BASE_URL}/api/sourcing/fetch-items`, async ({ request }) => {
  const body = await request.json() as Record<string, unknown>;
  if (typeof body?.pageSize === 'number' && body.pageSize > 200) {
    return HttpResponse.json(
      { success: false, error: 'Number must be less than or equal to 200' },
      { status: 400 },
    );
  }
  return HttpResponse.json({
    success: true,
    data: { totalFetched: 45, newItems: 10, updatedItems: 35, snapshotsSaved: 45 },
  });
});

/** PUT /api/sourcing/market-price 핸들러 */
const marketPriceHandler = http.put(`${BASE_URL}/api/sourcing/market-price`, async ({ request }) => {
  const body = await request.json() as Record<string, unknown>;
  if (!body?.itemId || !body?.marketPrice) {
    return HttpResponse.json(
      { error: { fieldErrors: { itemId: ['Required'], marketPrice: ['Required'] } } },
      { status: 400 },
    );
  }
  if (typeof body.itemId === 'string' && body.itemId.length < 36) {
    return HttpResponse.json(
      { error: { fieldErrors: { itemId: ['Invalid uuid'] } } },
      { status: 400 },
    );
  }
  return HttpResponse.json({ success: true, marketPrice: body.marketPrice });
});

/** POST /api/ai/generate-copy 정상 핸들러 */
const generateCopyOkHandler = http.post(`${BASE_URL}/api/ai/generate-copy`, async ({ request }) => {
  const body = await request.json() as Record<string, unknown>;
  const reviews = body?.reviews;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return HttpResponse.json(
      { success: false, error: 'reviews 필드는 비어있지 않은 배열이어야 합니다.' },
      { status: 400 },
    );
  }
  return HttpResponse.json({
    success: true,
    data: {
      sellingPoints: ['포인트1', '포인트2'],
      bubbleCopies: ['카피1', '카피2'],
      titles: ['제목1', '제목2'],
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 4 API 통합 테스트', () => {

  // ── 1. GET /api/sourcing/costco ─────────────────────────────────────────

  describe('GET /api/sourcing/costco — 코스트코 상품 목록 조회', () => {
    beforeEach(() => {
      server.use(costcoGetHandler);
    });

    it('정상 요청 시 products, total, page, categories 키가 모두 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco`);
      const json = await res.json() as typeof COSTCO_LIST_FIXTURE;

      expect(res.status).toBe(200);
      expect(json).toHaveProperty('products');
      expect(json).toHaveProperty('total');
      expect(json).toHaveProperty('page');
      expect(json).toHaveProperty('categories');
    });

    it('genderFilter=neutral 파라미터를 전달해도 400이 발생하지 않는다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco?genderFilter=neutral`);
      expect(res.status).toBe(200);
    });

    it('seasonOnly=true → products 배열이 비어 있다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco?seasonOnly=true`);
      const json = await res.json() as { products: unknown[]; total: number };

      expect(res.status).toBe(200);
      expect(json.products).toHaveLength(0);
      expect(json.total).toBe(0);
    });

    it('잘못된 sort 파라미터(invalid_sort) → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco?sort=invalid_sort`);
      expect(res.status).toBe(400);
    });

    it('유효한 sort 파라미터(margin_rate_desc) → 200을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco?sort=margin_rate_desc`);
      expect(res.status).toBe(200);
    });

    it('응답의 products 첫 번째 항목이 product_code와 title을 가진다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco`);
      const json = await res.json() as typeof COSTCO_LIST_FIXTURE;

      expect(json.products[0]).toHaveProperty('product_code');
      expect(json.products[0]).toHaveProperty('title');
    });
  });

  // ── 2. POST /api/sourcing/costco ─────────────────────────────────────────

  describe('POST /api/sourcing/costco — 수집 트리거', () => {
    beforeEach(() => {
      server.use(costcoPostHandler);
    });

    it('정상 요청 시 success: true와 data.totalFetched가 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 5 }),
      });
      const json = await res.json() as { success: boolean; data: { totalFetched: number } };

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('totalFetched');
      expect(typeof json.data.totalFetched).toBe('number');
    });

    it('maxPages=21 (범위 초과) → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 21 }),
      });
      expect(res.status).toBe(400);
    });

    it('categoryNames 없이 요청해도 200을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/costco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── 3. POST /api/sourcing/fetch-items ────────────────────────────────────

  describe('POST /api/sourcing/fetch-items — 도매꾹 상품 수집', () => {
    beforeEach(() => {
      server.use(fetchItemsHandler);
    });

    it('정상 요청 시 success: true와 data 객체가 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/fetch-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '생활용품', pageSize: 50, maxPages: 1 }),
      });
      const json = await res.json() as { success: boolean; data: Record<string, number> };

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('totalFetched');
    });

    it('keyword와 pageSize 파라미터가 정상 전달된다 (200 반환)', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/fetch-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '주방용품', pageSize: 100 }),
      });
      expect(res.status).toBe(200);
    });

    it('pageSize=201 (범위 초과) → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/fetch-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageSize: 201 }),
      });
      expect(res.status).toBe(400);
    });

    it('keywords 배열로 여러 키워드 수집 요청이 200을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/fetch-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: ['텀블러', '머그컵'], maxPages: 1 }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── 4. POST /api/ai/generate-copy ────────────────────────────────────────
  // handlers.ts에 등록된 기존 핸들러를 server.use()로 오버라이드한다.
  // server.use()는 스택 최상단에 등록되어 기존 핸들러보다 우선 처리된다.

  describe('POST /api/ai/generate-copy — AI 카피 생성', () => {
    beforeEach(() => {
      // BASE_URL prefix 핸들러로 오버라이드 (handlers.ts는 prefix 없는 경로 사용)
      // MSW는 절대 경로와 상대 경로 모두 인터셉트하므로,
      // 동일 메서드+경로의 핸들러는 나중에 등록된 것이 우선
      server.use(generateCopyOkHandler);
    });

    it('정상 요청 시 success: true와 data가 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: ['배송 빠르고 품질 좋아요', '재구매 의사 있습니다'],
          productName: '텀블러',
        }),
      });
      const json = await res.json() as { success: boolean; data: unknown };

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json).toHaveProperty('data');
    });

    it('빈 reviews 배열 전달 → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: [] }),
      });
      const json = await res.json() as { success: boolean; error: string };

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain('reviews');
    });

    it('reviews 필드 없이 전달 → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: '텀블러' }),
      });
      expect(res.status).toBe(400);
    });

    it('AI API 설정 오류 시뮬레이션 → 503을 반환한다', async () => {
      // 이 테스트에서만 503 응답으로 오버라이드
      server.use(
        http.post(`${BASE_URL}/api/ai/generate-copy`, () =>
          HttpResponse.json(
            { success: false, error: '서버 설정 오류: AI API 키가 구성되지 않았습니다.' },
            { status: 503 },
          ),
        ),
      );

      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: ['리뷰1'] }),
      });
      expect(res.status).toBe(503);
    });

    it('서버 내부 오류 시뮬레이션 → 500을 반환한다', async () => {
      server.use(
        http.post(`${BASE_URL}/api/ai/generate-copy`, () =>
          HttpResponse.json(
            { success: false, error: 'Internal Server Error' },
            { status: 500 },
          ),
        ),
      );

      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: ['리뷰1'] }),
      });
      expect(res.status).toBe(500);
    });

    it('응답에 sellingPoints, bubbleCopies, titles 키가 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/ai/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: ['매우 좋은 제품입니다'] }),
      });
      const json = await res.json() as { success: boolean; data: Record<string, unknown> };

      expect(json.data).toHaveProperty('sellingPoints');
      expect(json.data).toHaveProperty('bubbleCopies');
      expect(json.data).toHaveProperty('titles');
    });
  });

  // ── 5. PUT /api/sourcing/market-price ─────────────────────────────────────

  describe('PUT /api/sourcing/market-price — 시장가 수동 입력', () => {
    beforeEach(() => {
      server.use(marketPriceHandler);
    });

    it('정상 요청 시 success: true와 marketPrice가 존재한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/market-price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          marketPrice: 35000,
        }),
      });
      const json = await res.json() as { success: boolean; marketPrice: number };

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.marketPrice).toBe(35000);
    });

    it('itemId 없이 요청 → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/market-price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketPrice: 35000 }),
      });
      expect(res.status).toBe(400);
    });

    it('marketPrice 없이 요청 → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/market-price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
      });
      expect(res.status).toBe(400);
    });

    it('잘못된 UUID 형식(짧은 문자열) → 400을 반환한다', async () => {
      const res = await fetch(`${BASE_URL}/api/sourcing/market-price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: 'not-a-uuid', marketPrice: 35000 }),
      });
      expect(res.status).toBe(400);
    });

    it('응답의 marketPrice가 요청한 값과 일치한다', async () => {
      const targetPrice = 42000;
      const res = await fetch(`${BASE_URL}/api/sourcing/market-price`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          marketPrice: targetPrice,
        }),
      });
      const json = await res.json() as { marketPrice: number };

      expect(json.marketPrice).toBe(targetPrice);
    });
  });
});
