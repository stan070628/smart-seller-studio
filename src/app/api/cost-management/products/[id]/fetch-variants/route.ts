import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = rows[0].seller_product_id;
  if (!sellerProductId) {
    return NextResponse.json({ success: false, error: '윙 판매자상품ID(seller_product_id)가 없습니다.' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const detail = await client.getProductDetail(Number(sellerProductId)) as Record<string, unknown>;
    const items = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'getProductDetail 응답에 items가 없습니다.' }, { status: 422 });
    }

    // vendorItemId → 사이즈명 매핑 구성
    const variants: Record<string, string> = {};
    for (const item of items) {
      const vendorItemId = String(item.vendorItemId ?? '');
      if (!vendorItemId) continue;

      // attributes 배열에서 사이즈/색상 속성 우선 추출, 없으면 itemName 사용
      const attrs = Array.isArray(item.attributes) ? item.attributes as Record<string, unknown>[] : [];
      const sizeAttr = attrs.find((a) => {
        const key = String(a.attributeTypeName ?? '').toLowerCase();
        return key.includes('사이즈') || key.includes('size') || key.includes('색상') || key.includes('color');
      });
      const variantName = sizeAttr ? String(sizeAttr.attributeValueName ?? '') : String(item.itemName ?? '');
      if (variantName) variants[vendorItemId] = variantName;
    }

    if (Object.keys(variants).length === 0) {
      return NextResponse.json({ success: false, error: '사이즈/옵션 정보를 추출할 수 없습니다.' }, { status: 422 });
    }

    await pool.query(
      `UPDATE product_costs SET variants = $1 WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(variants), id, user.userId],
    );

    return NextResponse.json({ success: true, data: { variants } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
