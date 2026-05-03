import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import type { CollectedData } from '@/lib/ad-strategy/types';

const CACHE_HOURS = 24;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const supabase = getSupabaseServerClient();

  // 캐시 조회 (force=true이면 가장 최근 캐시도 재사용)
  const cutoff = force
    ? new Date(0).toISOString()
    : new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: cached } = await supabase
    .from('ad_strategy_cache')
    .select('collected_data, collected_at')
    .gte('collected_at', cutoff)
    .order('collected_at', { ascending: false })
    .limit(1)
    .single();

  if (cached?.collected_data) {
    const data = cached.collected_data as CollectedData;

    // 주문 API로 monthlySales 보완 (캐시 데이터도 최신 판매량으로 갱신)
    try {
      const client = getCoupangClient();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const ordersRes = await client.getOrders({
        createdAtFrom: thirtyDaysAgo,
        createdAtTo: today,
        status: 'ACCEPT',
        maxPerPage: 100,
      });
      const salesMap = new Map<string, number>();
      for (const order of ordersRes.items ?? []) {
        for (const item of order.orderItems ?? []) {
          const name = item.sellerProductName ?? '';
          salesMap.set(name, (salesMap.get(name) ?? 0) + (item.shippingCount ?? 1));
        }
      }
      for (const product of data.products) {
        product.monthlySales = salesMap.get(product.name) ?? product.monthlySales;
      }
    } catch {
      // 주문 API 실패는 무시 — 캐시의 기존 값 그대로 사용
    }

    return Response.json({ success: true, data, fromCache: true });
  }

  // 캐시 없음 → 로컬 스크래퍼 실행 필요
  return Response.json(
    {
      success: false,
      error:
        '수집된 데이터가 없습니다. 로컬에서 스크래퍼를 실행해 주세요:\n' +
        'cd scripts/ad-scraper && npm run scrape',
    },
    { status: 404 },
  );
}
