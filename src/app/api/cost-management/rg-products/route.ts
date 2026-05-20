import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getCurrentUser } from '@/lib/auth';

// GET /api/cost-management/rg-products
// 최근 90일 RG 주문 이력에서 역추적하여 product_costs에 미등록된 RG 상품 목록 반환

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

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 이미 등록된 vendor_item_id 목록 조회
    const pool = getSourcingPool();
    let registeredVendorIds = new Set<number>();
    try {
      const { rows } = await pool.query(
        `SELECT vendor_item_id FROM product_costs
         WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
        [user.userId],
      );
      registeredVendorIds = new Set<number>(rows.map((r) => Number(r.vendor_item_id)));
    } catch {
      // 마이그레이션 미적용 시 무시
    }

    // 최근 90일 RG 주문 조회 (30일 청킹)
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const chunks = splitInto30DayChunks(from, to);

    const client = getCoupangClient();
    const productMap = new Map<number, string>(); // vendorItemId → productName

    for (const chunk of chunks) {
      let nextToken: string | undefined;
      do {
        const result = await client.getRocketGrowthOrders({
          paidDateFrom: chunk.from,
          paidDateTo: chunk.to,
          nextToken,
        });
        for (const order of result.items) {
          for (const item of order.orderItems) {
            if (!productMap.has(item.vendorItemId)) {
              productMap.set(item.vendorItemId, item.productName);
            }
          }
        }
        nextToken = result.nextToken ?? undefined;
      } while (nextToken);
    }

    // 미등록 상품만 필터링
    const data = [...productMap.entries()]
      .filter(([vendorItemId]) => !registeredVendorIds.has(vendorItemId))
      .map(([vendor_item_id, product_name]) => ({ vendor_item_id, product_name }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'ko'));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
