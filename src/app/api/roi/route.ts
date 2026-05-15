import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
import type { CollectedData } from '@/lib/ad-strategy/types';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
  calcStockTurnover,
} from '@/lib/roi/calculations';
import type { SkuRoiData } from '@/lib/roi/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: SkuRoiData[]; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: sourcingItems, error: dbError } = await supabase
      .from('sourcing_items')
      .select('id, product_name, price_dome, deli_fee, coupang_category_path')
      .eq('user_id', userId)
      .not('price_dome', 'is', null);

    if (dbError) {
      console.error('[roi] DB error:', dbError);
      return Response.json({ success: false, error: '데이터 조회 실패' }, { status: 500 });
    }

    if (!sourcingItems || sourcingItems.length === 0) {
      return Response.json({ success: true, data: [] });
    }

    // sourcing_items.product_name → id(UUID) 역방향 매핑 맵 구성
    const sourcingNames = new Map<string, string>(
      (sourcingItems as { id: string; product_name: string | null }[])
        .filter((it) => !!it.product_name)
        .map((it) => [it.id, it.product_name as string]),
    );

    const wingData = await fetchWingProductStats(userId, sourcingNames).catch(() => [] as WingProductStat[]);
    const adsData = await fetchAdsProductStats(userId, sourcingNames).catch(() => [] as AdsProductStat[]);

    const wingMap = new Map(wingData.map((d) => [d.productId, d]));
    const adsMap = new Map(adsData.map((d) => [d.productId, d]));

    interface SourcingItem {
      id: string;
      product_name: string | null;
      price_dome: number | null;
      deli_fee: number | null;
      coupang_category_path: string | null;
    }

    const skus: SkuRoiData[] = (sourcingItems as SourcingItem[]).map((item) => {
      const wing = wingMap.get(item.id) ?? defaultWingStat();
      const ads = adsMap.get(item.id) ?? defaultAdsStat();

      const feeResult = resolveCoupangFee(item.coupang_category_path);
      const feeRate = feeResult.rate;
      const costPrice = item.price_dome ?? 0;
      const deliveryFee = item.deli_fee ?? 0;
      const sellingPrice = wing.sellingPrice ?? 0;

      const marginAmount = calcMargin(sellingPrice, costPrice, feeRate, deliveryFee);
      const marginRate = sellingPrice > 0 ? marginAmount / sellingPrice : 0;
      const conversionRate =
        ads.clicks > 0 ? (wing.salesCount / ads.clicks) * 100 : 0;

      const breakEvenRoas = calcBreakevenRoas(sellingPrice, marginAmount);
      const adjustedRoas = calcAdjustedRoas(
        ads.attributedSales,
        wing.cancelledSales,
        ads.adSpend
      );
      const winnerStatus = isWinner(
        ads.clicks,
        conversionRate,
        adjustedRoas,
        wing.salesCount
      );
      const stockTurnover = calcStockTurnover(wing.stockQty, wing.avgDailySales);
      const netProfit = marginAmount * wing.salesCount - ads.adSpend;

      return {
        productId: item.id,
        productName: item.product_name ?? '',
        sellingPrice,
        costPrice,
        feeRate,
        deliveryFee,
        marginAmount,
        marginRate,
        adSpend: ads.adSpend,
        attributedSales: ads.attributedSales,
        cancelledSales: wing.cancelledSales,
        couponDiscount: wing.couponDiscount,
        clicks: ads.clicks,
        conversionRate,
        salesCount: wing.salesCount,
        stockQty: wing.stockQty,
        avgDailySales: wing.avgDailySales,
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
    console.error('[roi] API error:', err);
    return Response.json({ success: false, error: '데이터 조회 실패' }, { status: 500 });
  }
}

interface WingProductStat {
  productId: string;
  sellingPrice: number;
  salesCount: number;
  cancelledSales: number;
  couponDiscount: number;
  stockQty: number;
  avgDailySales: number;
}

interface AdsProductStat {
  productId: string;
  adSpend: number;
  attributedSales: number;
  clicks: number;
}

function defaultWingStat(): WingProductStat {
  return {
    productId: '',
    sellingPrice: 0,
    salesCount: 0,
    cancelledSales: 0,
    couponDiscount: 0,
    stockQty: 0,
    avgDailySales: 0,
  };
}

function defaultAdsStat(): AdsProductStat {
  return { productId: '', adSpend: 0, attributedSales: 0, clicks: 0 };
}

/**
 * Wing API (getRevenueHistory + getOrders)로 30일 판매 데이터를 수집하여
 * sourcing_items의 product_name 기반으로 productId(UUID)에 매핑한다.
 *
 * @param userId Supabase 사용자 ID — sourcing_items.user_id 필터 용도
 * @param sourcingNames productId(UUID) → product_name 매핑 맵
 */
async function fetchWingProductStats(
  _userId: string,
  sourcingNames: Map<string, string>,
): Promise<WingProductStat[]> {
  try {
    const client = getCoupangClient();

    // revenue-history API 제약: recognitionDateTo는 어제까지만 허용
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dateFrom = thirtyDaysAgo.toISOString().slice(0, 10);
    const dateTo = yesterday.toISOString().slice(0, 10);

    if (dateTo < dateFrom) return [];

    // ── Step 1: 30일 매출 내역 수집 (페이지네이션) ──────────────────────────
    interface RevenueItem {
      sellerProductId: number;
      vendorItemName: string;
      quantity: number;
      salePrice: number;
      saleAmount: number;
    }
    const allRevItems: RevenueItem[] = [];

    let token = '';
    const MAX_PAGES = 50;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getRevenueHistory({
        recognitionDateFrom: dateFrom,
        recognitionDateTo: dateTo,
        maxPerPage: 50,
        token,
      });

      for (const order of result.items) {
        for (const item of order.items) {
          allRevItems.push({
            sellerProductId: item.sellerProductId,
            vendorItemName: item.vendorItemName,
            quantity: item.quantity,
            salePrice: item.salePrice,
            saleAmount: item.saleAmount,
          });
        }
      }

      if (!result.nextToken) break;
      token = result.nextToken;
    }

    // ── Step 2: 취소 주문 수집 ───────────────────────────────────────────────
    const cancelledMap = new Map<number, number>(); // sellerProductId → 취소 판매금액 합계
    try {
      const cancelResult = await client.getOrders({
        createdAtFrom: dateFrom,
        createdAtTo: today.toISOString().slice(0, 10),
        status: 'CANCEL_DONE',
        maxPerPage: 100,
      });
      for (const order of cancelResult.items ?? []) {
        for (const item of order.orderItems ?? []) {
          const spId = Number(item.sellerProductId);
          cancelledMap.set(spId, (cancelledMap.get(spId) ?? 0) + (item.orderPrice ?? 0));
        }
      }
    } catch (cancelErr) {
      // 취소 주문 조회 실패는 무시 — cancelledSales 를 0으로 처리
      console.warn('[roi/wing] 취소 주문 조회 실패 (무시):', cancelErr instanceof Error ? cancelErr.message : cancelErr);
    }

    // ── Step 3: sellerProductId별 집계 ──────────────────────────────────────
    interface SellerStat {
      latestSalePrice: number;
      salesCount: number;
      saleAmountSum: number;
    }
    const sellerStatMap = new Map<number, SellerStat>();

    for (const item of allRevItems) {
      const spId = item.sellerProductId;
      if (spId <= 0) continue;
      const existing = sellerStatMap.get(spId);
      if (existing) {
        existing.salesCount += item.quantity;
        existing.saleAmountSum += item.saleAmount;
        // 최신 판매가 유지 (마지막 레코드 기준)
        if (item.salePrice > 0) existing.latestSalePrice = item.salePrice;
      } else {
        sellerStatMap.set(spId, {
          latestSalePrice: item.salePrice,
          salesCount: item.quantity,
          saleAmountSum: item.saleAmount,
        });
      }
    }

    // ── Step 4: sourcing_items의 product_name으로 productId(UUID)에 매핑 ────
    // vendorItemName 앞 10자 prefix 매칭 방식 (ad-strategy collect 동일 패턴)
    const result: WingProductStat[] = [];

    for (const [productId, productName] of sourcingNames.entries()) {
      const namePrefix = productName.slice(0, 10);

      // sellerProductId별로 상품명 매핑 탐색
      let matchedSpId: number | null = null;
      for (const [spId] of sellerStatMap.entries()) {
        // allRevItems에서 해당 spId의 vendorItemName으로 매칭 시도
        const revItem = allRevItems.find((it) => it.sellerProductId === spId);
        if (!revItem) continue;

        const itemName = revItem.vendorItemName;
        if (
          itemName === productName ||
          itemName.includes(namePrefix) ||
          productName.includes(itemName.slice(0, 10))
        ) {
          matchedSpId = spId;
          break;
        }
      }

      if (matchedSpId === null) continue;

      const stat = sellerStatMap.get(matchedSpId)!;
      result.push({
        productId,
        sellingPrice: stat.latestSalePrice,
        salesCount: stat.salesCount,
        cancelledSales: cancelledMap.get(matchedSpId) ?? 0,
        couponDiscount: 0, // 쿠폰 할인 데이터 미제공 — 0으로 fallback
        stockQty: 0,       // 재고 데이터 미제공 — 0으로 fallback
        avgDailySales: stat.salesCount / 30,
      });
    }

    return result;
  } catch (err) {
    console.error('[roi/wing] fetchWingProductStats 오류:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * ad_strategy_cache 테이블에서 가장 최근 수집 데이터를 읽어
 * sourcing_items의 product_name 기반으로 productId(UUID)에 매핑한다.
 *
 * collected_data.products[].adSpend, adRoas, adOrders 필드를 사용.
 * attributedSales = adSpend * (adRoas / 100) 으로 역산.
 * clicks 는 adOrders 로 근사 (직접 클릭수 미제공).
 *
 * @param _userId 현재 미사용 (ad_strategy_cache 는 단일 계정 테이블)
 * @param sourcingNames productId(UUID) → product_name 매핑 맵
 */
async function fetchAdsProductStats(
  _userId: string,
  sourcingNames: Map<string, string>,
): Promise<AdsProductStat[]> {
  try {
    const supabase = getSupabaseServerClient();

    // 24시간 이내 가장 최근 캐시 조회
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: cached, error } = await supabase
      .from('ad_strategy_cache')
      .select('collected_data, collected_at')
      .gte('collected_at', cutoff)
      .order('collected_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !cached?.collected_data) return [];

    const data = cached.collected_data as CollectedData;
    const products = data.products ?? [];

    const result: AdsProductStat[] = [];

    for (const [productId, productName] of sourcingNames.entries()) {
      const namePrefix = productName.slice(0, 10);

      // 상품명 완전 일치 → 앞 10자 prefix 매칭 순으로 폴백
      const matched =
        products.find((p) => p.name === productName) ??
        products.find(
          (p) =>
            p.name.includes(namePrefix) ||
            productName.includes(p.name.slice(0, 10)),
        );

      if (!matched) continue;
      if (!matched.adSpend && !matched.adRoas) continue;

      const adSpend = matched.adSpend ?? 0;
      const adRoas = matched.adRoas ?? 0;
      // attributedSales = adSpend × (ROAS / 100)
      const attributedSales = adSpend > 0 && adRoas > 0 ? adSpend * (adRoas / 100) : 0;
      // clicks 는 adOrders 로 근사 (광고 전환 주문수)
      const clicks = matched.adOrders ?? 0;

      result.push({ productId, adSpend, attributedSales, clicks });
    }

    return result;
  } catch (err) {
    console.error('[roi/ads] fetchAdsProductStats 오류:', err instanceof Error ? err.message : err);
    return [];
  }
}
