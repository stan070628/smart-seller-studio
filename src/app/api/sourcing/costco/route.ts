/**
 * GET  /api/sourcing/costco  — DB에서 코스트코 상품 목록 조회
 * POST /api/sourcing/costco  — 스크래핑 실행 후 DB upsert
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { scrapeCostcoProducts, type CostcoProduct } from '@/lib/sourcing/costco-scraper';

// ─────────────────────────────────────────────────────────────────────────────
// GET — 상품 목록 조회
// ─────────────────────────────────────────────────────────────────────────────

const getQuerySchema = z.object({
  category: z.string().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(200).optional().default(50),
  search: z.string().optional(),
  sort: z.enum(['price_asc', 'price_desc', 'title_asc', 'collected_desc']).optional().default('collected_desc'),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = getQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { category, page, pageSize, search, sort } = parsed.data;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = {
    price_asc:      'price ASC',
    price_desc:     'price DESC',
    title_asc:      'title ASC',
    collected_desc: 'collected_at DESC',
  }[sort];

  try {
    const [rowsRes, countRes, categoriesRes, lastCollectedRes] = await Promise.all([
      pool.query(
        `SELECT id, product_code, title, category_name, price, original_price,
                image_url, product_url, collected_at
         FROM public.costco_products
         ${where}
         ORDER BY ${orderBy}
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
// POST — 스크래핑 실행 + DB upsert
// ─────────────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  categories: z.array(z.string()).optional(),
  maxPages: z.number().min(1).max(10).optional().default(3),
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
    const result = await scrapeCostcoProducts(parsed.data);

    if (result.products.length > 0) {
      await pool.query(`UPDATE public.costco_products SET is_active = false`);

      for (const product of result.products) {
        await upsertProduct(pool, product);
      }

      await logPrices(pool, result.products);
    }

    await pool.query(
      `UPDATE public.costco_collection_logs
       SET finished_at = now(), status = $1, products_scraped = $2, errors = $3
       WHERE id = $4`,
      [
        result.errors.length === 0 ? 'success' : 'partial',
        result.totalScraped,
        result.errors.length ? JSON.stringify(result.errors) : null,
        logId,
      ],
    );

    return NextResponse.json({
      success: true,
      data: { totalScraped: result.totalScraped, errors: result.errors },
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

    return NextResponse.json({ error: '스크래핑 실패', detail: msg }, { status: 500 });
  }
}

async function upsertProduct(pool: import('pg').Pool, product: CostcoProduct) {
  await pool.query(
    `INSERT INTO public.costco_products
       (product_code, title, category_name, price, original_price, image_url, product_url, is_active, collected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
     ON CONFLICT (product_code) DO UPDATE SET
       title          = EXCLUDED.title,
       category_name  = EXCLUDED.category_name,
       price          = EXCLUDED.price,
       original_price = EXCLUDED.original_price,
       image_url      = EXCLUDED.image_url,
       product_url    = EXCLUDED.product_url,
       is_active      = true,
       collected_at   = now(),
       updated_at     = now()`,
    [
      product.productCode,
      product.title,
      product.categoryName,
      product.price,
      product.originalPrice ?? null,
      product.imageUrl ?? null,
      product.productUrl,
    ],
  );
}

async function logPrices(pool: import('pg').Pool, products: CostcoProduct[]) {
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
