import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function GET() {
  // 인증 검증
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();
  const { rows: rgProducts } = await pool.query(
    `SELECT id, vendor_item_id FROM product_costs
     WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
    [user.userId],
  );

  if (rgProducts.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  // DB에 등록된 vendorItemId 집합 구성
  const targetIds = new Set(rgProducts.map((r) => Number(r.vendor_item_id)));

  try {
    const client = getCoupangClient();
    // vendorItemId → 실재고 수량 맵
    const stockMap = new Map<number, number>();

    // 페이지네이션: nextToken이 없어질 때까지 전체 재고 목록을 순회
    let nextToken: string | undefined;
    do {
      const result = await client.getRocketGrowthInventories(nextToken ? { nextToken } : undefined);
      for (const item of result.items) {
        if (targetIds.has(item.vendorItemId)) {
          stockMap.set(item.vendorItemId, item.totalOrderableQuantity);
        }
      }
      nextToken = result.nextToken ?? undefined;
    } while (nextToken);

    // DB 상품 목록에 실재고 수량을 매핑하여 반환
    // stockMap에 없으면 쿠팡 RG 창고 미등록 상품이므로 null 처리
    const data = rgProducts.map((p) => ({
      productCostId: p.id,
      vendorItemId: Number(p.vendor_item_id),
      actualStock: stockMap.get(Number(p.vendor_item_id)) ?? null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
