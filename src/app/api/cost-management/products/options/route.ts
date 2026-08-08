import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/**
 * GET /api/cost-management/products/options — 상품 선택지
 *
 * 기존 목록 API(`GET /api/cost-management/products`)는 상품마다 FIFO를 계산해
 * 수익 지표를 만든다. 드롭다운 하나 채우자고 그걸 부를 수 없다.
 * 여기서는 이름과 소분 기본값만 낸다.
 *
 * 라우트 경로가 `[id]`와 형제이나 Next.js는 정적 세그먼트를 먼저 맞추고
 * 상품 id는 uuid라 `options`와 충돌하지 않는다.
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `SELECT id, product_name, subdivision_unit
       FROM product_costs
       WHERE user_id = $1 AND hidden = false
       ORDER BY product_name`,
      [user.userId],
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
