import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// revenue-history는 최대 31일 조회 — 31일 단위로 분할
function splitInto31DayChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const toDate = new Date(to);
  let cursor = new Date(from);
  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 30); // 31일 포함
    if (end > toDate) end.setTime(toDate.getTime());
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const KST = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + KST - 86400000).toISOString().slice(0, 10);

  const body = await request.json().catch(() => null);
  const from = body?.from ?? new Date(Date.now() + KST - 90 * 86400000).toISOString().slice(0, 10);
  const rawTo = body?.to ?? today;
  // recognitionDateTo는 어제까지만 허용 — 오늘 이상이면 yesterday로 clamp
  const to = rawTo >= today ? yesterday : rawTo;

  const pool = getSourcingPool();

  // 사용자의 윙 상품 전체 조회 → sellerProductId → product_cost_id 맵 구성
  const { rows: wingProducts } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs
     WHERE user_id = $1 AND seller_product_id IS NOT NULL`,
    [user.userId],
  );

  if (wingProducts.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  const sellerProductMap = new Map<number, string>(); // sellerProductId → product_cost_id
  for (const row of wingProducts) {
    sellerProductMap.set(Number(row.seller_product_id), row.id);
  }

  try {
    const client = getCoupangClient();

    // revenue-history 전체 페치 — 31일 chunk 분할
    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
    }> = [];

    for (const chunk of splitInto31DayChunks(from, to)) {
      let token: string | undefined;
      do {
        const result = await client.getRevenueHistory({
          recognitionDateFrom: chunk.from,
          recognitionDateTo: chunk.to,
          maxPerPage: 50,
          token: token ?? '',
        });
        for (const order of result.items) {
          if (order.saleType !== 'SALE') continue;
          for (const item of order.items) {
            const productCostId = sellerProductMap.get(item.sellerProductId);
            if (!productCostId) continue;
            if (item.quantity <= 0) continue;
            records.push({
              product_cost_id: productCostId,
              sold_at: order.saleDate.slice(0, 10),
              quantity: item.quantity,
              selling_price: item.salePrice,
              coupang_order_item_id: `wing-${order.orderId}-${item.vendorItemId}`,
            });
          }
        }
        token = result.nextToken ?? undefined;
      } while (token);
    }

    // sale_records에 일괄 insert — 중복은 coupang_order_item_id unique constraint로 skip
    let imported = 0;
    let skipped = 0;
    for (const rec of records) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, 'coupang', $6)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.coupang_order_item_id],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: records.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
