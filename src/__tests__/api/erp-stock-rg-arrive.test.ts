// src/__tests__/api/erp-stock-rg-arrive.test.ts
// 원장 함수(store·rg-arrive)는 진짜를 쓰고 DB만 가짜로 둔다 — 잠금 순서·멱등키·트랜잭션을 SQL 순서로 본다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));

const A = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const B = '4f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f61';
const URL = 'http://localhost/api/erp/stock/rg-arrive';
const post = (body: unknown) => new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let inbound: Record<number, number>;
let posted: string[];
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
const sqls = () => client.query.mock.calls.map((c) => [c[0] as string, c[1] as unknown[]] as const);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  inbound = { 7: 3, 9: 5 };
  posted = [];
  let nextId = 900;
  client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) {
        const hit = posted.includes(String(params[0]));
        return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
      }
      if (sql.startsWith('select coalesce(l.lot_id, l.id) as lot_id')) {
        const q = params[1] === 'rg_inbound' ? (inbound[Number(params[0])] ?? 0) : 0;
        return { rows: q > 0 ? [{ lot_id: Number(params[0]) * 10, qty: q, unit_cost: 1000, lot_at: 1 }] : [], rowCount: q > 0 ? 1 : 0 };
      }
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    }),
    release: vi.fn(),
  };
  mockGetPool.mockReturnValue({ query: vi.fn(), connect: vi.fn(async () => client) });
});

describe('POST /api/erp/stock/rg-arrive', () => {
  it('로그인하지 않으면 401이고 쓰지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    expect((await POST(post({ items: [{ skuId: 7, qty: 1, requestId: A }] }))).status).toBe(401);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('🔴 한 트랜잭션에서 SKU 오름차순으로 잠그고 rg_inbound → rg로 옮긴다(멱등키 rgdone:<uuid>)', async () => {
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    const res = await POST(post({ items: [{ skuId: 9, qty: 2, requestId: B }, { skuId: 7, qty: 3, requestId: A.toUpperCase() }] }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      { skuId: 7, qty: 3, requestId: A, outcome: 'posted' },
      { skuId: 9, qty: 2, requestId: B, outcome: 'posted' },
    ]);
    const all = sqls();
    expect(all[0][0]).toBe('BEGIN');
    expect(all[all.length - 1][0]).toBe('COMMIT');
    const locks = all.filter(([s]) => s.startsWith('select pg_advisory_xact_lock')).map(([, p]) => p[1]);
    expect(locks.slice(0, 2)).toEqual([7, 9]);
    const keys = all.filter(([s]) => s.startsWith('insert into erp.stock_ledger')).map(([, p]) => [p[1], p[2], p[10]]);
    expect(keys).toEqual([
      ['rg_inbound', -3, `rgdone:${A}#0:out`], ['rg', 3, `rgdone:${A}#0:in`],
      ['rg_inbound', -2, `rgdone:${B}#0:out`], ['rg', 2, `rgdone:${B}#0:in`],
    ]);
  });

  it('🔴 입고중 재고가 모자라면 409 insufficient이고 전부 되돌린다', async () => {
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    const res = await POST(post({ items: [{ skuId: 7, qty: 1, requestId: A }, { skuId: 9, qty: 6, requestId: B }] }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('insufficient');
    expect(json.skuId).toBe(9);
    expect(json.index).toBe(1);
    expect(sqls().map(([s]) => s)).toContain('ROLLBACK');
    expect(sqls().map(([s]) => s)).not.toContain('COMMIT');
  });

  it('같은 요청 재전송은 duplicate(쓰지 않는다)', async () => {
    posted = [`rgdone:${A}`];
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    const res = await POST(post({ items: [{ skuId: 7, qty: 3, requestId: A }] }));
    expect((await res.json()).data).toEqual([{ skuId: 7, qty: 3, requestId: A, outcome: 'duplicate' }]);
    expect(sqls().some(([s]) => s.startsWith('insert'))).toBe(false);
  });

  it.each([
    ['items 없음', {}],
    ['수량 0', { items: [{ skuId: 7, qty: 0, requestId: A }] }],
    ['uuid 아님', { items: [{ skuId: 7, qty: 1, requestId: 'x' }] }],
  ])('%s → 400이고 트랜잭션을 열지 않는다', async (_l, body) => {
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    expect((await POST(post(body))).status).toBe(400);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('활성이 아닌 SKU는 400(쓰지 않는다)', async () => {
    const { POST } = await import('@/app/api/erp/stock/rg-arrive/route');
    const res = await POST(post({ items: [{ skuId: 11, qty: 1, requestId: A }] }));
    expect(res.status).toBe(400);
    expect(sqls().some(([s]) => s.startsWith('insert'))).toBe(false);
  });
});
