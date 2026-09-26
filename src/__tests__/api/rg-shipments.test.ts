// src/__tests__/api/rg-shipments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

const { mockPostRg } = vi.hoisted(() => ({ mockPostRg: vi.fn() }));
vi.mock('@/lib/erp/ledger/rg-ship', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/rg-ship')>()),
  postRgShipTransfers: mockPostRg,
}));

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

import { RgShipStockError } from '@/lib/erp/ledger/rg-ship';

describe('POST /api/cost-management/rg-shipments — FIFO·이벤트·원장 이동이 한 트랜잭션', () => {
  let order: string[];
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let mockPoolQuery: ReturnType<typeof vi.fn>;
  let failEvent: boolean;

  const body = {
    shipped_at: '2026-05-28',
    total_shipping_fee: 15200,
    items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
    sku_items: [{ sku_id: 7, quantity: 100 }],
    wing_inbound_id: '12345',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    failEvent = false;
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockClient = {
      query: vi.fn(async (sql: string) => {
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { order.push(sql); return {}; }
        if (sql.includes('FROM product_costs WHERE id')) return { rows: [{ id: 'prod-uuid', product_name: '상품A' }] };
        if (sql.includes('AS total_stock')) return { rows: [{ total_stock: 100 }] };
        if (sql.includes('SELECT id, quantity FROM cost_entries')) return { rows: [{ id: 'entry-uuid-1', quantity: 100 }] };
        if (sql.startsWith('UPDATE cost_entries')) return {};
        if (/INSERT INTO rg_shipment_events/.test(sql)) {
          if (failEvent) throw new Error('DB error');
          order.push('event');
          return { rows: [{ id: 'event-uuid-1' }] };
        }
        if (/INSERT INTO rg_shipment_event_items/.test(sql)) return {};
        throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
      }),
      release: vi.fn(),
    };
    mockPoolQuery = vi.fn();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient), query: mockPoolQuery });
    mockPostRg.mockImplementation(async () => { order.push('ledger'); return { posted: [{ skuId: 7, qty: 100 }], skipped: [] }; });
  });

  it('이벤트 기록과 원장 이동이 COMMIT 전에 같은 client로 실행된다', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(200);
    expect(order).toEqual(['BEGIN', 'event', 'ledger', 'COMMIT']);
    expect(mockPoolQuery).not.toHaveBeenCalled();

    const itemsCall = mockClient.query.mock.calls.find((args: unknown[]) => /INSERT INTO rg_shipment_event_items/i.test(args[0] as string));
    expect(itemsCall![1][2]).toBe('상품A');

    const [db, arg] = mockPostRg.mock.calls[0];
    expect(db).toBe(mockClient);
    expect(arg).toEqual({
      eventId: 'event-uuid-1',
      occurredAt: expect.stringMatching(/Z$/),
      note: 'RG 보내기 2026-05-28 · Wing 입고 ID 12345',
      items: [{ skuId: 7, qty: 100 }],
    });
    const json = await res.json();
    expect(json.data.ledger).toEqual({ posted: [{ skuId: 7, qty: 100 }], skipped: [] });
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('sku_items 없이 보내면(옛 화면) 원장에는 빈 목록을 넘긴다', async () => {
    mockPostRg.mockResolvedValue({ posted: [], skipped: [] });
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const { sku_items: _omit, wing_inbound_id: _w, ...legacy } = body;
    const res = await POST(makePostRequest(legacy));
    expect(res.status).toBe(200);
    expect(mockPostRg.mock.calls[0][1]).toMatchObject({ items: [], note: 'RG 보내기 2026-05-28' });
  });

  it('이벤트 기록이 실패하면 FIFO까지 전부 되돌린다(예전과 반대)', async () => {
    failEvent = true;
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(500);
    expect(order).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mockPostRg).not.toHaveBeenCalled();
  });

  it('집 원장 재고가 모자라면 409 + 재고현황 안내, 전부 되돌린다', async () => {
    mockPostRg.mockRejectedValue(new RgShipStockError(7, 100, 3));
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('재고현황');
    expect(order).toEqual(['BEGIN', 'event', 'ROLLBACK']);
  });

  it('sku_items 형태가 틀리면 400이고 DB에 붙지 않는다', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest({ ...body, sku_items: [{ sku_id: 7, quantity: 0 }] }));
    expect(res.status).toBe(400);
    expect(order).toEqual([]);
  });
});
