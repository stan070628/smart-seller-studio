import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';

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

  // 날짜 계산: KST 기준 (UTC+9). paidDateTo exclusive → 내일로 설정해야 오늘 포함
  const KST = 9 * 60 * 60 * 1000;
  const body = await request.json().catch(() => null);
  const from = body?.from ?? new Date(Date.now() + KST - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + KST + 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 내일(KST)

  const pool = getSourcingPool();

  // 사용자의 RG 상품 전체 조회 → vendorItemId → product_cost_id 맵 구성
  // product_cost_channels에서 coupang_rg 매핑 조회 (새 방식)
  const { rows: rgChannels } = await pool.query(
    `SELECT product_cost_id, external_id, unit_multiplier
     FROM product_cost_channels
     WHERE user_id = $1 AND channel_type = 'coupang_rg'`,
    [user.userId],
  );
  // 기존 product_costs.vendor_item_id fallback (migration 전 데이터 대비)
  const { rows: rgProducts } = await pool.query(
    `SELECT id, vendor_item_id FROM product_costs
     WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
    [user.userId],
  );

  const vendorItemMap = new Map<number, { id: string; multiplier: number }>(); // vendorItemId → { id, multiplier }
  // fallback 먼저 (낮은 우선순위)
  for (const row of rgProducts) {
    vendorItemMap.set(Number(row.vendor_item_id), { id: row.id, multiplier: 1 });
  }
  // product_cost_channels 우선 (덮어씌움)
  for (const ch of rgChannels) {
    vendorItemMap.set(Number(ch.external_id), { id: ch.product_cost_id, multiplier: ch.unit_multiplier >= 1 ? ch.unit_multiplier : 1 });
  }

  if (vendorItemMap.size === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0, voided: 0 } });
  }

  try {
    const client = getCoupangClient();

    // RG 주문 전체 페치 — 30일 chunk 분할
    const items: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      sale_amount: number;
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
          const soldAt = new Date(Number(order.paidAt) + KST).toISOString().slice(0, 10);
          // 동일 orderId+vendorItemId가 여러 orderItems로 분리 반환될 때 수량 합산
          const orderItemMap = new Map<string, (typeof items)[number]>();
          for (const item of order.orderItems) {
            const match = vendorItemMap.get(item.vendorItemId);
            if (!match) continue;
            if (item.salesQuantity <= 0) continue;
            const key = `rg-${order.orderId}-${item.vendorItemId}`;
            const lineAmount = item.unitSalesPrice * item.salesQuantity;
            const existing = orderItemMap.get(key);
            if (existing) {
              existing.quantity += item.salesQuantity * match.multiplier;
              existing.sale_amount += lineAmount;
            } else {
              orderItemMap.set(key, {
                product_cost_id: match.id,
                sold_at: soldAt,
                quantity: item.salesQuantity * match.multiplier,
                selling_price: item.unitSalesPrice,
                sale_amount: lineAmount,
                coupang_order_item_id: key,
              });
            }
          }
          items.push(...orderItemMap.values());
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
           (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
         VALUES ($1, $2, $3, $4, $5, $6, 'rocket_growth', $7, $8)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, item.product_cost_id, item.sold_at, item.quantity, item.selling_price, item.sale_amount, item.coupang_order_item_id, resolveSaleShippingFee('rg')],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: items.length, voided: 0 } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
