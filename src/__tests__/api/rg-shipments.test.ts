// src/__tests__/api/rg-shipments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeGetRequest(params = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/rg-shipments${params}`,
    { method: 'GET' }
  );
}

describe('GET /api/cost-management/rg-shipments', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('이벤트 없으면 빈 배열 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('이벤트 목록을 반환한다', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'event-uuid-1',
          shipped_at: '2026-05-28',
          total_shipping_fee: 22750,
          created_at: '2026-05-28T10:00:00Z',
          items: [
            { product_name: '상품A', quantity: 100, unit_rg_fee: 152 },
          ],
        },
      ],
    });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].shipped_at).toBe('2026-05-28');
    expect(json.data[0].items[0].product_name).toBe('상품A');
  });

  it('limit 파라미터가 쿼리에 반영된다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    await GET(makeGetRequest('?limit=5'));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT/i);
    expect(params).toContain(5);
  });

  it('limit이 숫자가 아니면 기본값 20을 사용한다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    await GET(makeGetRequest('?limit=abc'));
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(20);
  });
});

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/cost-management/rg-shipments',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/cost-management/rg-shipments — 이벤트 저장', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let mockPoolQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });

    mockClient = { query: vi.fn(), release: vi.fn() };
    mockPoolQuery = vi.fn();

    // client.query 순서: BEGIN / ownerCheck / stockRows / batches / UPDATE / COMMIT
    mockClient.query
      .mockResolvedValueOnce({})                                                   // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'prod-uuid', product_name: '상품A' }] }) // ownerCheck
      .mockResolvedValueOnce({ rows: [{ total_stock: 100 }] })                     // stockRows
      .mockResolvedValueOnce({ rows: [{ id: 'entry-uuid-1', quantity: 100 }] })   // batches
      .mockResolvedValueOnce({})                                                   // UPDATE cost_entries
      .mockResolvedValueOnce({});                                                  // COMMIT

    // pool.query 순서: INSERT rg_shipment_events / INSERT rg_shipment_event_items
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'event-uuid-1' }] })   // INSERT rg_shipment_events
      .mockResolvedValueOnce({});                                    // INSERT rg_shipment_event_items

    mockGetPool.mockReturnValue({
      connect: vi.fn().mockResolvedValue(mockClient),
      query: mockPoolQuery,
    });
  });

  it('유효한 요청 시 rg_shipment_events에 INSERT됨', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(
      makePostRequest({
        shipped_at: '2026-05-28',
        total_shipping_fee: 15200,
        items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
      })
    );
    expect(res.status).toBe(200);

    // 이벤트 INSERT는 pool.query로 실행됨
    const poolSqlCalls = mockPoolQuery.mock.calls.map(([sql]: [string]) => sql);
    expect(poolSqlCalls.some((s) => /INSERT INTO rg_shipment_events/i.test(s))).toBe(true);
    expect(poolSqlCalls.some((s) => /INSERT INTO rg_shipment_event_items/i.test(s))).toBe(true);

    // product_name 파라미터 검증
    const itemsCall = mockPoolQuery.mock.calls.find(([sql]: [string]) => /INSERT INTO rg_shipment_event_items/i.test(sql));
    expect(itemsCall![1][2]).toBe('상품A');

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('이벤트 INSERT 실패 시에도 FIFO는 COMMIT됨 (non-fatal)', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockRejectedValueOnce(new Error('DB error')); // INSERT rg_shipment_events 실패

    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(
      makePostRequest({
        shipped_at: '2026-05-28',
        total_shipping_fee: 15200,
        items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
      })
    );
    // 이벤트 기록 실패해도 FIFO는 이미 COMMIT → 200 반환
    expect(res.status).toBe(200);
    const clientSqlCalls = mockClient.query.mock.calls.map(([sql]: [string]) => sql);
    expect(clientSqlCalls.some((s) => /COMMIT/i.test(s))).toBe(true);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
