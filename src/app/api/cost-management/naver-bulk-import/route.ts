import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

const CANCELLED_STATUSES = new Set([
  'CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE',
  'CANCELED', 'RETURNED', 'EXCHANGED',
]);

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const KST = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);

  const body = await request.json().catch(() => null);
  const from = body?.from ?? new Date(Date.now() + KST - 90 * 86400000).toISOString().slice(0, 10);
  const to = body?.to ?? today;

  const pool = getSourcingPool();

  const { rows: productRows } = await pool.query(
    `SELECT id, naver_channel_product_no FROM product_costs
     WHERE user_id = $1 AND naver_channel_product_no IS NOT NULL`,
    [user.userId],
  );

  if (productRows.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  const channelProductNoMap = new Map<number, string>();
  for (const row of productRows) {
    channelProductNoMap.set(Number(row.naver_channel_product_no), row.id);
  }

  try {
    const client = getNaverCommerceClient();
    const result = await client.getOrders({ fromDate: from, toDate: to });

    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      naver_order_id: string;
    }> = [];

    for (const order of result.contents) {
      if (CANCELLED_STATUSES.has(order.productOrderStatus)) continue;
      if (order.claimStatus && CANCELLED_STATUSES.has(order.claimStatus)) continue;
      if (!order.channelProductNo) continue;
      const productCostId = channelProductNoMap.get(order.channelProductNo);
      if (!productCostId) continue;
      if (order.quantity <= 0) continue;
      const soldAt = order.orderDate?.slice(0, 10);
      if (!soldAt) continue;
      const unitPrice = order.quantity > 0
        ? Math.round(order.totalPaymentAmount / order.quantity)
        : order.totalPaymentAmount;
      records.push({
        product_cost_id: productCostId,
        sold_at: soldAt,
        quantity: order.quantity,
        selling_price: unitPrice,
        naver_order_id: `naver-${order.productOrderId}`,
      });
    }

    let imported = 0;
    const CHUNK = 200;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders = chunk.map((rec, idx) => {
        const base = idx * 6;
        values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.naver_order_id);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},'naver',$${base + 6})`;
      });
      const r = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        values,
      );
      imported += r.rowCount ?? 0;
    }
    const skipped = records.length - imported;

    return NextResponse.json({ success: true, data: { imported, skipped, total: records.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
