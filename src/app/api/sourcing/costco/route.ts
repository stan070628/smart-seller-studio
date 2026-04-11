/**
 * GET  /api/sourcing/costco  — DB에서 코스트코 상품 목록 조회
 * POST /api/sourcing/costco  — OCC API 수집 후 DB upsert + 스코어 재계산
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchAllCostcoProducts } from '@/lib/sourcing/costco-client';
import { recalculateSourcingScores } from '@/lib/sourcing/costco-scorer';
import { parseProductUnit } from '@/lib/sourcing/unit-parser';
import type { CostcoApiProduct } from '@/types/costco';
import type { Pool } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// GET — 상품 목록 조회
// ─────────────────────────────────────────────────────────────────────────────

const getQuerySchema = z.object({
  category: z.string().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(200).optional().default(50),
  search: z.string().optional(),
  sort: z
    .enum([
      'sourcing_score_desc',
      'unit_saving_rate_desc',
      'margin_rate_desc',
      'price_asc',
      'price_desc',
      'review_count_desc',
      'collected_desc',
    ])
    .optional()
    .default('unit_saving_rate_desc'),
  stockStatus: z.enum(['all', 'inStock', 'outOfStock', 'lowStock']).optional().default('all'),
  /** 단가 절감율 필터: high=30%+, mid=15%+, any=단가비교 가능한 것만 */
  savingFilter: z.enum(['all', 'high', 'mid', 'any']).optional().default('all'),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = getQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { category, page, pageSize, search, sort, stockStatus, savingFilter } = parsed.data;
  const offset = (page - 1) * pageSize;

  const pool = getSourcingPool();

  const conditions: string[] = ['is_active = true'];
  const values: unknown[] = [];
  let idx = 1;

  if (category) {
    conditions.push(`category_name = $${idx++}`);
    values.push(category);
  }
  if (search) {
    conditions.push(`title ILIKE $${idx++}`);
    values.push(`%${search}%`);
  }
  if (stockStatus !== 'all') {
    conditions.push(`stock_status = $${idx++}`);
    values.push(stockStatus);
  }
  // 단가 절감율 필터
  // 새 컬럼(market_unit_price / unit_price) 또는 기존 unit_saving_rate 중 하나라도 조건 충족 시 포함
  if (savingFilter === 'high') {
    conditions.push(`(
      unit_saving_rate >= 30
      OR (unit_price IS NOT NULL AND market_unit_price IS NOT NULL AND market_unit_price / NULLIF(unit_price, 0) >= 1.30)
    )`);
  } else if (savingFilter === 'mid') {
    conditions.push(`(
      unit_saving_rate >= 15
      OR (unit_price IS NOT NULL AND market_unit_price IS NOT NULL AND market_unit_price / NULLIF(unit_price, 0) >= 1.15)
    )`);
  } else if (savingFilter === 'any') {
    conditions.push(`(
      unit_saving_rate IS NOT NULL
      OR (market_unit_price IS NOT NULL AND unit_price IS NOT NULL)
    )`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // margin_rate_desc: 시장가 기반 마진율 계산 후 정렬
  // (MARKETPLACE_FEE_RATE=0.12, LOGISTICS_FEE=3000, TAX_RATE=0.1 — costco-constants와 동일)
  const marginExpr = `
    CASE WHEN market_lowest_price IS NOT NULL AND market_lowest_price > 0
      THEN ((market_lowest_price * (1 - 0.12) - price - 3000) / 1.1) / market_lowest_price * 100
      ELSE NULL
    END
  `;

  // 새 컬럼(market_unit_price / unit_price - 1) 또는 기존 unit_saving_rate 중 유효한 값으로 정렬
  const unitSavingExpr = `
    COALESCE(
      CASE WHEN unit_price IS NOT NULL AND unit_price > 0 AND market_unit_price IS NOT NULL
        THEN (market_unit_price / unit_price - 1) * 100
        ELSE NULL
      END,
      unit_saving_rate
    )
  `;

  const orderBy: Record<string, string> = {
    sourcing_score_desc:    'sourcing_score DESC, collected_at DESC',
    unit_saving_rate_desc:  `(${unitSavingExpr}) DESC NULLS LAST, sourcing_score DESC`,
    margin_rate_desc:       `(${marginExpr}) DESC NULLS LAST`,
    price_asc:              'price ASC',
    price_desc:             'price DESC',
    review_count_desc:      'review_count DESC',
    collected_desc:         'collected_at DESC',
  };

  try {
    const [rowsRes, countRes, categoriesRes, lastCollectedRes] = await Promise.all([
      pool.query(
        `SELECT
           id, product_code, title, category_name, category_code,
           image_url, product_url, brand,
           price, original_price, first_price, lowest_price, target_sell_price,
           average_rating, review_count, stock_status, shipping_included,
           market_lowest_price, market_price_source, market_price_updated_at,
           sourcing_score, demand_score, price_opp_score, urgency_score,
           seasonal_score, margin_score,
           costco_unit, costco_unit_price, naver_unit_price, unit_saving_rate,
           unit_type, unit_price, unit_price_label, market_unit_price, market_unit_title,
           collected_at
         FROM public.costco_products
         ${where}
         ORDER BY ${orderBy[sort]}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM public.costco_products ${where}`,
        values,
      ),
      pool.query(
        `SELECT DISTINCT category_name
         FROM public.costco_products
         WHERE is_active = true AND category_name IS NOT NULL
         ORDER BY category_name`,
      ),
      pool.query(
        `SELECT MAX(collected_at) AS last_collected FROM public.costco_products`,
      ),
    ]);

    return NextResponse.json({
      products: rowsRes.rows,
      total: countRes.rows[0]?.total ?? 0,
      page,
      pageSize,
      categories: categoriesRes.rows.map((r) => r.category_name),
      lastCollected: lastCollectedRes.rows[0]?.last_collected ?? null,
    });
  } catch (err) {
    console.error('[costco] GET 오류:', err);
    return NextResponse.json({ error: '상품 조회 실패' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — OCC API 수집 + DB upsert + 스코어 재계산
// ─────────────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  categoryNames: z.array(z.string()).optional(),
  maxPages: z.number().min(1).max(20).optional().default(10),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const pool = getSourcingPool();

  const logRes = await pool.query(
    `INSERT INTO public.costco_collection_logs (trigger_type) VALUES ('manual') RETURNING id`,
  );
  const logId: string = logRes.rows[0].id;

  try {
    const result = await fetchAllCostcoProducts({ categoryNames: parsed.data.categoryNames, maxPages: parsed.data.maxPages });

    if (result.products.length > 0) {
      const collectedCodes = result.products.map((p) => p.productCode);

      // 수집된 카테고리의 기존 상품만 비활성화 (다른 카테고리는 유지)
      const collectedCategories = [...new Set(result.products.map((p) => p.categoryName))];
      if (collectedCategories.length > 0) {
        await pool.query(
          `UPDATE public.costco_products SET is_active = false
           WHERE category_name = ANY($1) AND NOT (product_code = ANY($2))`,
          [collectedCategories, collectedCodes],
        );
      }

      for (const product of result.products) {
        await upsertProduct(pool, product);
      }

      // 일별 가격 로그
      await logPrices(pool, result.products);

      // 소싱 스코어 재계산
      await recalculateSourcingScores(pool);
    }

    await pool.query(
      `UPDATE public.costco_collection_logs
       SET finished_at = now(), status = $1, products_scraped = $2, errors = $3
       WHERE id = $4`,
      [
        result.errors.length === 0 ? 'success' : 'partial',
        result.totalFetched,
        result.errors.length ? JSON.stringify(result.errors) : null,
        logId,
      ],
    );

    return NextResponse.json({
      success: true,
      data: { totalFetched: result.totalFetched, errors: result.errors },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[costco] POST 오류:', msg);

    await pool.query(
      `UPDATE public.costco_collection_logs
       SET finished_at = now(), status = 'failed', errors = $1
       WHERE id = $2`,
      [JSON.stringify([{ category: 'global', message: msg }]), logId],
    );

    return NextResponse.json({ error: '수집 실패', detail: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

async function upsertProduct(pool: Pool, product: CostcoApiProduct) {
  // 단위 파싱 결과 계산 (실패 시 null)
  const unitResult = parseProductUnit(product.title);
  const unitType       = unitResult.success ? unitResult.parsed.unitType       : null;
  const totalQuantity  = unitResult.success ? unitResult.parsed.totalQuantity  : null;
  const baseUnit       = unitResult.success ? unitResult.parsed.baseUnit       : null;
  const unitPriceLabel = unitResult.success ? unitResult.parsed.unitPriceLabel : null;
  // 단가 = 가격 / 총량 * divisor (예: 13680ml → 100ml당)
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
       -- first_price: 최초 수집 가격은 덮어쓰지 않음
       first_price      = COALESCE(costco_products.first_price, EXCLUDED.price),
       -- lowest_price: 항상 더 낮은 값으로 갱신
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
      product.productCode,           // $1
      product.title,                 // $2
      product.categoryName,          // $3
      product.categoryCode,          // $4
      product.price,                 // $5
      product.originalPrice ?? null, // $6
      product.imageUrl ?? null,      // $7
      product.productUrl,            // $8
      product.brand ?? null,         // $9
      product.averageRating ?? null, // $10
      product.reviewCount,           // $11
      product.stockStatus,           // $12
      unitType,                      // $13
      totalQuantity,                 // $14
      baseUnit,                      // $15
      unitPrice,                     // $16
      unitPriceLabel,                // $17
    ],
  );
}

async function logPrices(pool: Pool, products: CostcoApiProduct[]) {
  for (const product of products) {
    const idRes = await pool.query(
      `SELECT id FROM public.costco_products WHERE product_code = $1`,
      [product.productCode],
    );
    if (!idRes.rows[0]) continue;

    await pool.query(
      `INSERT INTO public.costco_price_logs (product_id, product_code, price, logged_at)
       VALUES ($1, $2, $3, CURRENT_DATE)
       ON CONFLICT (product_code, logged_at) DO UPDATE SET price = EXCLUDED.price`,
      [idRes.rows[0].id, product.productCode, product.price],
    );
  }
}
