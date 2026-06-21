import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

/** [from, to] 기간을 최대 30일짜리 chunk 배열로 분할 (RG API 제한) */
function splitInto30DayChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const toDate = new Date(to);
  let cursor = new Date(from);
  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 29);
    if (end > toDate) end.setTime(toDate.getTime());
    chunks.push({ from: cursor.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

/**
 * coupang_order_item_id 형식별 orderId 추출
 * - Wing: "{orderId}-{vendorItemId}" → parts.slice(0, -1).join('-')
 * - RG:   "rg-{orderId}-{vendorItemId}" → parts[1]
 * - Naver/Manual: null 반환 (fms 호출 불필요)
 */
function extractOrderId(coupangOrderItemId: string): string | null {
  const parts = coupangOrderItemId.split('-');
  if (parts[0] === 'rg') {
    return parts[1] ?? null;
  }
  if (parts[0] === 'naver') {
    return null;
  }
  if (parts.length >= 2) {
    return parts.slice(0, -1).join('-');
  }
  return null;
}

/**
 * 다운로드쿠폰 정책 기반 할인액 계산
 * 실제 고객 사용 여부 확인 불가 — 조건 충족 시 최악 시나리오(100% 사용) 가정
 */
function calcDownloadDiscount(
  sellingPrice: number,
  policy: { rate: number; max_discount: number; min_price: number } | null,
): number {
  if (!policy) return 0;
  if (sellingPrice < policy.min_price) return 0;
  return Math.min(Math.round(sellingPrice * policy.rate), policy.max_discount);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 인증 검증
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { from, to } = body ?? {};

  // 날짜 파라미터 필수 검증
  if (!from || !to) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();

  // 채널별 unit_multiplier 조회
  const { rows: chRows } = await pool.query(
    `SELECT channel_type, external_id, unit_multiplier
     FROM product_cost_channels
     WHERE product_cost_id = $1`,
    [id],
  );
  const wingMultiplierMap = new Map<number, number>();
  const rgMultiplierMap = new Map<number, number>();
  for (const ch of chRows) {
    const m = ch.unit_multiplier >= 1 ? ch.unit_multiplier : 1;
    if (ch.channel_type === 'coupang_wing') wingMultiplierMap.set(Number(ch.external_id), m);
    if (ch.channel_type === 'coupang_rg') rgMultiplierMap.set(Number(ch.external_id), m);
  }

  // RLS 대체: user_id 조건으로 타 유저 데이터 접근 차단
  const { rows: products } = await pool.query(
    `SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no, variants, download_coupon_policy FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (products.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = products[0].seller_product_id;
  const storedVendorItemId = products[0].vendor_item_id ? Number(products[0].vendor_item_id) : null;
  const storedProductName = String(products[0].product_name ?? '');
  const downloadCouponPolicy = products[0].download_coupon_policy as {
    rate: number; max_discount: number; min_price: number;
  } | null;
  const naverChannelProductNo = products[0].naver_channel_product_no ? Number(products[0].naver_channel_product_no) : null;

  if (!sellerProductId && !storedVendorItemId && !naverChannelProductNo) {
    return NextResponse.json(
      { success: false, error: '이 상품에 연결된 채널 ID가 없습니다.' },
      { status: 400 },
    );
  }

  // variants 캐시 로드 (없으면 getProductDetail로 갱신)
  let variantsCache: Record<string, string> = {};
  const storedVariants = products[0].variants as Record<string, string> | null;
  if (storedVariants && Object.keys(storedVariants).length > 0) {
    variantsCache = storedVariants;
  } else if (sellerProductId) {
    try {
      const client0 = getCoupangClient();
      const detail0 = await client0.getProductDetail(Number(sellerProductId)) as Record<string, unknown>;
      const items0 = Array.isArray(detail0.items) ? detail0.items as Record<string, unknown>[] : [];
      for (const item of items0) {
        const vid = String(item.vendorItemId ?? '');
        if (!vid) continue;
        const attrs = Array.isArray(item.attributes) ? item.attributes as Record<string, unknown>[] : [];
        const sizeAttr = attrs.find((a) => {
          const key = String(a.attributeTypeName ?? '').toLowerCase();
          return key.includes('사이즈') || key.includes('size') || key.includes('색상') || key.includes('color');
        });
        const variantName = sizeAttr ? String(sizeAttr.attributeValueName ?? '') : String(item.itemName ?? '');
        if (variantName) variantsCache[vid] = variantName;
      }
      if (Object.keys(variantsCache).length > 0) {
        await pool.query(
          `UPDATE product_costs SET variants = $1 WHERE id = $2`,
          [JSON.stringify(variantsCache), id],
        );
        console.log(`[import] variants 캐시 갱신: ${Object.keys(variantsCache).length}개`);
      }
    } catch (e) {
      console.warn('[import] variants 캐시 갱신 실패 (스킵):', e instanceof Error ? e.message : e);
    }
  }

  try {
    const client = getCoupangClient();

    // ── Phase 1: 일반 쿠팡 주문 (ordersheets, FINAL_DELIVERY) ──────────────
    // RG 전용 상품(vendor_item_id만 있는 경우)은 일반 주문 조회 생략
    const generalItems: Array<{
      sold_at: string; quantity: number; selling_price: number;
      coupang_order_item_id: string; channel: string; variant_name: string | null;
      shipping_fee: number; coupon_discount: number;
    }> = [];

    if (sellerProductId) {
      const allOrders = [];
      let nextToken: string | null = null;
      do {
        const result = await client.getOrders({
          createdAtFrom: from,
          createdAtTo: to,
          status: 'FINAL_DELIVERY',
          maxPerPage: 50,
          ...(nextToken ? { nextToken } : {}),
        });
        allOrders.push(...result.items);
        nextToken = result.nextToken;
      } while (nextToken);

      generalItems.push(...allOrders.flatMap((order) =>
        order.orderItems
          .filter((item) => (
            Number(item.sellerProductId) === Number(sellerProductId) ||
            Number(item.vendorItemId) === Number(sellerProductId)
          ) && !item.canceled)
          .map((item) => {
            const wm = wingMultiplierMap.get(Number(item.vendorItemId)) ?? 1;
            return {
              sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
              quantity: item.shippingCount * wm,
              selling_price: item.shippingCount > 0
                ? Math.round(item.orderPrice / item.shippingCount)
                : item.salesPrice,
              coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
              channel: 'coupang',
              variant_name: variantsCache[String(item.vendorItemId)] ?? null,
              shipping_fee: 3500,
              coupon_discount: 0,
            };
          }),
      ));
    }

    // ── Phase 2: 로켓그로스 주문 (rg_open_api) ─────────────────────────────
    // vendorItemId 목록 결정:
    //   - seller_product_id 있음 → getProductDetail로 vendorItemId 추출
    //   - vendor_item_id만 있음 → 저장된 값 직접 사용 (RG 전용 상품)

    let vendorItemIds: Set<number>;
    if (sellerProductId) {
      try {
        const detail = await client.getProductDetail(Number(sellerProductId)) as Record<string, unknown>;
        const productItems = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];
        vendorItemIds = new Set(productItems.map((i) => Number(i.vendorItemId ?? 0)).filter((v) => v > 0));
      } catch {
        // sellerProductId가 유효하지 않으면 storedVendorItemId로 fallback
        vendorItemIds = new Set();
      }
      // getProductDetail에서 vendorItemId 없으면 저장된 vendor_item_id 사용
      if (vendorItemIds.size === 0 && storedVendorItemId) {
        vendorItemIds = new Set([storedVendorItemId]);
      }
      console.log(`[rg-import] vendorItemIds for sellerProductId=${sellerProductId}:`, [...vendorItemIds]);
    } else {
      vendorItemIds = new Set([storedVendorItemId!]);
      console.log(`[rg-import] vendorItemId from stored (RG-only product):`, storedVendorItemId);
    }

    const rgItems: Array<{
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
      channel: string;
      variant_name: string | null;
      shipping_fee: number;
      coupon_discount: number;
    }> = [];

    // RG API: paidDateTo exclusive → 하루 추가해야 to 날짜 포함
    const rgTo = new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const chunks = splitInto30DayChunks(from, rgTo);
    for (const chunk of chunks) {
      let rgToken: string | undefined;
      do {
        const result = await client.getRocketGrowthOrders({
          paidDateFrom: chunk.from,
          paidDateTo: chunk.to,
          nextToken: rgToken,
        });
        console.log(`[rg-import] RG chunk=${chunk.from}~${chunk.to} orders=${result.items.length} nextToken=${result.nextToken ? 'yes' : 'none'}`);
        for (const order of result.items) {
          // paidAt ms → KST 날짜 (UTC+9)
          const paidDate = new Date(Number(order.paidAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          // 동일 orderId+vendorItemId가 여러 orderItems로 분리 반환될 때 수량 합산
          const orderItemMap = new Map<string, (typeof rgItems)[number]>();
          for (const item of order.orderItems) {
            // seller_api가 Wing 상품의 vendorItemId를 반환하지 않을 때,
            // RG 주문의 productName ↔ storedProductName 대소문자 무시 + 양방향 prefix 매칭
            const matchByVendorItemId = vendorItemIds.size > 0 && vendorItemIds.has(item.vendorItemId);
            const nStored = storedProductName.toLowerCase().trim();
            const nItem = item.productName.toLowerCase().trim();
            const MIN_NAME_MATCH_LENGTH = 8;
            const matchByProductName = vendorItemIds.size === 0
              && nStored.length >= MIN_NAME_MATCH_LENGTH && nItem.length >= MIN_NAME_MATCH_LENGTH
              && (nItem.startsWith(nStored) || nStored.startsWith(nItem));
            if (!matchByVendorItemId && !matchByProductName) continue;
            if (item.salesQuantity <= 0) continue;
            const key = `rg-${order.orderId}-${item.vendorItemId}`;
            const existing = orderItemMap.get(key);
            const rm = rgMultiplierMap.get(item.vendorItemId) ?? 1;
            if (existing) {
              existing.quantity += item.salesQuantity * rm;
            } else {
              orderItemMap.set(key, {
                sold_at: paidDate,
                quantity: item.salesQuantity * rm,
                selling_price: item.unitSalesPrice,
                coupang_order_item_id: key,
                channel: 'rocket_growth',
                variant_name: variantsCache[String(item.vendorItemId)] ?? null,
                shipping_fee: 0,
                coupon_discount: 0,
              });
            }
          }
          rgItems.push(...orderItemMap.values());
        }
        rgToken = result.nextToken ?? undefined;
      } while (rgToken);
    }
    console.log(`[rg-import] total RG items collected: ${rgItems.length} (sellerProductId=${sellerProductId})`);


    // ── Phase 3: 네이버 주문 (naver-commerce-client) ───────────────────────
    const NAVER_CANCELLED = new Set([
      'CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE',
      'CANCELED', 'RETURNED', 'EXCHANGED',
    ]);
    const naverItems: Array<{
      sold_at: string; quantity: number; selling_price: number;
      coupang_order_item_id: string; channel: string; variant_name: string | null;
      shipping_fee: number; coupon_discount: number;
    }> = [];

    if (naverChannelProductNo) {
      try {
        const naverClient = getNaverCommerceClient();
        const naverResult = await naverClient.getOrders({ fromDate: from, toDate: to });
        for (const order of naverResult.contents) {
          if (NAVER_CANCELLED.has(order.productOrderStatus)) continue;
          if (order.claimStatus && NAVER_CANCELLED.has(order.claimStatus)) continue;
          if (order.channelProductNo !== naverChannelProductNo) continue;
          if (order.quantity <= 0) continue;
          const soldAt = order.orderDate?.slice(0, 10);
          if (!soldAt) continue;
          naverItems.push({
            sold_at: soldAt,
            quantity: order.quantity,
            selling_price: order.quantity > 0
              ? Math.round(order.totalPaymentAmount / order.quantity)
              : order.totalPaymentAmount,
            coupang_order_item_id: `naver-${order.productOrderId}`,
            channel: 'naver',
            variant_name: null,
            shipping_fee: 3500,
            coupon_discount: 0,
          });
        }
        console.log(`[import] 네이버 items: ${naverItems.length} (channelProductNo=${naverChannelProductNo})`);
      } catch (e) {
        console.warn('[import] 네이버 조회 실패 (스킵):', e instanceof Error ? e.message : e);
      }
    }

    // ── 합산 후 DB 저장 ──────────────────────────────────────────────────────
    const allItems = [...generalItems, ...rgItems, ...naverItems];

    // coupon_discount 계산: Wing/RG는 fms API + 다운로드쿠폰 정책 합산, Naver/Manual은 0
    for (const item of allItems) {
      if (item.channel === 'naver' || item.channel === 'manual') continue;
      const orderId = extractOrderId(item.coupang_order_item_id);
      if (!orderId) continue;
      const immediateDiscount = await client.getOrderImmediateDiscount(orderId);
      const downloadDiscount = calcDownloadDiscount(item.selling_price, downloadCouponPolicy);
      item.coupon_discount = immediateDiscount + downloadDiscount;
    }

    // coupon_discount = 0인 기존 행만 갱신, 이미 계산된 행은 보호
    let imported = 0;
    let skipped = 0;
    for (const item of allItems) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, variant_name, shipping_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (coupang_order_item_id) DO UPDATE
           SET coupon_discount = EXCLUDED.coupon_discount
           WHERE sale_records.coupon_discount = 0`,
        [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.coupon_discount, item.channel, item.coupang_order_item_id, item.variant_name ?? null, item.shipping_fee],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    // 기존 variant_name=null 레코드 소급 적용
    if (Object.keys(variantsCache).length > 0) {
      const { rows: nullRows } = await pool.query(
        `SELECT id, coupang_order_item_id FROM sale_records
         WHERE product_cost_id = $1 AND variant_name IS NULL AND coupang_order_item_id IS NOT NULL`,
        [id],
      );
      let backfilled = 0;
      for (const row of nullRows) {
        const key: string = row.coupang_order_item_id;
        // key 형식: rg-{orderId}-{vendorItemId} 또는 {orderId}-{vendorItemId}
        const parts = key.split('-');
        const vendorItemId = parts[parts.length - 1];
        const variantName = variantsCache[vendorItemId];
        if (variantName) {
          await pool.query(
            `UPDATE sale_records SET variant_name = $1 WHERE id = $2`,
            [variantName, row.id],
          );
          backfilled++;
        }
      }
      if (backfilled > 0) console.log(`[import] 소급 적용: ${backfilled}건`);
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: allItems.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
