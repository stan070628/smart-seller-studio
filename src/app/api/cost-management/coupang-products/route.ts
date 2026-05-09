import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getCurrentUser } from '@/lib/auth';

const ALL_STATUSES = ['APPROVED', 'UNDER_REVIEW', 'SUSPENSION', 'REJECTED'];

// GET /api/cost-management/coupang-products
// 쿠팡 윙 등록 상품 중 product_costs에 아직 연동되지 않은 목록 반환
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 1) 이미 원가관리에 등록된 seller_product_id 목록 조회 (마이그레이션 미적용 시 fallback)
    let registeredIds = new Set<number>();
    try {
      const pool = getSourcingPool();
      const { rows } = await pool.query(
        `SELECT seller_product_id FROM product_costs
         WHERE user_id = $1 AND seller_product_id IS NOT NULL`,
        [user.userId],
      );
      registeredIds = new Set<number>(rows.map((r) => Number(r.seller_product_id)));
    } catch {
      // product_costs 테이블 미생성 시 필터 없이 전체 반환
    }

    // 2) 쿠팡 윙 API에서 전체 상태 상품 목록 조회 (병렬)
    const client = getCoupangClient();
    const results = await Promise.allSettled(
      ALL_STATUSES.map((status) => client.getSellerProducts(status, 100, '')),
    );

    const allProducts = results.flatMap((r) =>
      r.status === 'fulfilled' ? r.value.items : [],
    );

    // sellerProductId 중복 제거
    const seen = new Set<number>();
    const unique = allProducts.filter((p) => {
      if (seen.has(p.sellerProductId)) return false;
      seen.add(p.sellerProductId);
      return true;
    });

    // 3) 이미 원가관리에 등록된 상품 제외
    const filtered = unique
      .filter((p) => !registeredIds.has(p.sellerProductId))
      .map((p) => ({
        seller_product_id: p.sellerProductId,
        seller_product_name: p.sellerProductName,
        status_name: p.statusName,
      }))
      .sort((a, b) => a.seller_product_name.localeCompare(b.seller_product_name, 'ko'));

    return NextResponse.json({ success: true, data: filtered });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
