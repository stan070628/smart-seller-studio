import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

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

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { from, to } = body ?? {};
  if (!from || !to) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();

  // 사용자의 RG 상품 전체 조회 → vendorItemId → product_cost_id 맵 구성
  const { rows: rgProducts } = await pool.query(
    `SELECT id, vendor_item_id FROM product_costs
     WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
    [user.userId],
  );
  if (rgProducts.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  const vendorItemMap = new Map<number, string>(); // vendorItemId → product_cost_id
  for (const row of rgProducts) {
    vendorItemMap.set(Number(row.vendor_item_id), row.id);
  }

  try {
    const client = getCoupangClient();

    // RG 주문 전체 페치 — 30일 chunk 분할
    const items: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
    }> = [];

    for (const chunk of splitInto30DayChunks(from, to)) {
      let nextToken: string | undefined;
      do {
        const result = await client.getRocketGrowthOrders({
          paidDateFrom: chunk.from,
          paidDateTo: chunk.to,
          nextToken,
        });
        for (const order of result.items) {
          const soldAt = new Date(Number(order.paidAt)).toISOString().slice(0, 10);
          for (const item of order.orderItems) {
            const productCostId = vendorItemMap.get(item.vendorItemId);
            if (!productCostId) continue;
            if (item.salesQuantity <= 0) continue;
            items.push({
              product_cost_id: productCostId,
              sold_at: soldAt,
              quantity: item.salesQuantity,
              selling_price: item.unitSalesPrice,
              coupang_order_item_id: `rg-${order.orderId}-${item.vendorItemId}`,
            });
          }
        }
        nextToken = result.nextToken ?? undefined;
      } while (nextToken);
    }

    // sale_records에 일괄 insert
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, 'rocket_growth', $6)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, item.product_cost_id, item.sold_at, item.quantity, item.selling_price, item.coupang_order_item_id],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: items.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
