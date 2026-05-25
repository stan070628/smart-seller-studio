import type { Pool } from 'pg';
import type { CostcoApiProduct } from '@/types/costco';
import { parseProductUnit } from './unit-parser';

export async function upsertCostcoProduct(pool: Pool, product: CostcoApiProduct): Promise<void> {
  const unitResult = parseProductUnit(product.title);
  const unitType       = unitResult.success ? unitResult.parsed.unitType       : null;
  const totalQuantity  = unitResult.success ? unitResult.parsed.totalQuantity  : null;
  const baseUnit       = unitResult.success ? unitResult.parsed.baseUnit       : null;
  const unitPriceLabel = unitResult.success ? unitResult.parsed.unitPriceLabel : null;
  const unitPrice =
    unitResult.success && totalQuantity && totalQuantity > 0
      ? Math.round((product.price / totalQuantity) * unitResult.parsed.unitPriceDivisor * 100) / 100
      : null;

  await pool.query(
    `INSERT INTO public.costco_products
       (product_code, title, category_name, category_code, price, original_price,
        image_url, product_url, brand,
        average_rating, review_count, stock_status,
        first_price, lowest_price,
        unit_type, total_quantity, base_unit, unit_price, unit_price_label,
        is_active, collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$5,$13,$14,$15,$16,$17,true,now())
     ON CONFLICT (product_code) DO UPDATE SET
       title            = EXCLUDED.title,
       category_name    = EXCLUDED.category_name,
       category_code    = EXCLUDED.category_code,
       price            = EXCLUDED.price,
       original_price   = EXCLUDED.original_price,
       image_url        = EXCLUDED.image_url,
       product_url      = EXCLUDED.product_url,
       brand            = EXCLUDED.brand,
       average_rating   = EXCLUDED.average_rating,
       review_count     = EXCLUDED.review_count,
       stock_status     = EXCLUDED.stock_status,
       first_price      = COALESCE(costco_products.first_price, EXCLUDED.price),
       lowest_price     = LEAST(COALESCE(costco_products.lowest_price, EXCLUDED.price), EXCLUDED.price),
       unit_type        = EXCLUDED.unit_type,
       total_quantity   = EXCLUDED.total_quantity,
       base_unit        = EXCLUDED.base_unit,
       unit_price       = EXCLUDED.unit_price,
       unit_price_label = EXCLUDED.unit_price_label,
       is_active        = true,
       collected_at     = now(),
       updated_at       = now()`,
    [
      product.productCode,
      product.title,
      product.categoryName,
      product.categoryCode,
      product.price,
      product.originalPrice ?? null,
      product.imageUrl ?? null,
      product.productUrl,
      product.brand ?? null,
      product.averageRating ?? null,
      product.reviewCount,
      product.stockStatus,
      unitType,
      totalQuantity,
      baseUnit,
      unitPrice,
      unitPriceLabel,
    ],
  );
}
