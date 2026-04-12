/**
 * POST /api/sourcing/naver-prices
 * 도매꾹 상품들의 시장 최저가를 네이버 쇼핑 API로 일괄 수집
 *
 * Vercel Cron (vercel.json):
 *   { "path": "/api/sourcing/naver-prices", "schedule": "0 23 * * *" }
 *   → KST 08:00 매일 실행 (UTC 23:00)
 *
 * 인증:
 *   - Authorization: Bearer {CRON_SECRET} 헤더 확인
 *   - CRON_SECRET 미설정 시 인증 생략 (개발 편의)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { searchNaverLowestPrice } from '@/lib/sourcing/naver-shopping';

export const maxDuration = 300;

const NAVER_CALL_DELAY_MS = 200;
const MARKET_PRICE_REFRESH_DAYS = 7;
const DEADLINE_SAFETY_MARGIN_MS = 30_000;

const bodySchema = z.object({
  limit: z.number().int().positive().max(100).default(50),
});

interface ItemRow {
  id: string;
  item_no: number;
  title: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { limit } = parsed.data;

  const pool = getSourcingPool();

  let items: ItemRow[];
  try {
    const res = await pool.query<ItemRow>(
      `SELECT id, item_no, title
       FROM public.sourcing_items
       WHERE status IS DISTINCT FROM '판매중지'
         AND (
           market_price_source IS DISTINCT FROM 'naver_api'
           OR market_price_updated_at IS NULL
           OR market_price_updated_at < NOW() - INTERVAL '${MARKET_PRICE_REFRESH_DAYS} days'
         )
       ORDER BY market_price_updated_at ASC NULLS FIRST
       LIMIT $1`,
      [limit],
    );
    items = res.rows;
  } catch (err) {
    console.error('[sourcing/naver-prices] 상품 조회 실패:', err);
    return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
  }

  if (items.length === 0) {
    return NextResponse.json({ success: true, updated: 0, failed: 0, skipped: 0 });
  }

  const startedAt = Date.now();
  const hardDeadlineMs = maxDuration * 1_000 - DEADLINE_SAFETY_MARGIN_MS;

  let updated = 0, failed = 0, skipped = 0;

  for (const item of items) {
    if (Date.now() - startedAt >= hardDeadlineMs) {
      console.warn(
        `[sourcing/naver-prices] deadline 도달, 조기 종료 (처리=${updated + failed + skipped}/${items.length})`,
      );
      break;
    }

    try {
      const lowestPrice = await searchNaverLowestPrice(item.title);

      if (lowestPrice === null) {
        skipped++;
        await delay(NAVER_CALL_DELAY_MS);
        continue;
      }

      await pool.query(
        `UPDATE public.sourcing_items
         SET market_lowest_price     = $1,
             market_price_source     = 'naver_api',
             market_price_updated_at = now(),
             updated_at              = now()
         WHERE id = $2`,
        [lowestPrice, item.id],
      );

      updated++;
    } catch (err) {
      console.error(`[sourcing/naver-prices] 상품 처리 실패 (item_no=${item.item_no}):`, err);
      failed++;
    }

    await delay(NAVER_CALL_DELAY_MS);
  }

  console.log(
    `[sourcing/naver-prices] 완료: 대상=${items.length}, 업데이트=${updated}, 실패=${failed}, 스킵=${skipped}`,
  );

  return NextResponse.json({ success: true, updated, failed, skipped });
}
