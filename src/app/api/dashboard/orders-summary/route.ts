/**
 * GET /api/dashboard/orders-summary?period=today|7d|30d|month
 *
 * Phase 1: 빠른 path — 주문 파이프라인 + 정산. 쿠팡 상품 수 조회는 분리됨 (느림).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { isPeriod, type Period, type OrdersSummaryData, type ChannelPipeline } from '@/lib/dashboard/types';
import { PLAN_START, WEEKLY_TARGETS } from '@/lib/plan/constants';
import { getCurrentWeek, getWeekForDate } from '@/lib/plan/week';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import {
  aggregateCoupangPipeline,
  aggregateNaverPipeline,
  type CoupangOrderRow,
  type NaverOrderRow,
} from '@/lib/dashboard/pipeline-aggregator';
import { fetchCoupangSettlement, fetchNaverSettlement } from '@/lib/dashboard/settlement-clients';
import { getSourcingPool } from '@/lib/sourcing/db';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: OrdersSummaryData; expiresAt: number }>();

export function _resetOrdersSummaryCacheForTests(): void {
  cache.clear();
}

function toDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function periodRange(period: Period): { from: string; to: string } {
  const today = new Date();
  const to = toDateStr(today);
  let from = to;
  if (period === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6); from = toDateStr(d);
  } else if (period === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 29); from = toDateStr(d);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1); from = toDateStr(d);
  }
  return { from, to };
}

const COUPANG_PIPELINE_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];

async function fetchCoupangOrdersForStatus(
  client: ReturnType<typeof getCoupangClient>,
  from: string,
  to: string,
  status: string,
): Promise<CoupangOrderRow[]> {
  const MAX_PAGES = 20;
  const items: CoupangOrderRow[] = [];
  let nextToken: string | undefined = undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.getOrders({
      createdAtFrom: from,
      createdAtTo: to,
      status,
      maxPerPage: 50,
      nextToken,
    });
    for (const o of result.items as unknown as Array<Record<string, unknown>>) {
      items.push({
        orderId: Number(o.orderId ?? 0),
        status: String(o.status ?? ''),
        totalAmount: Array.isArray(o.orderItems)
          ? (o.orderItems as Array<{ orderPrice?: number }>).reduce(
              (sum: number, it) => sum + (Number(it.orderPrice) || 0),
              0,
            )
          : 0,
      });
    }
    if (!result.nextToken) break;
    nextToken = result.nextToken;
  }
  return items;
}

async function fetchCoupangWeeklyActualFromApi(): Promise<(number | null)[]> {
  const client = getCoupangClient();
  const planStartStr = toDateStr(PLAN_START);
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  if (yesterday < planStartStr) return new Array(12).fill(null);

  const weekAmounts: number[] = new Array(12).fill(0);
  let token = '';
  for (let page = 0; page < 50; page++) {
    const result = await client.getRevenueHistory({
      recognitionDateFrom: planStartStr,
      recognitionDateTo: yesterday,
      maxPerPage: 50,
      token,
    });
    for (const item of result.items) {
      const w = getWeekForDate(item.recognitionDate);
      if (w >= 1 && w <= 12) weekAmounts[w - 1] += item.saleAmount / 10_000;
    }
    if (!result.nextToken) break;
    token = result.nextToken;
  }

  const currentWeek = getCurrentWeek();
  const cumulative: (number | null)[] = new Array(12).fill(null);
  let acc = 0;
  for (let w = 1; w <= 12; w++) {
    acc += weekAmounts[w - 1];
    cumulative[w - 1] = w <= currentWeek ? acc : null;
  }
  return cumulative;
}

async function fetchCoupangWeeklyActual(): Promise<(number | null)[]> {
  // 캐시 키: 전날 날짜 기준 (매출 데이터는 전일까지만 확정)
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  const cacheKey = `coupang:12w:${yesterday}`;

  try {
    const pool = getSourcingPool();

    // 캐시 히트 확인
    const { rows } = await pool.query<{ actual: (number | null)[] }>(
      'SELECT actual FROM dashboard_revenue_cache WHERE cache_key = $1',
      [cacheKey],
    );
    if (rows.length > 0) return rows[0].actual;

    // 캐시 미스 — 쿠팡 API 호출
    const actual = await fetchCoupangWeeklyActualFromApi();

    // 저장 (같은 날 다른 요청이 동시에 쓰더라도 덮어써도 무방)
    await pool.query(
      `INSERT INTO dashboard_revenue_cache (cache_key, actual)
       VALUES ($1, $2)
       ON CONFLICT (cache_key) DO UPDATE SET actual = EXCLUDED.actual, cached_at = now()`,
      [cacheKey, JSON.stringify(actual)],
    );

    // 오래된 캐시 정리 (14일 초과)
    pool.query(
      `DELETE FROM dashboard_revenue_cache WHERE cached_at < now() - INTERVAL '14 days'`,
    ).catch(() => {});

    return actual;
  } catch (err) {
    console.warn('[dashboard] 12주 실제 매출 조회 실패:', err instanceof Error ? err.message : err);
    return new Array(12).fill(null);
  }
}

async function fetchCoupangOrders(from: string, to: string): Promise<CoupangOrderRow[]> {
  try {
    const client = getCoupangClient();
    const results = await Promise.allSettled(
      COUPANG_PIPELINE_STATUSES.map((s) => fetchCoupangOrdersForStatus(client, from, to, s)),
    );
    const items: CoupangOrderRow[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') items.push(...r.value);
      else console.warn('[dashboard] 쿠팡 주문 status별 조회 실패:', r.reason);
    }
    return items;
  } catch (err) {
    console.warn('[dashboard] 쿠팡 주문 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

// 네이버 주문 API는 24h 단위 fan-out × 5 status. 30일이면 150회 + rate limit 가능성.
// dashboard 용으로는 최근 7일로 clamp하여 호출량을 ~35회로 제한 (약 18초 이내).
// 정확한 30d/month 데이터는 추후 cron 사전 집계로 대체 예정.
const NAVER_DASHBOARD_MAX_DAYS = 7;

function clampNaverFrom(from: string, to: string): string {
  const toDate = new Date(`${to}T00:00:00Z`);
  const minDate = new Date(toDate);
  minDate.setUTCDate(minDate.getUTCDate() - (NAVER_DASHBOARD_MAX_DAYS - 1));
  const minStr = minDate.toISOString().slice(0, 10);
  return from < minStr ? minStr : from;
}

async function fetchNaverOrders(from: string, to: string): Promise<NaverOrderRow[]> {
  const clampedFrom = clampNaverFrom(from, to);
  try {
    const client = getNaverCommerceClient();
    const result = await client.getOrders({ fromDate: clampedFrom, toDate: to });
    return (result.contents ?? []).map((o) => ({
      productOrderId: o.productOrderId,
      productOrderStatus: o.productOrderStatus,
      totalPaymentAmount: o.totalPaymentAmount,
    }));
  } catch (err) {
    console.warn('[dashboard] 네이버 주문 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildOrdersSummary(period: Period): Promise<OrdersSummaryData> {
  const { from, to } = periodRange(period);

  const [coupangOrders, naverOrders, coupangSettle, naverSettle, weeklyActual] = await Promise.all([
    fetchCoupangOrders(from, to),
    fetchNaverOrders(from, to),
    fetchCoupangSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
    fetchNaverSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
    fetchCoupangWeeklyActual(),
  ]);

  const coupangPipeline: ChannelPipeline = aggregateCoupangPipeline(coupangOrders);
  coupangPipeline.정산완료 = coupangSettle;

  const naverPipeline: ChannelPipeline = aggregateNaverPipeline(naverOrders);
  naverPipeline.정산완료 = naverSettle;

  return {
    pipeline: { coupang: coupangPipeline, naver: naverPipeline },
    revenue12w: {
      weeks: Array.from({ length: 12 }, (_, i) => i + 1),
      target: [...WEEKLY_TARGETS],
      actual: weeklyActual,
    },
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const periodParam = request.nextUrl.searchParams.get('period') ?? 'today';
  if (!isPeriod(periodParam)) {
    return Response.json({ success: false, error: `유효하지 않은 period: ${periodParam}` }, { status: 400 });
  }
  const period: Period = periodParam;

  const cacheKey = `${userId}:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    const data = await buildOrdersSummary(period);
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[GET /api/dashboard/orders-summary]', err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
