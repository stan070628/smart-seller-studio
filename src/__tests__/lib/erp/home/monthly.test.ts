// src/__tests__/lib/erp/home/monthly.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildMonthly, ERP_SINCE, recentMonths } from '@/lib/erp/home/monthly';

const NOW = new Date('2026-10-10T03:00:00.000Z'); // KST 2026-10-10

describe('recentMonths', () => {
  it('이번 달 앞의 6개월(오래된 순) · 연도 넘김', () => {
    expect(recentMonths(NOW, 6)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(recentMonths(new Date('2026-02-01T00:00:00.000Z'), 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('buildMonthly', () => {
  it('ERP_SINCE부터는 ERP, 그 전은 옛 장부 — 없는 달은 0', async () => {
    expect(ERP_SINCE).toBe('2026-09');
    const query = vi.fn(async (sql: string, _p?: unknown[]) => {
      if (sql.includes('erp.order_lines')) return { rows: [{ m: '2026-08', revenue: '999', orders: 1 }, { m: '2026-09', revenue: '16408880', orders: 862 }], rowCount: 2 };
      return { rows: [{ m: '2026-05', revenue: '2470190', orders: 111 }, { m: '2026-09', revenue: '1', orders: 1 }], rowCount: 2 };
    });
    const r = await buildMonthly({ query }, NOW);
    expect(r).toEqual([
      { month: '2026-04', revenue: 0, orders: 0, source: 'legacy' },
      { month: '2026-05', revenue: 2470190, orders: 111, source: 'legacy' },
      { month: '2026-06', revenue: 0, orders: 0, source: 'legacy' },
      { month: '2026-07', revenue: 0, orders: 0, source: 'legacy' },
      { month: '2026-08', revenue: 0, orders: 0, source: 'legacy' },
      { month: '2026-09', revenue: 16408880, orders: 862, source: 'erp' },
    ]);
  });

  it('옛 장부는 무효 제외·쿠폰 차감, ERP는 SOLD·할인 차감 · 범위는 첫 달 1일 ~ 이번 달 1일 전', async () => {
    const query = vi.fn(async (_s: string, _p?: unknown[]) => ({ rows: [], rowCount: 0 }));
    await buildMonthly({ query }, NOW);
    const legacy = query.mock.calls.find((c) => String(c[0]).includes('sale_records')) as unknown as [string, unknown[]];
    expect(legacy[0]).toContain('voided_at is null');
    expect(legacy[0]).toContain('coalesce(sale_amount, selling_price * quantity) - coalesce(coupon_discount, 0)');
    expect(legacy[1]).toEqual(['2026-04-01', '2026-10-01']);
    const erp = query.mock.calls.find((c) => String(c[0]).includes('erp.order_lines')) as unknown as [string, unknown[]];
    expect(erp[0]).toContain('amount - coalesce(discount_amount, 0)');
    expect(erp[1][0]).toBe('2026-03-31T15:00:00.000Z');
    expect(erp[1][1]).toBe('2026-09-30T15:00:00.000Z');
    expect(erp[1][2]).toEqual(expect.arrayContaining(['paid', 'delivered']));
  });
});
