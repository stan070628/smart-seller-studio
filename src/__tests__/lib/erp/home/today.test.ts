// src/__tests__/lib/erp/home/today.test.ts
import { describe, it, expect, vi } from 'vitest';
import { UNMAPPED_EXCLUDED_STATUSES } from '@/lib/erp/orders/queue';
import { buildToday, DIRECT_CHANNELS, NEW_ORDER_WINDOW_DAYS } from '@/lib/erp/home/today';

const NOW = new Date('2026-10-09T03:00:00.000Z'); // KST 12:00

/** SQL 조각으로 응답을 고른다 — 매칭 안 되면 빈 행 */
function db(routes: [string, unknown[] | Error][]) {
  const query = vi.fn(async (sql: string, _p?: unknown[]) => {
    for (const [frag, res] of routes) if (sql.includes(frag)) { if (res instanceof Error) throw res; return { rows: res, rowCount: res.length }; }
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

describe('buildToday', () => {
  it('카드 5개와 흐름을 채운다', async () => {
    const d = db([
      ['bool_and', [{ count: 9, stale: 2 }]],
      ["attribution = 'unattributed'", [{ lines: 1 }]],
      ['erp.job_runs', [{ job: 'orders-sync', count: 3, last_at: new Date('2026-10-09T01:15:00Z') }]],
      ["deduction_state = 'skipped_short'", [{ lines: 16, skus: 8 }]],
      ['erp.rg_recon_snapshots', [{ run_at: new Date('2026-10-09T00:37:00Z'), alerts: 2 }]],
      ['group by status', [{ status: 'paid', n: 10 }, { status: 'delivered', n: 70 }, { status: 'canceled', n: 3 }]],
    ]);
    const t = await buildToday(d, NOW);
    expect(t.newOrders).toEqual({ data: { count: 9, stale: 2 }, error: null });
    expect(t.unmapped).toEqual({ data: { lines: 1 }, error: null });
    expect(t.jobFailures).toEqual({ data: { jobs: [{ job: 'orders-sync', count: 3, lastAt: '2026-10-09T01:15:00.000Z' }] }, error: null });
    expect(t.shortage).toEqual({ data: { lines: 16, skus: 8 }, error: null });
    expect(t.rgMismatch).toEqual({ data: { alerts: 2, runAt: '2026-10-09T00:37:00.000Z' }, error: null });
    expect(t.flow.data).toMatchObject({ paid: 10, delivered: 70, canceled: 3, shipping: 0, confirmed: 0 });
  });

  it('신규 주문 쿼리 — 직접발송 채널·모든 줄 paid·최근 창·24시간 경계를 넘긴다', async () => {
    const d = db([['bool_and', [{ count: 0, stale: 0 }]]]);
    await buildToday(d, NOW);
    const [sql, params] = d.query.mock.calls.find((c) => String(c[0]).includes('bool_and')) as unknown as [string, unknown[]];
    // 부분 취소 주문은 남는다 · 배송중 줄이 섞이면 뺀다 · stale은 paid 줄만 본다
    expect(sql).toContain("bool_or(status = 'paid') and bool_and(status in ('paid', 'canceled', 'returned', 'unpaid'))");
    expect(sql).toContain("filter (where status = 'paid')");
    expect(params).toEqual([NOW.toISOString(), [...DIRECT_CHANNELS], NEW_ORDER_WINDOW_DAYS]);
    expect([...DIRECT_CHANNELS]).toEqual(['coupang_wing', 'naver', 'toss']);
    expect(sql).toContain("interval '24 hours'");
  });

  it('매핑 필요는 취소·반품 완료를 뺀다 · RG 불일치는 최근 run만 · 전송 실패는 24시간', async () => {
    const d = db([]);
    await buildToday(d, NOW);
    const sqls = d.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.find((s) => s.includes("attribution = 'unattributed'"))).toContain('status <> all($1::text[])');
    const um = d.query.mock.calls.find((c) => String(c[0]).includes("attribution = 'unattributed'")) as unknown as [string, unknown[]];
    expect(um[1]).toEqual([[...UNMAPPED_EXCLUDED_STATUSES]]);
    expect(UNMAPPED_EXCLUDED_STATUSES).toEqual(['canceled', 'returned', 'unpaid']);
    expect(sqls.find((s) => s.includes('erp.rg_recon_snapshots'))).toContain('order by run_at desc limit 1');
    expect(sqls.find((s) => s.includes('erp.job_runs'))).toContain("started_at > $1::timestamptz - interval '24 hours'");
  });

  it('빈 결과는 0 · RG 대조 기록이 없으면 runAt null', async () => {
    const t = await buildToday(db([['erp.rg_recon_snapshots', [{ run_at: null, alerts: 0 }]]]), NOW);
    expect(t.newOrders.data).toEqual({ count: 0, stale: 0 });
    expect(t.jobFailures.data).toEqual({ jobs: [] });
    expect(t.rgMismatch.data).toEqual({ alerts: 0, runAt: null });
  });

  it('카드 하나가 실패해도 나머지는 채운다', async () => {
    const t = await buildToday(db([["attribution = 'unattributed'", new Error('boom')], ['bool_and', [{ count: 4, stale: 0 }]]]), NOW);
    expect(t.unmapped).toEqual({ data: null, error: 'boom' });
    expect(t.newOrders.data).toEqual({ count: 4, stale: 0 });
  });

  it('흐름은 직접발송 채널만 · 재고 부족은 alloc SKU별·SOLD 줄만', async () => {
    const d = db([]);
    await buildToday(d, NOW);
    const calls = d.query.mock.calls as unknown as [string, unknown[]][];
    const flow = calls.find((c) => c[0].includes('group by status'))!;
    expect(flow[0]).toContain('channel = any($3::text[])');
    expect(flow[1][2]).toEqual([...DIRECT_CHANNELS]);
    const sh = calls.find((c) => c[0].includes("deduction_state = 'skipped_short'"))!;
    expect(sh[0]).toContain("jsonb_array_elements(l.alloc)");
    expect(sh[0]).toContain("count(distinct (a->>'skuId'))");
    expect(sh[0]).toContain('l.status = any($1::text[])');
    expect(sh[1][0]).toEqual(expect.arrayContaining(['paid', 'delivered']));
    expect(sh[1][0]).not.toContain('canceled');
  });

  it('오류 문구는 개인정보를 가려서 내보낸다', async () => {
    const t = await buildToday(db([["attribution = 'unattributed'", new Error('fail for 010-1234-5678')]]), NOW);
    expect(t.unmapped.error).not.toContain('010-1234-5678');
  });
});
