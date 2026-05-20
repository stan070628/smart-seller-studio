import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getCurrentUser } from '@/lib/auth';

// GET /api/cost-management/rg-products
// RG inventory API로 전체 등록 상품을 조회하고, 주문 이력에서 상품명을 보완하여 반환.
// 판매 이력이 없는 재고 상품도 포함됨.

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

    const client = getCoupangClient();

    // ── Phase 1: inventory API로 전체 등록 vendorItemId 수집 ──────────────────
    const inventoryIds = new Set<number>();
    let invToken: string | undefined;
    do {
      const result = await client.getRocketGrowthInventories(invToken ? { nextToken: invToken } : undefined);
      for (const item of result.items) {
        if (item.vendorItemId > 0) inventoryIds.add(item.vendorItemId);
      }
      invToken = result.nextToken ?? undefined;
    } while (invToken);

    // ── Phase 2: 최근 90일 주문 이력에서 vendorItemId → productName 맵 구성 ──
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const chunks = splitInto30DayChunks(from, to);

    const nameMap = new Map<number, string>(); // vendorItemId → productName
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
            if (!nameMap.has(item.vendorItemId)) {
              nameMap.set(item.vendorItemId, item.productName);
            }
          }
        }
        nextToken = result.nextToken ?? undefined;
      } while (nextToken);
    }

    // ── Phase 3: 병합 후 미등록 상품만 필터링하여 반환 ───────────────────────
    const data = [...inventoryIds]
      .filter((vendorItemId) => !registeredVendorIds.has(vendorItemId))
      .map((vendor_item_id) => ({
        vendor_item_id,
        product_name: nameMap.get(vendor_item_id) ?? `RG상품 #${vendor_item_id}`,
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'ko'));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
