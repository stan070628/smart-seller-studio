import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

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
    `SELECT id, seller_product_id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (products.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = products[0].seller_product_id;
  if (!sellerProductId) {
    return NextResponse.json(
      { success: false, error: '이 상품에 쿠팡 seller_product_id가 연결되지 않았습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getCoupangClient();

    // ── Phase 1: 일반 쿠팡 주문 (ordersheets, FINAL_DELIVERY) ──────────────
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

    const generalItems = allOrders.flatMap((order) =>
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
    );

    // ── Phase 2: 로켓그로스 주문 (revenue-history, ROCKET_GROWTH) ──────────
    // revenue-history는 recognitionDateTo가 어제까지만 허용
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const clampedTo = to > yesterdayStr ? yesterdayStr : to;

    const rgItems: Array<{
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
      channel: string;
    }> = [];

    if (clampedTo >= from) {
      let rgToken = '';
      let pageNum = 0;
      do {
        const result = await client.getRevenueHistory({
          recognitionDateFrom: from,
          recognitionDateTo: clampedTo,
          maxPerPage: 50,
          token: rgToken,
        });
        pageNum++;
        // ── [DEBUG] revenue-history 응답 진단 ──
        console.log(`[rg-import] page=${pageNum} items=${result.items.length} nextToken=${result.nextToken ?? 'none'}`);
        if (result.items.length > 0) {
          const sample = result.items[0];
          console.log(`[rg-import] sample order → orderId=${sample.orderId} saleType="${sample.saleType}" itemCount=${sample.items.length}`);
          if (sample.items.length > 0) {
            const si = sample.items[0];
            console.log(`[rg-import] sample item → sellerProductId=${si.sellerProductId} vendorItemId=${si.vendorItemId} qty=${si.quantity}`);
          }
          // 실제 saleType 목록 (중복 제거)
          const saleTypes = [...new Set(result.items.map((o) => o.saleType))];
          console.log(`[rg-import] saleTypes on this page:`, saleTypes);
        }
        for (const order of result.items) {
          if (order.saleType !== 'ROCKET_GROWTH') continue;
          for (const item of order.items) {
            if (Number(item.sellerProductId) !== Number(sellerProductId)) continue;
            if (item.quantity <= 0) continue;
            rgItems.push({
              sold_at: order.saleDate?.slice(0, 10) || order.recognitionDate.slice(0, 10),
              quantity: item.quantity,
              selling_price: item.salePrice,
              coupang_order_item_id: `rg-${order.orderId}-${item.vendorItemId}`,
              channel: 'rocket_growth',
            });
          }
        }
        rgToken = result.nextToken ?? '';
      } while (rgToken);
      console.log(`[rg-import] total RG items collected: ${rgItems.length} (sellerProductId=${sellerProductId})`);
    }

    // ── 합산 후 DB 저장 ──────────────────────────────────────────────────────
    const allItems = [...generalItems, ...rgItems];

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
