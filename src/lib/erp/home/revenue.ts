// src/lib/erp/home/revenue.ts
// A12 매출 추이 — erp.order_lines의 「팔림」(SOLD) 줄만, 매출 = amount − 기록된 쿠폰 할인. KST 날짜.
// ⚠️ RG는 API에 취소·반품 표시가 없어 그만큼 크게 잡힌다(2026-10-05 실측, 1~2%) — 화면이 문구로 알린다.
import type { Db } from '@/lib/erp/ledger/store';
import type { Period } from '@/lib/dashboard/types';
import { SOLD, type SaleChannel } from '@/lib/erp/orders/types';
import { addDays, kstDay, kstDayStart } from '@/lib/erp/orders/window';

type Q = Pick<Db, 'query'>;

export interface RevenueDay { day: string; total: number; orders: number; byChannel: Partial<Record<SaleChannel, number>> }
export interface RevenueData {
  period: Period;
  from: string;
  to: string;
  days: RevenueDay[];
  totals: { revenue: number; orders: number; byChannel: Partial<Record<SaleChannel, { revenue: number; orders: number }>> };
}

const SPAN: Record<Exclude<Period, 'month'>, number> = { today: 1, '7d': 7, '30d': 30 };

export function periodRange(period: Period, now: Date): { from: string; days: string[] } {
  const today = kstDay(now);
  const first = period === 'month' ? `${today.slice(0, 8)}01` : addDays(today, -(SPAN[period] - 1));
  const days: string[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) days.push(d);
  return { from: kstDayStart(first).toISOString(), days };
}

export async function buildRevenue(db: Q, period: Period, now: Date): Promise<RevenueData> {
  const { from, days } = periodRange(period, now);
  const to = now.toISOString();
  const { rows } = await db.query(
    `select to_char(coalesce(paid_at, ordered_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day, channel,
            sum(amount - coalesce(discount_amount, 0))::bigint as revenue, count(distinct order_id)::int as orders
       from erp.order_lines
      where coalesce(paid_at, ordered_at) >= $1::timestamptz and coalesce(paid_at, ordered_at) <= $2::timestamptz
        and status = any($3::text[])
      group by 1, 2`,
    [from, to, [...SOLD]],
  );
  const byDay = new Map<string, RevenueDay>(days.map((d) => [d, { day: d, total: 0, orders: 0, byChannel: {} }]));
  const totals: RevenueData['totals'] = { revenue: 0, orders: 0, byChannel: {} };
  for (const r of rows) {
    const ch = r.channel as SaleChannel;
    const revenue = Number(r.revenue);
    const orders = Number(r.orders);
    const d = byDay.get(String(r.day));
    if (d) {
      d.byChannel[ch] = (d.byChannel[ch] ?? 0) + revenue;
      d.total += revenue;
      d.orders += orders;
    }
    totals.revenue += revenue;
    totals.orders += orders;
    const t = totals.byChannel[ch] ?? { revenue: 0, orders: 0 };
    totals.byChannel[ch] = { revenue: t.revenue + revenue, orders: t.orders + orders };
  }
  return { period, from, to, days: [...byDay.values()], totals };
}
