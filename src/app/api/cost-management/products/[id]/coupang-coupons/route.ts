import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

/**
 * GET /api/cost-management/products/[id]/coupang-coupons
 * 벤더 전체 쿠폰 목록을 조회하고 상품명으로 필터링해 반환.
 * PRICE 타입: 정액 할인 (discount 필드에 원 단위 금액)
 * RATE 타입: 정률 할인 (실제 율은 API 미반환, 사용자가 직접 입력 필요)
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT product_name, seller_product_id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const productName: string = String(rows[0].product_name ?? '').toLowerCase().trim();

  try {
    const client = getCoupangClient();
    const all = await client.getVendorCoupons();

    // APPLIED 쿠폰만 — 상품명 포함 여부로 우선 정렬 (없으면 전체 반환)
    const applied = all.filter((c) => c.status === 'APPLIED');
    const nameLower = productName.slice(0, 10); // 앞 10자로 매칭
    const matched = applied.filter((c) =>
      nameLower.length >= 4 && c.promotionName.toLowerCase().includes(nameLower)
    );

    return NextResponse.json({
      success: true,
      data: {
        matched,          // 상품명 매칭 쿠폰 (자동선택 후보)
        all: applied,     // 전체 활성 쿠폰 (사용자가 직접 선택)
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
