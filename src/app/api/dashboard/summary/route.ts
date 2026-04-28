/**
 * GET /api/dashboard/summary?period=today|7d|30d|month
 *
 * 운영 대시보드용 요약 — 채널별 주문 파이프라인 + 등록 상품 수 + 12주 매출 추세 (target만).
 * 12주 actual은 클라이언트에서 plan localStorage 기반으로 채움.
 *
 * 스펙: docs/superpowers/specs/2026-04-26-dashboard-redesign-design.md
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { isPeriod, type Period, type DashboardSummaryData, type ChannelPipeline } from '@/lib/dashboard/types';
import { WEEKLY_TARGETS } from '@/lib/plan/constants';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import {
  aggregateCoupangPipeline,
  aggregateNaverPipeline,
  type CoupangOrderRow,
  type NaverOrderRow,
} from '@/lib/dashboard/pipeline-aggregator';
import { fetchCoupangSettlement, fetchNaverSettlement } from '@/lib/dashboard/settlement-clients';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: DashboardSummaryData; expiresAt: number }>();

// Export only for tests — used by integration tests to reset cache between cases
export function _resetDashboardCacheForTests(): void {
  cache.clear();
}

function toDateStr(d: Date): string {
  // KST = UTC+9. 한국 시간대 기준 YYYY-MM-DD 반환 (서버 TZ 무관).
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function periodRange(period: Period): { from: string; to: string } {
  const today = new Date();
  const to = toDateStr(today);
  let from = to;

  if (period === 'today') {
    from = to;
  } else if (period === '7d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    from = toDateStr(d);
  } else if (period === '30d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    from = toDateStr(d);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    from = toDateStr(d);
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
  // ordersheets API는 maxPerPage 최대 50. 30일 기간이면 nextToken으로 이어 받아야 누락 없음.
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

// 네이버 주문 API는 24h × 3 status fan-out → 30일이면 90회 + rate limit. 7일로 clamp.
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

async function buildSummary(period: Period, userId: string): Promise<DashboardSummaryData> {
  const { from, to } = periodRange(period);

  const [
    coupangCount,
    naverCount,
    coupangOrders,
    naverOrders,
    coupangSettle,
    naverSettle,
  ] = await Promise.all([
    countCoupangProducts(userId).catch(() => 0),
    countNaverProducts().catch(() => 0),
    fetchCoupangOrders(from, to),
    fetchNaverOrders(from, to),
    fetchCoupangSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
    fetchNaverSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
  ]);

  const coupangPipeline: ChannelPipeline = aggregateCoupangPipeline(coupangOrders);
  coupangPipeline.정산완료 = coupangSettle;

  const naverPipeline: ChannelPipeline = aggregateNaverPipeline(naverOrders);
  naverPipeline.정산완료 = naverSettle;

  return {
    products: { coupang: coupangCount, naver: naverCount },
    pipeline: { coupang: coupangPipeline, naver: naverPipeline },
    revenue12w: {
      weeks: Array.from({ length: 12 }, (_, i) => i + 1),
      target: [...WEEKLY_TARGETS],
      actual: new Array(12).fill(null),
    },
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const periodParam = request.nextUrl.searchParams.get('period') ?? 'today';
  if (!isPeriod(periodParam)) {
    return Response.json(
      { success: false, error: `유효하지 않은 period: ${periodParam}` },
      { status: 400 },
    );
  }
  const period: Period = periodParam;

  const cacheKey = `${userId}:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    const data = await buildSummary(period, userId);
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[GET /api/dashboard/summary]', err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
