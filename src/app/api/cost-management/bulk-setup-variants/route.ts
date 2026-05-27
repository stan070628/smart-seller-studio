import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function POST(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();

  // Step 1 — Render DB 마이그레이션 (IF NOT EXISTS, 멱등)
  await pool.query(`
    ALTER TABLE cost_entries  ADD COLUMN IF NOT EXISTS variant_name text;
    ALTER TABLE sale_records  ADD COLUMN IF NOT EXISTS variant_name text;
    ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS variants jsonb;
  `);

  // Step 2 — seller_product_id 있는 상품 전체 조회
  const { rows: products } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs
     WHERE user_id = $1 AND seller_product_id IS NOT NULL`,
    [user.userId],
  );

  const client = getCoupangClient();
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const product of products) {
    try {
      const detail = await client.getProductDetail(Number(product.seller_product_id)) as Record<string, unknown>;
      const items = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

      const variants: Record<string, string> = {};
      for (const item of items) {
        const vendorItemId = String(item.vendorItemId ?? '');
        if (!vendorItemId) continue;
        const attrs = Array.isArray(item.attributes) ? item.attributes as Record<string, unknown>[] : [];
        const sizeAttr = attrs.find((a) => {
          const key = String(a.attributeTypeName ?? '').toLowerCase();
          return key.includes('사이즈') || key.includes('size') || key.includes('색상') || key.includes('color');
        });
        const variantName = sizeAttr ? String(sizeAttr.attributeValueName ?? '') : String(item.itemName ?? '');
        if (variantName) variants[vendorItemId] = variantName;
      }

      if (Object.keys(variants).length > 0) {
        await pool.query(
          `UPDATE product_costs SET variants = $1 WHERE id = $2`,
          [JSON.stringify(variants), product.id],
        );
        updated++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`${product.id}: ${e instanceof Error ? e.message : '오류'}`);
      skipped++;
    }
  }

  return NextResponse.json({
    success: true,
    data: { migrated: true, total: products.length, updated, skipped, errors },
  });
}
