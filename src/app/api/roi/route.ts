import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
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

    const wingData = await fetchWingProductStats(userId).catch(() => [] as WingProductStat[]);
    const adsData = await fetchAdsProductStats(userId).catch(() => [] as AdsProductStat[]);

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

async function fetchWingProductStats(_userId: string): Promise<WingProductStat[]> {
  return [];
}

async function fetchAdsProductStats(_userId: string): Promise<AdsProductStat[]> {
  return [];
}
