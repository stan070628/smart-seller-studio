import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// ─────────────────────────────────────────
// GET /api/cost-management/coupang-products
// 쿠팡 등록 상품 중 product_costs에 아직 연동되지 않은 목록을 반환한다.
// 상품 추가 모달의 자동완성 소스로 사용된다.
// ─────────────────────────────────────────
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // NOT EXISTS 서브쿼리로 이미 원가관리에 등록된 상품을 제외
  const { rows } = await pool.query(
    `SELECT crp.seller_product_id, crp.seller_product_name
     FROM coupang_registered_products crp
     WHERE crp.user_id = $1
       AND crp.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_costs pc
         WHERE pc.user_id = $1
           AND pc.seller_product_id = crp.seller_product_id
       )
     ORDER BY crp.created_at DESC
     LIMIT 100`,
    [user.userId],
  );

  return NextResponse.json({ success: true, data: rows });
}
