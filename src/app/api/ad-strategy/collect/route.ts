import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { scrapeAdData } from '@/lib/ad-strategy/scraper';
import type { CollectedData } from '@/lib/ad-strategy/types';

const CACHE_HOURS = 24;
const FIXED_USER_ID = 'cheong-yeon';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const supabase = getSupabaseServerClient();

  // 24h 캐시 확인 (force=false 이면 재사용)
  if (!force) {
    const cutoff = new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('ad_strategy_cache')
      .select('collected_data, collected_at')
      .gte('collected_at', cutoff)
      .order('collected_at', { ascending: false })
      .limit(1)
      .single();

    if (cached?.collected_data) {
      return Response.json({
        success: true,
        data: cached.collected_data as CollectedData,
        fromCache: true,
      });
    }
  }

  try {
    // 1. Playwright 스크래핑
    const scraped = await scrapeAdData();

    // 2. CoupangClient 주문 API로 30일 판매 수량 보완
    const client = getCoupangClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    try {
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

      for (const product of scraped.products) {
        product.monthlySales = salesMap.get(product.name) ?? 0;
      }
    } catch (orderErr) {
      console.warn('[ad-strategy/collect] 주문 API 실패 (무시):', orderErr);
    }

    // 3. Supabase 캐시 저장
    await supabase.from('ad_strategy_cache').insert({
      user_id: FIXED_USER_ID,
      collected_data: scraped,
      collected_at: scraped.collectedAt,
    });

    return Response.json({ success: true, data: scraped, fromCache: false });
  } catch (err) {
    console.error('[ad-strategy/collect]', err);
    const message = err instanceof Error ? err.message : '수집 실패';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
