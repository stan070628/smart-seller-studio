// src/__tests__/lib/erp/orders/discounts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ syncLegacySales: vi.fn() }));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));

import { couponByItem, enrichCoupangDiscounts, lineDiscounts, splitDiscount } from '@/lib/erp/orders/discounts';

describe('couponByItem', () => {
  it('(B1 실측) vendorItemId가 있으면 품목별로, 없으면 품목 없음(unassigned)으로 모은다 · PRICE · APPLIED만', () => {
    expect(couponByItem([
      { type: 'PRICE', discount: 1650, status: 'APPLIED', vendorItemId: 95373359497 },
      { type: 'PRICE', discount: 100, status: 'APPLIED', vendorItemId: '95373359497' },
      { type: 'PRICE', discount: 300, status: 'APPLIED' },
      { type: 'PRICE', discount: 999, status: 'CANCELED', vendorItemId: 95373359497 },
    ])).toEqual({ byItem: new Map([['95373359497', 1750]]), unassigned: 300, rate: false });
    expect(couponByItem([{ type: 'RATE', discount: -1, status: 'APPLIED', vendorItemId: 1 }]).rate).toBe(true);
  });
});

describe('splitDiscount', () => {
  it('금액 비율로 나누고 남는 원은 마지막 줄에', () => {
    expect(splitDiscount(1000, [{ id: 1, amount: 10000 }, { id: 2, amount: 20000 }])).toEqual(new Map([[1, 333], [2, 667]]));
    expect(splitDiscount(840, [{ id: 7, amount: 14100 }])).toEqual(new Map([[7, 840]]));
    expect(splitDiscount(0, [{ id: 1, amount: 1 }, { id: 2, amount: 1 }])).toEqual(new Map([[1, 0], [2, 0]]));
    // 금액이 전부 0이면 첫 줄에 몰지 않고 균등
    expect(splitDiscount(100, [{ id: 1, amount: 0 }, { id: 2, amount: 0 }])).toEqual(new Map([[1, 50], [2, 50]]));
  });
});

describe('lineDiscounts', () => {
  it('(B1 실측) 품목 쿠폰은 개당 금액 × 줄 수량 · 품목 없는 쿠폰만 금액 비율 배분 · 줄에 없는 품목의 쿠폰은 버린다', () => {
    const lines = [
      { id: 1, amount: 28200, productId: '95373359497', qty: 2 },
      { id: 2, amount: 10000, productId: '70', qty: 1 },
    ];
    const byItem = couponByItem([
      { type: 'PRICE', discount: 1650, status: 'APPLIED', vendorItemId: 95373359497 },
      { type: 'PRICE', discount: 500, status: 'APPLIED', vendorItemId: 12345 },
      { type: 'PRICE', discount: 383, status: 'APPLIED' },
    ]);
    // 1650 × 2 = 3300 + 383 × 28200/38200 = 282 · 둘째 줄 383 − 282 = 101
    expect(lineDiscounts(byItem, lines)).toEqual(new Map([[1, 3582], [2, 101]]));
  });
});

describe('enrichCoupangDiscounts', () => {
  let calls: { sql: string; params: unknown[] }[];
  let attemptRows: { id: string; closed: boolean }[];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('with todo')) {
        return { rows: [
          { id: '1', order_pk: '11', channel: 'coupang_rg', external_order_id: '9001', amount: 28200, product_id: '95373359497', order_qty: 2, legacy_key: 'rg-9001-95373359497' },
          { id: '2', order_pk: '12', channel: 'coupang_wing', external_order_id: '9002', amount: 20000, product_id: '70', order_qty: 1, legacy_key: 'wing-9002-70' },
          { id: '3', order_pk: '13', channel: 'coupang_rg', external_order_id: '9003', amount: 5000, product_id: '1', order_qty: 1, legacy_key: 'rg-9003-1' },
        ], rowCount: 3 };
      }
      if (sql.startsWith('update erp.order_lines set discount_attempts')) return { rows: attemptRows, rowCount: attemptRows.length };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client as never) };

  beforeEach(() => {
    calls = [];
    attemptRows = [{ id: '3', closed: false }];
    vi.clearAllMocks();
    m.syncLegacySales.mockResolvedValue({ upserted: 2, inserted: 0, voided: 0, warnings: [] });
  });

  it('주문마다 한 번 조회 → 한 트랜잭션에서 채널 잠금 → 줄 기록(품목 × 수량) → 옛 장부. 실패한 주문은 시도 횟수만 올린다(다음에 다시)', async () => {
    const fetchCoupons = vi.fn(async (orderId: string) => {
      if (orderId === '9003') throw new Error('HTTP 500');
      // RG 수량 2 주문 — 쿠폰 1650은 개당(B1 실측: Wing 최종구매가 12,450 = 14,100 − 1,650)
      return orderId === '9001' ? [{ type: 'PRICE', discount: 1650, status: 'APPLIED', vendorItemId: 95373359497 }] : [];
    });
    const r = await enrichCoupangDiscounts(pool, fetchCoupons, { limitOrders: 60 });
    expect(fetchCoupons.mock.calls.map((c) => c[0])).toEqual(['9001', '9002', '9003']);
    expect(r).toEqual({ orders: 3, checked: 2, discounted: 1, errors: 1, errorsClosed: 0, rate: 0 });
    // 조회 대상: 할인 모름 · 시도 3회 미만
    const todo = calls.find((c) => c.sql.startsWith('with todo'));
    expect(todo?.sql).toContain('discount_attempts < 3');
    expect(todo?.params).toEqual([60]);
    const seq = calls.map((c) => c.sql.split('\n')[0].trim().slice(0, 40));
    expect(seq.indexOf('BEGIN')).toBeLessThan(seq.findIndex((s) => s.startsWith('update erp.order_lines')));
    const locks = calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock')).map((c) => c.params);
    expect(locks).toEqual([[7102, 1], [7102, 2]]);
    const upd = calls.filter((c) => c.sql.startsWith('update erp.order_lines set discount_amount'));
    expect(upd.map((c) => c.params)).toEqual([[1, 3300], [2, 0]]);
    expect(upd[0].sql).toContain('discount_checked_at is null');
    // 실패한 주문: 같은 트랜잭션에서 시도 횟수 + 1 · 3회째면 coupang_fms_error로 닫는다
    const att = calls.filter((c) => c.sql.startsWith('update erp.order_lines set discount_attempts'));
    expect(att.map((c) => c.params)).toEqual([[[3]]]);
    expect(att[0].sql).toContain("'coupang_fms_error'");
    expect(att[0].sql).toContain('discount_attempts + 1 >= 3');
    expect(seq.indexOf('BEGIN')).toBeLessThan(calls.indexOf(att[0]));
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-9001-95373359497', 'wing-9002-70']);
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('(B1 실측) 3회째 실패한 줄은 닫혀 errorsClosed로 센다', async () => {
    attemptRows = [{ id: '1', closed: true }, { id: '2', closed: true }, { id: '3', closed: true }];
    const r = await enrichCoupangDiscounts(pool, async () => { throw new Error('HTTP 500'); }, { limitOrders: 60 });
    expect(r).toEqual({ orders: 3, checked: 0, discounted: 0, errors: 3, errorsClosed: 3, rate: 0 });
    expect(calls.some((c) => c.sql.startsWith('update erp.order_lines set discount_amount'))).toBe(false);
    // 닫힌 줄은 할인 모름(B5) — 옛 장부를 다시 계산할 것이 없다
    expect(m.syncLegacySales).not.toHaveBeenCalled();
    expect(calls.at(-1)?.sql).toBe('COMMIT');
  });

});

/** 줄 상태를 기억하는 가짜 DB — 조회 대상 = 확인 전 줄. 할인 기록·율 쿠폰 닫기가 확인 시각을 채운다 */
function statefulPool(n: number) {
  const lines = Array.from({ length: n }, (_, i) => ({
    id: String(i + 1), order_pk: String(100 + i), channel: 'coupang_rg', external_order_id: String(9000 + i), amount: 10000,
    product_id: '80', order_qty: 1, legacy_key: `rg-${9000 + i}-80`, checked: false,
  }));
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('with todo')) return { rows: lines.filter((l) => !l.checked), rowCount: 0 };
      if (sql.startsWith('update erp.order_lines set discount_amount')) {
        const l = lines.find((x) => x.id === String(params[0]) && !x.checked);
        if (l) l.checked = true;
        return { rows: [], rowCount: l ? 1 : 0 };
      }
      if (sql.startsWith("update erp.order_lines set discount_source = 'coupang_fms_rate'")) {
        const ids = (params[0] as number[]).map(String);
        const hit = lines.filter((x) => ids.includes(x.id) && !x.checked);
        for (const l of hit) l.checked = true;
        return { rows: hit.map((l) => ({ id: l.id })), rowCount: hit.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client as never) }, calls, lines };
}

describe('enrichCoupangDiscounts — (리뷰) 율 쿠폰 닫기 · 시간 예산 · 조각 커밋', () => {
  beforeEach(() => { vi.clearAllMocks(); m.syncLegacySales.mockResolvedValue({ upserted: 0, inserted: 0, voided: 0, warnings: [] }); });

  it('RATE 쿠폰 주문은 coupang_fms_rate로 닫고(할인 0 · 확인 시각) 닫은 것만 센다 — 다음 실행은 다시 조회하지 않는다', async () => {
    const s = statefulPool(2);
    const fetch = vi.fn(async () => [{ type: 'RATE', discount: -1, status: 'APPLIED' }]);
    const r = await enrichCoupangDiscounts(s.pool, fetch, { limitOrders: 60 });
    expect(r).toMatchObject({ orders: 2, checked: 0, rate: 2 });
    const close = s.calls.filter((c) => c.sql.startsWith("update erp.order_lines set discount_source = 'coupang_fms_rate'"));
    expect(close.map((c) => c.params)).toEqual([[[1]], [[2]]]);
    expect(close[0].sql).toContain('discount_checked_at = now()');
    expect(close[0].sql).toContain('discount_amount = 0');
    expect(close[0].sql).toContain('discount_checked_at is null');
    expect(s.calls.some((c) => c.sql.startsWith('update erp.order_lines set discount_amount'))).toBe(false);
    // 조회 대상은 확인 전 줄만 — 닫힌 율 쿠폰 주문은 다시 오지 않는다(알림도 한 번)
    expect(s.calls.find((c) => c.sql.startsWith('with todo'))?.sql).toContain('discount_checked_at is null');
    fetch.mockClear();
    const again = await enrichCoupangDiscounts(s.pool, fetch, { limitOrders: 60 });
    expect(fetch).not.toHaveBeenCalled();
    expect(again).toMatchObject({ orders: 0, rate: 0 });
  });

  it('시간 예산(deadline)을 넘기면 새 주문을 조회하지 않는다 — 이미 받은 주문은 기록한다', async () => {
    const s = statefulPool(3);
    let t = 0;
    const fetch = vi.fn(async () => { t = 2000; return []; });
    const r = await enrichCoupangDiscounts(s.pool, fetch, { limitOrders: 60, deadline: 1000, now: () => t });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ orders: 1, checked: 1 });
    expect(s.calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(1);
  });

  it('주문 20건씩 조각마다 한 트랜잭션(잠금 → 기록 → 옛 장부 → 커밋) — 끊겨도 한 조각만 잃는다', async () => {
    const s = statefulPool(45);
    const r = await enrichCoupangDiscounts(s.pool, async () => [], { limitOrders: 60 });
    expect(r).toMatchObject({ orders: 45, checked: 45 });
    const tx = s.calls.filter((c) => c.sql === 'BEGIN' || c.sql === 'COMMIT').map((c) => c.sql);
    expect(tx).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    expect(s.calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock'))).toHaveLength(3);
    expect(m.syncLegacySales.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([20, 20, 5]);
  });
});
