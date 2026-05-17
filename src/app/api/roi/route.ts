import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import type { CollectedData } from '@/lib/ad-strategy/types';
import { matchAdProduct } from '@/lib/ad-strategy/match';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
} from '@/lib/roi/calculations';
import type { SkuRoiData } from '@/lib/roi/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: SkuRoiData[]; expiresAt: number }>();

interface WingProduct {
  vendorItemId: number;
  vendorItemName: string;
  sellingPrice: number;
  salesCount: number;
  cancelledSales: number;
  avgDailySales: number;
}

interface CostStat {
  costPrice: number;
  deliveryFee: number;
  feeRate: number;
}

interface AdsStat {
  adSpend: number;
  attributedSales: number;
  clicks: number;
}

function defaultAds(): AdsStat {
  return { adSpend: 0, attributedSales: 0, clicks: 0 };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    // ── Step 1: Wing API로 30일 실판매 상품 수집 ─────────────────────────────
    const wingProducts = await fetchWingProducts().catch((e) => {
      console.error('[roi/wing] 수집 실패:', e instanceof Error ? e.message : e);
      return [] as WingProduct[];
    });

    if (wingProducts.length === 0) {
      return Response.json({ success: true, data: [] });
    }

    // ── Step 2: product_costs+cost_entries에서 원가·배송비 조회 ───────────────
    const costMap = await fetchCostMap(wingProducts, userId).catch(() => new Map<number, CostStat>());

    // ── Step 3: ad_strategy_cache에서 광고 데이터 조회 (name 매칭) ─────────────
    const supabase = getSupabaseServerClient();
    const adsMap = await fetchAdsMap(wingProducts, supabase, userId).catch(() => new Map<number, AdsStat>());

    // ── Step 4: SKU별 수익성 계산 ────────────────────────────────────────────
    const DEFAULT_FEE_RATE = 0.108;

    const skus: SkuRoiData[] = wingProducts.map((p) => {
      const cost = costMap.get(p.vendorItemId) ?? { costPrice: 0, deliveryFee: 0, feeRate: DEFAULT_FEE_RATE };
      const ads = adsMap.get(p.vendorItemId) ?? defaultAds();

      const marginAmount = calcMargin(p.sellingPrice, cost.costPrice, cost.feeRate, cost.deliveryFee);
      const marginRate = p.sellingPrice > 0 ? marginAmount / p.sellingPrice : 0;
      const conversionRate = ads.clicks > 0 ? (p.salesCount / ads.clicks) * 100 : 0;

      const breakEvenRoas = calcBreakevenRoas(p.sellingPrice, marginAmount);
      const adjustedRoas = calcAdjustedRoas(ads.attributedSales, p.cancelledSales, ads.adSpend);
      const winnerStatus = isWinner(ads.clicks, conversionRate, adjustedRoas, p.salesCount);
      // stockQty는 Wing API 미제공 → 재고회전 계산 비활성화
      const stockTurnover: { days: number; status: 'danger' | 'warning' | 'ok' } = { days: Infinity, status: 'ok' };
      const netProfit = marginAmount * p.salesCount - ads.adSpend;

      return {
        productId: String(p.vendorItemId),
        productName: p.vendorItemName,
        sellingPrice: p.sellingPrice,
        costPrice: cost.costPrice,
        feeRate: cost.feeRate,
        deliveryFee: cost.deliveryFee,
        marginAmount,
        marginRate,
        adSpend: ads.adSpend,
        attributedSales: ads.attributedSales,
        cancelledSales: p.cancelledSales,
        couponDiscount: 0,
        clicks: ads.clicks,
        conversionRate,
        salesCount: p.salesCount,
        stockQty: 0,
        avgDailySales: p.avgDailySales,
        breakEvenRoas,
        adjustedRoas,
        winnerStatus,
        stockTurnover,
        netProfit,
      };
    });

    cache.set(userId, { data: skus, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ success: true, data: skus });
  } catch (err) {
    console.error('[roi] API 오류:', err instanceof Error ? err.message : err);
    return Response.json({ success: false, error: '데이터 조회 실패' }, { status: 500 });
  }
}

/**
 * Wing API getRevenueHistory로 최근 30일간 실제 판매된 상품을 수집한다.
 * sellerProductId 기준으로 중복 제거 후 판매 집계.
 */
async function fetchWingProducts(): Promise<WingProduct[]> {
  const client = getCoupangClient();

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dateFrom = thirtyDaysAgo.toISOString().slice(0, 10);
  const dateTo = yesterday.toISOString().slice(0, 10);
  if (dateTo < dateFrom) return [];

  // 판매 내역 수집 (페이지네이션)
  interface RevItem {
    vendorItemId: number;
    vendorItemName: string;
    quantity: number;
    salePrice: number;
  }
  const allItems: RevItem[] = [];
  let token = '';

  for (let page = 0; page < 50; page++) {
    const result = await client.getRevenueHistory({
      recognitionDateFrom: dateFrom,
      recognitionDateTo: dateTo,
      maxPerPage: 50,
      token,
    });
    for (const order of result.items) {
      for (const item of order.items) {
        // vendorItemId가 0이면 데이터 없음 — sellerProductId는 Wing API에서 미제공
        if (item.vendorItemId > 0) {
          allItems.push({
            vendorItemId: item.vendorItemId,
            vendorItemName: item.vendorItemName,
            quantity: item.quantity,
            salePrice: item.salePrice,
          });
        }
      }
    }
    if (!result.nextToken) break;
    token = result.nextToken;
  }

  // vendorItemId별 집계
  const statMap = new Map<number, { name: string; salesCount: number; latestSalePrice: number }>();
  for (const item of allItems) {
    const existing = statMap.get(item.vendorItemId);
    if (existing) {
      existing.salesCount += item.quantity;
      if (item.salePrice > 0) existing.latestSalePrice = item.salePrice;
    } else {
      statMap.set(item.vendorItemId, {
        name: item.vendorItemName,
        salesCount: item.quantity,
        latestSalePrice: item.salePrice,
      });
    }
  }

  // 취소 주문 수집 (maxPerPage 50 제한)
  // vendorItemId 매칭은 어려우므로 취소 금액은 0으로 처리
  const cancelledMap = new Map<number, number>();
  try {
    const cancelResult = await client.getOrders({
      createdAtFrom: dateFrom,
      createdAtTo: today.toISOString().slice(0, 10),
      status: 'CANCEL_DONE',
      maxPerPage: 50,
    });
    for (const order of cancelResult.items ?? []) {
      for (const item of order.orderItems ?? []) {
        const vid = Number(item.vendorItemId ?? 0);
        if (vid > 0 && statMap.has(vid)) {
          cancelledMap.set(vid, (cancelledMap.get(vid) ?? 0) + (item.orderPrice ?? 0));
        }
      }
    }
  } catch (e) {
    console.warn('[roi/wing] 취소 주문 조회 실패 (무시):', e instanceof Error ? e.message : e);
  }

  return Array.from(statMap.entries()).map(([vid, stat]) => ({
    vendorItemId: vid,
    vendorItemName: stat.name,
    sellingPrice: stat.latestSalePrice,
    salesCount: stat.salesCount,
    cancelledSales: cancelledMap.get(vid) ?? 0,
    avgDailySales: stat.salesCount / 30,
  }));
}

/**
 * product_costs + cost_entries(Render PostgreSQL)에서 사용자가 입력한 가중평균 원가·배송비를 조회한다.
 * vendorItemName ↔ product_name 앞 10자 prefix 매칭.
 */
async function fetchCostMap(
  products: WingProduct[],
  userId: string,
): Promise<Map<number, CostStat>> {
  const pool = getSourcingPool();

  const { rows } = await pool.query<{
    product_name: string;
    seller_product_id: number | null;
    platform_fee_rate: number;
    weighted_avg_cost: number;
    weighted_avg_shipping: number;
  }>(
    `SELECT
       pc.product_name,
       pc.seller_product_id,
       pc.platform_fee_rate,
       COALESCE(
         SUM(ce.unit_cost * ce.quantity) FILTER (WHERE ce.id IS NOT NULL)
         / NULLIF(SUM(ce.quantity) FILTER (WHERE ce.id IS NOT NULL), 0),
         0
       ) AS weighted_avg_cost,
       COALESCE(
         SUM(ce.unit_shipping_fee * ce.quantity) FILTER (WHERE ce.id IS NOT NULL)
         / NULLIF(SUM(ce.quantity) FILTER (WHERE ce.id IS NOT NULL), 0),
         0
       ) AS weighted_avg_shipping
     FROM product_costs pc
     LEFT JOIN cost_entries ce
       ON ce.product_cost_id = pc.id AND ce.user_id = $1
     WHERE pc.user_id = $1
     GROUP BY pc.product_name, pc.seller_product_id, pc.platform_fee_rate`,
    [userId],
  );

  const rowsBySellerProductId = new Map(
    rows.filter((r) => r.seller_product_id != null).map((r) => [Number(r.seller_product_id), r]),
  );
  const rowsByName = new Map(rows.map((r) => [r.product_name, r]));

  const result = new Map<number, CostStat>();
  for (const p of products) {
    const namePrefix = p.vendorItemName.slice(0, 10);
    const matched =
      rowsBySellerProductId.get(p.vendorItemId) ??
      rowsByName.get(p.vendorItemName) ??
      rows.find(
        (r) =>
          r.product_name.includes(namePrefix) ||
          p.vendorItemName.includes(r.product_name.slice(0, 10)),
      );
    if (matched && matched.weighted_avg_cost > 0) {
      result.set(p.vendorItemId, {
        costPrice: Number(matched.weighted_avg_cost),
        deliveryFee: Number(matched.weighted_avg_shipping),
        feeRate: Number(matched.platform_fee_rate),
      });
    }
  }
  return result;
}

/**
 * ad_strategy_cache(Supabase)에서 광고 데이터를 조회한다.
 * vendorItemName ↔ product.name 앞 10자 prefix 매칭.
 */
async function fetchAdsMap(
  products: WingProduct[],
  supabase: ReturnType<typeof getSupabaseServerClient>,
  userId: string,
): Promise<Map<number, AdsStat>> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: cached, error } = await supabase
    .from('ad_strategy_cache')
    .select('collected_data')
    .eq('user_id', userId)
    .gte('collected_at', cutoff)
    .order('collected_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !cached?.collected_data) return new Map();

  const adProducts = (cached.collected_data as CollectedData).products ?? [];
  const result = new Map<number, AdsStat>();

  for (const p of products) {
    const matched = matchAdProduct(adProducts, p.vendorItemName);
    if (!matched || (!matched.adSpend && !matched.adRoas)) continue;

    const adSpend = matched.adSpend ?? 0;
    const adRoas = matched.adRoas ?? 0;
    result.set(p.vendorItemId, {
      adSpend,
      attributedSales: adSpend > 0 && adRoas > 0 ? adSpend * (adRoas / 100) : 0,
      clicks: matched.adOrders ?? 0,
    });
  }
  return result;
}
