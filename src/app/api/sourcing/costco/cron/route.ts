/**
 * POST /api/sourcing/costco/cron
 * Vercel Cron: 매일 KST 06:00 (UTC 21:00) 자동 수집
 *
 * vercel.json:
 *   { "path": "/api/sourcing/costco/cron", "schedule": "0 21 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchAllCostcoProducts } from '@/lib/sourcing/costco-client';
import { recalculateSourcingScores } from '@/lib/sourcing/costco-scorer';
import { PRICE_LOG_RETENTION_DAYS } from '@/lib/sourcing/costco-constants';
import { parseProductUnit } from '@/lib/sourcing/unit-parser';
import type { Pool } from 'pg';
import type { CostcoApiProduct } from '@/types/costco';

export async function POST(req: NextRequest) {
  // Vercel Cron 인증
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  const logRes = await pool.query(
    `INSERT INTO public.costco_collection_logs (trigger_type) VALUES ('cron') RETURNING id`,
  );
  const logId: string = logRes.rows[0].id;

  try {
    // 1. OCC API 수집
    const result = await fetchAllCostcoProducts({ maxPages: 10 });

    if (result.products.length > 0) {
      // 2. 기존 상품 비활성화
      await pool.query(`UPDATE public.costco_products SET is_active = false`);

      // 3. Upsert (COALESCE / LEAST 보존)
      for (const product of result.products) {
        await upsertProduct(pool, product);
      }

      // 4. 일별 가격 로그
      await logPrices(pool, result.products);

      // 5. 소싱 스코어 재계산
      await recalculateSourcingScores(pool);
    }

    // 6. 오래된 가격 로그 정리 (30일 초과)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PRICE_LOG_RETENTION_DAYS);
    await pool.query(
      `DELETE FROM public.costco_price_logs WHERE logged_at < $1`,
      [cutoff.toISOString().split('T')[0]],
    );

    // 7. 수집 로그 완료 업데이트
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

    console.log(
      `[costco/cron] 완료: ${result.totalFetched}개 수집, 오류 ${result.errors.length}건`,
    );

    return NextResponse.json({
      success: true,
      totalFetched: result.totalFetched,
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[costco/cron] 오류:', msg);

    await pool.query(
      `UPDATE public.costco_collection_logs
       SET finished_at = now(), status = 'failed', errors = $1
       WHERE id = $2`,
      [JSON.stringify([{ category: 'global', message: msg }]), logId],
    );

    return NextResponse.json({ error: '자동 수집 실패', detail: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼 (route.ts와 동일 — 추후 공통 모듈로 분리 가능)
// ─────────────────────────────────────────────────────────────────────────────

async function upsertProduct(pool: Pool, product: CostcoApiProduct) {
  // 단위 파싱 결과 계산 (실패 시 null)
  const unitResult = parseProductUnit(product.title);
  const unitType       = unitResult.success ? unitResult.parsed.unitType       : null;
  const totalQuantity  = unitResult.success ? unitResult.parsed.totalQuantity  : null;
  const baseUnit       = unitResult.success ? unitResult.parsed.baseUnit       : null;
  const unitPriceLabel = unitResult.success ? unitResult.parsed.unitPriceLabel : null;
  // 단가 = 가격 / 총량 * divisor (예: 13680ml 기준 → 100ml당)
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
      product.productCode,    // $1
      product.title,          // $2
      product.categoryName,   // $3
      product.categoryCode,   // $4
      product.price,          // $5
      product.originalPrice ?? null, // $6
      product.imageUrl ?? null,      // $7
      product.productUrl,     // $8
      product.brand ?? null,  // $9
      product.averageRating ?? null, // $10
      product.reviewCount,    // $11
      product.stockStatus,    // $12
      unitType,               // $13
      totalQuantity,          // $14
      baseUnit,               // $15
      unitPrice,              // $16
      unitPriceLabel,         // $17
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
