import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';

// ─────────────────────────────────────────
// GET /api/cost-management/coupang-products
// 쿠팡 등록 상품 중 product_costs에 아직 연동되지 않은 목록을 반환한다.
// 상품 추가 모달의 자동완성 소스로 사용된다.
//
// coupang_registered_products 는 Supabase,
// product_costs 는 Render PostgreSQL 에 있으므로
// 두 DB를 별도로 조회한 뒤 애플리케이션 레벨에서 필터링한다.
// ─────────────────────────────────────────
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 1) Render PostgreSQL 에서 이미 원가관리에 등록된 seller_product_id 목록 조회
    const pool = getSourcingPool();
    const { rows: registeredRows } = await pool.query(
      `SELECT seller_product_id
       FROM product_costs
       WHERE user_id = $1
         AND seller_product_id IS NOT NULL`,
      [user.userId],
    );
    const registeredIds = new Set<number>(
      registeredRows.map((r) => Number(r.seller_product_id)),
    );

    // 2) Supabase 에서 쿠팡 등록 상품 조회
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('coupang_registered_products')
      .select('seller_product_id, seller_product_name')
      .eq('user_id', user.userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    // 3) 이미 원가관리에 등록된 상품을 애플리케이션 레벨에서 제외
    const filtered = (data ?? []).filter(
      (row) => !registeredIds.has(Number(row.seller_product_id)),
    );

    return NextResponse.json({ success: true, data: filtered });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
