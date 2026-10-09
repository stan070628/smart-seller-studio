// src/lib/erp/home/today.ts
// A11 오늘 할 일 — 카드 5개와 오늘 흐름. 전부 ERP DB만 읽는다(쿠팡·네이버 API를 부르지 않는다).
// 카드는 서로 독립 쿼리 — 하나가 실패해도 나머지는 채운다(설계 §5).
import type { Db } from '@/lib/erp/ledger/store';
import { SOLD, type StdStatus } from '@/lib/erp/orders/types';
import { UNMAPPED_EXCLUDED_STATUSES } from '@/lib/erp/orders/queue';
import { maskPII } from '@/lib/jobs/mask';

type Q = Pick<Db, 'query'>;
export interface Card<T> { data: T | null; error: string | null }

/** 사람이 발송하는 채널(RG는 쿠팡이 출고한다) */
export const DIRECT_CHANNELS = ['coupang_wing', 'naver', 'toss'] as const;
/** 출고 대기 주문을 보는 창 — 수집기 꼬리(7일) 밖의 오래된 「결제완료」가 영원히 남아 보이지 않게.
 *  Wing 수집 꼬리가 7일이라, 7일 넘게 지나 상태가 바뀐 Wing 주문은 여기서 'paid'로 남을 수 있다 — stale(출고 지연 의심)로 보이는 것이 의도다(빨간 깃발). */
export const NEW_ORDER_WINDOW_DAYS = 14;
/** 오늘 흐름을 보는 창 */
export const FLOW_WINDOW_DAYS = 7;

export const FLOW_STATUSES = ['paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled', 'return_requested', 'returned'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number] & StdStatus;

export interface TodayData {
  newOrders: Card<{ count: number; stale: number }>;
  unmapped: Card<{ lines: number }>;
  jobFailures: Card<{ jobs: { job: string; count: number; lastAt: string }[] }>;
  shortage: Card<{ lines: number; skus: number }>;
  rgMismatch: Card<{ alerts: number; runAt: string | null }>;
  flow: Card<Record<FlowStatus, number>>;
}

const iso = (v: unknown): string | null =>
  v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();

async function card<T>(fn: () => Promise<T>): Promise<Card<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return { data: null, error: maskPII(e instanceof Error ? e.message : String(e)) };
  }
}

export async function buildToday(db: Q, now: Date): Promise<TodayData> {
  const at = now.toISOString();
  const [newOrders, unmapped, jobFailures, shortage, rgMismatch, flow] = await Promise.all([
    card(async () => {
      const { rows } = await db.query(
        `select count(*)::int as count,
                count(*) filter (where o.paid < $1::timestamptz - interval '24 hours')::int as stale
           from (select order_id, min(coalesce(paid_at, ordered_at)) filter (where status = 'paid') as paid,
                        bool_or(status = 'paid') and bool_and(status in ('paid', 'canceled', 'returned', 'unpaid')) as all_paid
                   from erp.order_lines
                  where channel = any($2::text[])
                    and coalesce(paid_at, ordered_at) > $1::timestamptz - make_interval(days => $3)
                  group by order_id) o
          where o.all_paid`,
        [at, [...DIRECT_CHANNELS], NEW_ORDER_WINDOW_DAYS],
      );
      return { count: Number(rows[0]?.count ?? 0), stale: Number(rows[0]?.stale ?? 0) };
    }),
    card(async () => {
      const { rows } = await db.query(
        `select count(*)::int as lines from erp.order_lines
          where attribution = 'unattributed' and status <> all($1::text[])`,
        [[...UNMAPPED_EXCLUDED_STATUSES]],
      );
      return { lines: Number(rows[0]?.lines ?? 0) };
    }),
    card(async () => {
      const { rows } = await db.query(
        `select job, count(*)::int as count, max(started_at) as last_at from erp.job_runs
          where status = 'failed' and started_at > $1::timestamptz - interval '24 hours'
          group by job order by job`,
        [at],
      );
      return { jobs: rows.map((r) => ({ job: String(r.job), count: Number(r.count), lastAt: iso(r.last_at) as string })) };
    }),
    card(async () => {
      const { rows } = await db.query(
        `select count(distinct l.id)::int as lines, count(distinct (a->>'skuId'))::int as skus
           from erp.order_lines l cross join lateral jsonb_array_elements(l.alloc) a
          where l.deduction_state = 'skipped_short' and l.status = any($1::text[])`,
        [[...SOLD]],
      );
      return { lines: Number(rows[0]?.lines ?? 0), skus: Number(rows[0]?.skus ?? 0) };
    }),
    card(async () => {
      const { rows } = await db.query(
        `with last as (select run_id, run_at from erp.rg_recon_snapshots order by run_at desc limit 1)
         select (select run_at from last) as run_at,
                (select count(*) from erp.rg_recon_snapshots s join last on last.run_id = s.run_id where s.alert is not null)::int as alerts`,
      );
      return { alerts: Number(rows[0]?.alerts ?? 0), runAt: iso(rows[0]?.run_at) };
    }),
    card(async () => {
      const { rows } = await db.query(
        `select status, count(distinct order_id)::int as n from erp.order_lines
          where coalesce(paid_at, ordered_at) > $1::timestamptz - make_interval(days => $2)
            and channel = any($3::text[])
          group by status`,
        [at, FLOW_WINDOW_DAYS, [...DIRECT_CHANNELS]],
      );
      const out = Object.fromEntries(FLOW_STATUSES.map((s) => [s, 0])) as Record<FlowStatus, number>;
      for (const r of rows) if ((FLOW_STATUSES as readonly string[]).includes(String(r.status))) out[r.status as FlowStatus] = Number(r.n);
      return out;
    }),
  ]);
  return { newOrders, unmapped, jobFailures, shortage, rgMismatch, flow };
}
