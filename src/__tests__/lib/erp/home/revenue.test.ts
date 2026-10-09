// src/__tests__/lib/erp/home/revenue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildRevenue, periodRange } from '@/lib/erp/home/revenue';

const NOW = new Date('2026-10-09T03:00:00.000Z'); // KST 2026-10-09 12:00

describe('periodRange — KST 날짜', () => {
  it('오늘 · 7일 · 30일 · 이번 달', () => {
    expect(periodRange('today', NOW)).toMatchObject({ from: '2026-10-08T15:00:00.000Z', days: ['2026-10-09'] });
    const w = periodRange('7d', NOW);
    expect(w.from).toBe('2026-10-02T15:00:00.000Z');
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toBe('2026-10-03');
    expect(w.days[6]).toBe('2026-10-09');
    expect(periodRange('30d', NOW).days).toHaveLength(30);
    const m = periodRange('month', NOW);
    expect(m.from).toBe('2026-09-30T15:00:00.000Z');
    expect(m.days[0]).toBe('2026-10-01');
    expect(m.days).toHaveLength(9);
  });

  it('KST 자정 직후(UTC 전날)도 KST 날짜로 자른다', () => {
    expect(periodRange('today', new Date('2026-10-08T15:30:00.000Z')).days).toEqual(['2026-10-09']);
  });
});

describe('buildRevenue', () => {
  it('날짜×채널로 펼치고 합계·채널 합계를 낸다 · 빈 날은 0', async () => {
    const query = vi.fn(async (_s: string, _p?: unknown[]) => ({
      rows: [
        { day: '2026-10-08', channel: 'coupang_rg', revenue: '28200', orders: 2 },
        { day: '2026-10-09', channel: 'coupang_rg', revenue: '14100', orders: 1 },
        { day: '2026-10-09', channel: 'naver', revenue: '9900', orders: 1 },
      ],
      rowCount: 3,
    }));
    const r = await buildRevenue({ query }, '7d', NOW);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toEqual({ day: '2026-10-03', total: 0, byChannel: {} });
    expect(r.days[6]).toEqual({ day: '2026-10-09', total: 24000, byChannel: { coupang_rg: 14100, naver: 9900 } });
    expect(r.totals).toEqual({
      revenue: 52200, orders: 4,
      byChannel: { coupang_rg: { revenue: 42300, orders: 3 }, naver: { revenue: 9900, orders: 1 } },
    });
  });

  it('SOLD 상태만 · 할인 차감 · KST 날짜 · 기간 시작을 넘긴다', async () => {
    const query = vi.fn(async (_s: string, _p?: unknown[]) => ({ rows: [], rowCount: 0 }));
    await buildRevenue({ query }, 'today', NOW);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('amount - coalesce(discount_amount, 0)');
    expect(sql).toContain("at time zone 'Asia/Seoul'");
    expect(sql).toContain('status = any($3::text[])');
    expect(params[0]).toBe('2026-10-08T15:00:00.000Z');
    expect(params[1]).toBe(NOW.toISOString());
    expect(params[2]).toEqual(expect.arrayContaining(['paid', 'delivered', 'confirmed']));
    expect(params[2]).not.toContain('canceled');
    expect(params[2]).not.toContain('returned');
  });
});
