// src/lib/erp/home/monthly.ts
// 최근 N개월 월 매출 — 이번 달 누적 그래프 왼쪽에 둔다(사용자 요청 2026-10-10).
// ERP 주문 수집은 2026-09-01부터 채워져 있어(1-C2a 보충) 그 달부터는 erp.order_lines, 그 전은 옛 장부(sale_records)를 쓴다.
// ⚠️ 옛 장부는 실제보다 적다 — 7월 위키 총매출 18,282,963원 대비 약 17% 적고, 8월은 Wing 불러오기가 08-06에 멈췄다.
//    화면이 「옛 장부 기준 · 실제보다 적을 수 있음」으로 표시한다. 정확한 과거는 과거 주문을 ERP로 채우는 별도 과제.
import type { Db } from '@/lib/erp/ledger/store';
import { SOLD } from '@/lib/erp/orders/types';
import { kstDay, kstDayStart } from '@/lib/erp/orders/window';

type Q = Pick<Db, 'query'>;

/** 이 달부터는 ERP 주문으로 센다 */
export const ERP_SINCE = '2026-09';

export interface MonthTotal { month: string; revenue: number; orders: number; source: 'erp' | 'legacy' }

const shift = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** 이번 달(KST) 앞의 n개월, 오래된 순 */
export function recentMonths(now: Date, n: number): string[] {
  const cur = kstDay(now).slice(0, 7);
  return Array.from({ length: n }, (_, i) => shift(cur, i - n));
}

export async function buildMonthly(db: Q, now: Date, n = 6): Promise<MonthTotal[]> {
  const months = recentMonths(now, n);
  const firstDay = `${months[0]}-01`;
  const endDay = `${shift(months[n - 1], 1)}-01`; // 이번 달 1일(배타)
  const [erp, legacy] = await Promise.all([
    db.query(
      `select to_char(coalesce(paid_at, ordered_at) at time zone 'Asia/Seoul', 'YYYY-MM') as m,
              sum(amount - coalesce(discount_amount, 0))::bigint as revenue, count(distinct order_id)::int as orders
         from erp.order_lines
        where coalesce(paid_at, ordered_at) >= $1::timestamptz and coalesce(paid_at, ordered_at) < $2::timestamptz
          and status = any($3::text[])
        group by 1`,
      [kstDayStart(firstDay).toISOString(), kstDayStart(endDay).toISOString(), [...SOLD]],
    ),
    db.query(
      `select to_char(sold_at, 'YYYY-MM') as m,
              sum(coalesce(sale_amount, selling_price * quantity) - coalesce(coupon_discount, 0))::bigint as revenue,
              count(*)::int as orders
         from public.sale_records
        where voided_at is null and sold_at >= $1::date and sold_at < $2::date
        group by 1`,
      [firstDay, endDay],
    ),
  ]);
  const pick = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.m), { revenue: Number(r.revenue), orders: Number(r.orders) }]));
  const e = pick(erp.rows);
  const l = pick(legacy.rows);
  return months.map((month) => {
    const source = month >= ERP_SINCE ? 'erp' : 'legacy';
    const v = (source === 'erp' ? e : l).get(month) ?? { revenue: 0, orders: 0 };
    return { month, ...v, source };
  });
}
