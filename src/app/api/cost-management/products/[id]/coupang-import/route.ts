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

  // RLS 대체: user_id 조건으로 타 유저 데이터 접근 차단
  const { rows: products } = await pool.query(
    `SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (products.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = products[0].seller_product_id;
  const storedVendorItemId = products[0].vendor_item_id ? Number(products[0].vendor_item_id) : null;
  const storedProductName = String(products[0].product_name ?? '');
  const naverChannelProductNo = products[0].naver_channel_product_no ? Number(products[0].naver_channel_product_no) : null;

  if (!sellerProductId && !storedVendorItemId && !naverChannelProductNo) {
    return NextResponse.json(
      { success: false, error: '이 상품에 연결된 채널 ID가 없습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getCoupangClient();

    // ── Phase 1: 일반 쿠팡 주문 (ordersheets, FINAL_DELIVERY) ──────────────
    // RG 전용 상품(vendor_item_id만 있는 경우)은 일반 주문 조회 생략
    const generalItems: Array<{
      sold_at: string; quantity: number; selling_price: number;
      coupang_order_item_id: string; channel: string;
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
          .filter((item) => Number(item.sellerProductId) === Number(sellerProductId) && !item.canceled)
          .map((item) => ({
            sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
            quantity: item.shippingCount,
            selling_price: item.shippingCount > 0
              ? Math.round(item.orderPrice / item.shippingCount)
              : item.salesPrice,
            coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
            channel: 'coupang',
          })),
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
            rgItems.push({
              sold_at: paidDate,
              quantity: item.salesQuantity,
              selling_price: item.unitSalesPrice,
              coupang_order_item_id: `rg-${order.orderId}-${item.vendorItemId}`,
              channel: 'rocket_growth',
            });
          }
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
      coupang_order_item_id: string; channel: string;
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
          });
        }
        console.log(`[import] 네이버 items: ${naverItems.length} (channelProductNo=${naverChannelProductNo})`);
      } catch (e) {
        console.warn('[import] 네이버 조회 실패 (스킵):', e instanceof Error ? e.message : e);
      }
    }

    // ── 합산 후 DB 저장 ──────────────────────────────────────────────────────
    const allItems = [...generalItems, ...rgItems, ...naverItems];

    // 중복 방지: ON CONFLICT DO NOTHING으로 재임포트 시 스킵
    let imported = 0;
    let skipped = 0;
    for (const item of allItems) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.channel, item.coupang_order_item_id],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: allItems.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
