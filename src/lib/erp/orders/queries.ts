// src/lib/erp/orders/queries.ts
// 주문 수집 화면·게이트 ① 조회(읽기 전용). 날짜는 주문 시각의 KST 날짜(설계 해석 #22).
import type { Db } from '@/lib/erp/ledger/store';
import { readDeductSetting, type DeductSetting } from './store';
import { CHANNEL_LABEL, ORDER_CHANNELS, type OrderChannel, type StdStatus } from './types';
import { kstDay } from './window';

export interface DayCount {
  orders: number;
  lines: number;
}

export interface ChannelStatus {
  channel: OrderChannel;
  label: string;
  today: DayCount;
  yesterday: DayCount;
  /** 오늘 포함 3일 */
  last3: DayCount;
  /** 미귀속(취소·미결제 제외) — 1-C2b 대기열 */
  unattributed: number;
  /** 재고 부족으로 건너뛴 라인 */
  short: number;
  /** 차감 대기(스위치 꺼짐) */
  pending: number;
  unknownStatus: number;
  /** 마지막 성공 수집 시각(커서) */
  cursorAt: string | null;
  /** 마지막 실행에서 이 채널이 실패했나(1) · 성공(0) · 기록 없음(null) */
  lastError: 0 | 1 | null;
  /** 마지막 실행에서 임대를 못 잡아 건너뛰었나(1) · 아니다(0) · 기록 없음(null) */
  lastBusy: 0 | 1 | null;
  /** 마지막 실행에서 사라짐 판정을 거절했나(1) · 아니다(0) · 기록 없음(null) */
  lastAbsenceRefused: 0 | 1 | null;
  /** 마지막 실행에서 형식 오류로 버린 라인 수. 기록 없음이면 null */
  lastRejected: number | null;
}

export interface OrdersStatus {
  /** KST 오늘 */
  today: string;
  cutover: string | null;
  deduct: DeductSetting;
  channels: ChannelStatus[];
  lastRun: { startedAt: string; finishedAt: string | null; status: string; error: string | null } | null;
}

export interface DayLine {
  id: number;
  externalOrderId: string;
  externalLineId: string;
  orderedAt: string;
  paidAt: string | null;
  status: StdStatus;
  rawStatus: string;
  productLabel: string;
  orderQty: number;
  skuQty: number;
  amount: number;
  attribution: 'mapped' | 'unattributed';
  unattributedReason: string | null;
  deductionState: string;
  deductionNote: string | null;
  /** '쿨매트 · 블루 ×2, …' */
  skuLabels: string;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown) => Number(v ?? 0);

export async function ordersStatus(db: Db, now: Date): Promise<OrdersStatus> {
  const today = kstDay(now);
  const { rows } = await db.query(
    `select channel,
            count(distinct order_id) filter (where d = $1::date)::int as t_orders, count(*) filter (where d = $1::date)::int as t_lines,
            count(distinct order_id) filter (where d = $1::date - 1)::int as y_orders, count(*) filter (where d = $1::date - 1)::int as y_lines,
            count(distinct order_id) filter (where d between $1::date - 2 and $1::date)::int as l3_orders,
            count(*) filter (where d between $1::date - 2 and $1::date)::int as l3_lines,
            count(*) filter (where attribution = 'unattributed' and status not in ('canceled', 'unpaid'))::int as unattributed,
            count(*) filter (where deduction_state = 'skipped_short')::int as short,
            count(*) filter (where deduction_state = 'pending')::int as pending,
            count(*) filter (where status = 'unknown')::int as unknown
       from (select l.*, (l.ordered_at at time zone 'Asia/Seoul')::date as d from erp.order_lines l) x
      group by channel`,
    [today],
  );
  const byCh = new Map(rows.map((r) => [String(r.channel), r]));
  const cursors = await db.query(`select name, cursor_at from erp.sync_cursors where name = 'ledger_cutover' or name like 'orders:%'`);
  const cursorOf = new Map(cursors.rows.map((r) => [String(r.name), iso(r.cursor_at)]));
  const run = await db.query(
    `select started_at, finished_at, status, counts, error from erp.job_runs where job = 'orders-sync' order by started_at desc limit 1`,
  );
  const last = run.rows[0];
  const counts = (last?.counts ?? {}) as Record<string, number>;
  const deduct = await readDeductSetting(db);
  const lastFlag = (key: string): 0 | 1 | null => (last && key in counts ? (Number(counts[key]) > 0 ? 1 : 0) : null);
  const lastCount = (key: string): number | null => (last && key in counts ? Number(counts[key]) : null);
  return {
    today,
    cutover: cursorOf.get('ledger_cutover') ?? null,
    deduct,
    channels: ORDER_CHANNELS.map((ch) => {
      const r = byCh.get(ch) ?? {};
      return {
        channel: ch,
        label: CHANNEL_LABEL[ch],
        today: { orders: n(r.t_orders), lines: n(r.t_lines) },
        yesterday: { orders: n(r.y_orders), lines: n(r.y_lines) },
        last3: { orders: n(r.l3_orders), lines: n(r.l3_lines) },
        unattributed: n(r.unattributed),
        short: n(r.short),
        pending: n(r.pending),
        unknownStatus: n(r.unknown),
        cursorAt: cursorOf.get(`orders:${ch}`) ?? null,
        lastError: lastFlag(`${ch}_error`),
        lastBusy: lastFlag(`${ch}_busy`),
        lastAbsenceRefused: lastFlag(`${ch}_absence_refused`),
        lastRejected: lastCount(`${ch}_rejected`),
      };
    }),
    lastRun: last
      ? { startedAt: iso(last.started_at) as string, finishedAt: iso(last.finished_at), status: String(last.status), error: last.error ?? null }
      : null,
  };
}

export async function dayLines(db: Db, channel: OrderChannel, day: string): Promise<DayLine[]> {
  const { rows } = await db.query(
    `select l.id, o.external_order_id, l.external_line_id, l.ordered_at, l.paid_at, l.status, l.raw_status, l.product_label,
            l.order_qty, l.sku_qty, l.amount, l.attribution, l.unattributed_reason, l.deduction_state, l.deduction_note,
            coalesce((select string_agg(s.name || case when s.option_label <> '' then ' · ' || s.option_label else '' end || ' ×' || (a->>'qty'), ', ' order by s.id)
                        from jsonb_array_elements(l.alloc) a join erp.skus s on s.id = (a->>'skuId')::bigint), '') as sku_labels
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where l.channel = $1 and (l.ordered_at at time zone 'Asia/Seoul')::date = $2::date
      order by l.ordered_at, l.id`,
    [channel, day],
  );
  return rows.map((r) => ({
    id: Number(r.id), externalOrderId: String(r.external_order_id), externalLineId: String(r.external_line_id),
    orderedAt: iso(r.ordered_at) as string, paidAt: iso(r.paid_at), status: r.status as StdStatus, rawStatus: String(r.raw_status),
    productLabel: String(r.product_label ?? ''), orderQty: n(r.order_qty), skuQty: n(r.sku_qty), amount: n(r.amount),
    attribution: r.attribution, unattributedReason: r.unattributed_reason ?? null, deductionState: String(r.deduction_state),
    deductionNote: r.deduction_note ?? null, skuLabels: String(r.sku_labels ?? ''),
  }));
}

export interface DailyCountRow {
  day: string;
  channel: OrderChannel;
  orders: number;
  lines: number;
  qty: number;
  canceled: number;
  unattributed: number;
}

/** 게이트 ①: KST 날짜 × 채널 건수(주문 수 · 라인 수 · 수량 · 취소 · 미귀속) */
export async function dailyCounts(db: Db, fromDay: string): Promise<DailyCountRow[]> {
  const { rows } = await db.query(
    `select (ordered_at at time zone 'Asia/Seoul')::date::text as day, channel,
            count(distinct order_id)::int as orders, count(*)::int as lines, coalesce(sum(order_qty), 0)::int as qty,
            count(*) filter (where status in ('canceled', 'returned'))::int as canceled,
            count(*) filter (where attribution = 'unattributed')::int as unattributed
       from erp.order_lines
      where (ordered_at at time zone 'Asia/Seoul')::date >= $1::date
      group by 1, 2 order by 1, 2`,
    [fromDay],
  );
  return rows.map((r) => ({
    day: String(r.day), channel: r.channel as OrderChannel, orders: n(r.orders), lines: n(r.lines), qty: n(r.qty), canceled: n(r.canceled), unattributed: n(r.unattributed),
  }));
}
