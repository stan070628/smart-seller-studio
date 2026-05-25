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
import { upsertCostcoProduct } from '@/lib/sourcing/costco-upsert';
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
        await upsertCostcoProduct(pool, product);
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
