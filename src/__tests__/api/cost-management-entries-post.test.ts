// @vitest-environment node
/**
 * POST /api/cost-management/products/[id]/entries
 *
 * 이 라우트의 로직을 createCostEntry()로 추출했으나 라우트를 호출하는
 * 테스트가 없었다. DB를 모킹해 라우트 자신의 분기(검증·응답·에러 매핑)를 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({ userId: 'u1', email: 't@t' }),
}));
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query, connect }),
}));

const { POST } = await import('@/app/api/cost-management/products/[id]/entries/route');

function req(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never;
}
const ctx = { params: Promise.resolve({ id: 'prod-1' }) };

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockClear();
});

describe('POST entries', () => {
  it('필수 필드가 없으면 400이다', async () => {
    const res = await POST(req({ received_at: '2026-08-09' }), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('수량이 0 이하면 400이다', async () => {
    const res = await POST(req({ received_at: '2026-08-09', quantity: 0, unit_cost: 100 }), ctx);
    expect(res.status).toBe(400);
  });

  it('없는 상품이면 404이고 트랜잭션을 롤백한다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) return { rows: [] };
      return { rows: [] };
    });
    const res = await POST(req({ received_at: '2026-08-09', quantity: 1, unit_cost: 100 }), ctx);
    expect(res.status).toBe(404);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });

  it('일반 입고가 201로 생성된다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: null, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      if (sql.includes('INSERT INTO cost_entries')) {
        return { rows: [{ id: 'entry-1', quantity: 3, unit_cost: 1000 }] };
      }
      return { rows: [] };
    });

    const res = await POST(req({ received_at: '2026-08-09', quantity: 3, unit_cost: 1000 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('entry-1');
    expect(json).not.toHaveProperty('carryover_out');

    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toContain('COMMIT');

    // 🔴 source_receipt_line_id는 이 경로에서 null이어야 한다.
    // 영수증 확정 경로만 이 값을 채운다
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO cost_entries'))!;
    expect((insert[1] as unknown[]).at(-1)).toBeNull();
  });

  it('소분 입고는 이월을 갱신하고 carryover_out을 응답에 넣는다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: 10, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      if (sql.includes('INSERT INTO cost_entries')) return { rows: [{ id: 'entry-2' }] };
      return { rows: [] };
    });

    const res = await POST(
      req({ received_at: '2026-08-09', unit_cost: 36000, purchase_quantity: 72 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(201);
    // 72개를 10개씩 묶으면 7팩 + 2개 이월
    expect(json.carryover_out).toBe(2);

    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE product_costs SET subdivision_carryover'))).toBe(true);
  });

  it('팩을 못 채우면 400이고 메시지가 보존된다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM product_costs')) {
        return { rows: [{ id: 'prod-1', subdivision_unit: 100, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0 }] };
      }
      return { rows: [] };
    });

    const res = await POST(
      req({ received_at: '2026-08-09', unit_cost: 5000, purchase_quantity: 3 }), ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('팩을 완성하기에 수량이 부족합니다');
  });
});
