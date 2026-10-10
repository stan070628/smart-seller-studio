// src/__tests__/api/cost-management-products-sku-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockSync } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockSync: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/sku/sync-app', () => ({ syncForApp: mockSync, syncMissingForApp: vi.fn() }));

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let query: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO product_costs')) {
      const sp = params[2];
      return { rows: [{ id: `pc-${String(sp)}`, product_name: params[1], seller_product_id: sp === null ? null : String(sp) }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mockGetPool.mockReturnValue({ query });
  mockSync.mockResolvedValue({ status: 'created', skus: 2 });
});

describe('POST /api/cost-management/products — skuSync', () => {
  it('상품번호가 있으면 저장 뒤 SKU를 만들고 skuSync를 싣는다', async () => {
    const { POST } = await import('@/app/api/cost-management/products/route');
    const res = await POST(post('/api/cost-management/products', { product_name: '담요', seller_product_id: 16404126884 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe('pc-16404126884');
    expect(json.skuSync).toEqual({ status: 'created', skus: 2 });
    expect(mockSync).toHaveBeenCalledWith(16404126884);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(mockSync.mock.invocationCallOrder[0]);
  });

  it('SKU 추가가 던져도 201 · 저장됨 · skuSync.failed', async () => {
    mockSync.mockRejectedValueOnce(new Error('쿠팡 키 없음'));
    const { POST } = await import('@/app/api/cost-management/products/route');
    const res = await POST(post('/api/cost-management/products', { product_name: '담요', seller_product_id: 16404126884 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('pc-16404126884');
    expect(json.skuSync).toEqual({ status: 'failed', skus: 0, error: '쿠팡 키 없음' });
  });

  it('상품번호가 없으면 skipped — 부르지 않는다', async () => {
    const { POST } = await import('@/app/api/cost-management/products/route');
    const json = await (await POST(post('/api/cost-management/products', { product_name: '소분 원재료' }))).json();
    expect(json.skuSync).toEqual({ status: 'skipped', skus: 0 });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('POST /api/cost-management/products/bulk — skuSync', () => {
  it('상품별 결과 · 한 건 실패가 등록 수에 영향 없다', async () => {
    mockSync.mockResolvedValueOnce({ status: 'created', skus: 1 }).mockResolvedValueOnce({ status: 'failed', skus: 0, error: '없음' });
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const res = await POST(post('/api/cost-management/products/bulk', { items: [
      { product_name: 'A', seller_product_id: 101 },
      { product_name: 'B', seller_product_id: 102 },
    ] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.created_count).toBe(2);
    expect(json.data.skuSync).toEqual([
      { seller_product_id: 101, product_name: 'A', status: 'created', skus: 1 },
      { seller_product_id: 102, product_name: 'B', status: 'failed', skus: 0, error: '없음' },
    ]);
  });

  it('한 요청에서 20개까지만 — 넘는 상품은 deferred(실패 아님)', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ product_name: `P${i}`, seller_product_id: 1000 + i }));
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const json = await (await POST(post('/api/cost-management/products/bulk', { items }))).json();
    expect(mockSync).toHaveBeenCalledTimes(20);
    expect(json.data.skuSync).toHaveLength(21);
    expect(json.data.skuSync[20]).toMatchObject({ seller_product_id: 1020, status: 'deferred', skus: 0 });
  });

  it('240초가 지나면 새 상품을 시작하지 않고 남은 상품은 deferred', async () => {
    const t = [0, 0, 241_000, 241_000];
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => t.shift() ?? 241_000);
    try {
      const items = [101, 102, 103].map((id) => ({ product_name: `P${id}`, seller_product_id: id }));
      const { POST } = await import('@/app/api/cost-management/products/bulk/route');
      const json = await (await POST(post('/api/cost-management/products/bulk', { items }))).json();
      expect(mockSync).toHaveBeenCalledTimes(1);
      expect(json.data.skuSync.map((x: { status: string }) => x.status)).toEqual(['created', 'deferred', 'deferred']);
    } finally {
      spy.mockRestore();
    }
  });

  it('SKU 추가가 던져도 그 상품만 failed', async () => {
    mockSync.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await import('@/app/api/cost-management/products/bulk/route');
    const json = await (await POST(post('/api/cost-management/products/bulk', { items: [{ product_name: 'A', seller_product_id: 101 }] }))).json();
    expect(json.data.created_count).toBe(1);
    expect(json.data.skuSync[0]).toEqual({ seller_product_id: 101, product_name: 'A', status: 'failed', skus: 0, error: 'boom' });
  });
});
