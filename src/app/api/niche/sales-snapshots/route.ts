/**
 * /api/niche/sales-snapshots
 * GET  — 경쟁 상품별 스냅샷 이력 조회
 * POST — 일별 판매 데이터 입력 (upsert — 같은 날 재입력 시 덮어쓰기)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────────────────────────────────────────
// 스키마
// ─────────────────────────────────────────────────────────────────────────────

const CreateSnapshotSchema = z.object({
  competitorId: z.string().uuid(),
  keyword: z.string().trim().min(1).max(100),
  platform: z.string().min(1),
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식: YYYY-MM-DD').optional(),
  price: z.number().int().min(0).nullable().optional(),
  originalPrice: z.number().int().min(0).nullable().optional(),
  reviewCount: z.number().int().min(0).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  salesCount: z.number().int().min(0).nullable().optional(),
  reviewDelta: z.number().int().nullable().optional(),
  salesRank: z.number().int().min(1).nullable().optional(),
  rankPosition: z.number().int().min(1).nullable().optional(),
  inputMethod: z.enum(['manual', 'bookmarklet', 'extension', 'api']).optional().default('manual'),
  memo: z.string().max(500).nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET — 스냅샷 이력 조회
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const competitorId = sp.get('competitorId');
  const keyword = sp.get('keyword');
  const days = parseInt(sp.get('days') ?? '30', 10);

  if (!competitorId && !keyword) {
    return Response.json(
      { success: false, error: 'competitorId 또는 keyword 쿼리 파라미터가 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const pool = getSourcingPool();

    let query: string;
    let params: unknown[];

    if (competitorId) {
      // 특정 상품의 스냅샷 이력
      query = `
        SELECT id, competitor_id, keyword, platform, snapshot_date,
               price, original_price, review_count, rating, sales_count,
               review_delta, sales_rank, rank_position, input_method, memo, created_at
        FROM niche_sales_snapshots
        WHERE competitor_id = $1
          AND snapshot_date >= CURRENT_DATE - $2::integer
        ORDER BY snapshot_date DESC`;
      params = [competitorId, days];
    } else {
      // 키워드 전체 상품의 스냅샷 이력
      query = `
        SELECT id, competitor_id, keyword, platform, snapshot_date,
               price, original_price, review_count, rating, sales_count,
               review_delta, sales_rank, rank_position, input_method, memo, created_at
        FROM niche_sales_snapshots
        WHERE keyword = $1
          AND snapshot_date >= CURRENT_DATE - $2::integer
        ORDER BY snapshot_date DESC, competitor_id`;
      params = [keyword, days];
    }

    const result = await pool.query(query, params);

    const items = result.rows.map((r) => ({
      id: r.id,
      competitorId: r.competitor_id,
      keyword: r.keyword,
      platform: r.platform,
      snapshotDate: r.snapshot_date,
      price: r.price,
      originalPrice: r.original_price,
      reviewCount: r.review_count,
      rating: r.rating ? parseFloat(r.rating) : null,
      salesCount: r.sales_count,
      reviewDelta: r.review_delta,
      salesRank: r.sales_rank,
      rankPosition: r.rank_position,
      inputMethod: r.input_method,
      memo: r.memo,
      createdAt: r.created_at,
    }));

    return Response.json({ success: true, data: { items, total: items.length } });
  } catch (err) {
    console.error('[GET /api/niche/sales-snapshots]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — 일별 판매 데이터 입력 (upsert)
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = CreateSnapshotSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      {
        success: false,
        error: '입력값 검증 실패',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const d = parseResult.data;

  try {
    const pool = getSourcingPool();
    const result = await pool.query<{ id: string }>(
      `INSERT INTO niche_sales_snapshots (
         competitor_id, keyword, platform, snapshot_date,
         price, original_price, review_count, rating, sales_count,
         review_delta, sales_rank, rank_position, input_method, memo
       ) VALUES ($1,$2,$3, COALESCE($4::date, CURRENT_DATE),
                 $5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (competitor_id, snapshot_date) DO UPDATE SET
         price          = COALESCE(EXCLUDED.price, niche_sales_snapshots.price),
         original_price = COALESCE(EXCLUDED.original_price, niche_sales_snapshots.original_price),
         review_count   = COALESCE(EXCLUDED.review_count, niche_sales_snapshots.review_count),
         rating         = COALESCE(EXCLUDED.rating, niche_sales_snapshots.rating),
         sales_count    = COALESCE(EXCLUDED.sales_count, niche_sales_snapshots.sales_count),
         review_delta   = COALESCE(EXCLUDED.review_delta, niche_sales_snapshots.review_delta),
         sales_rank     = COALESCE(EXCLUDED.sales_rank, niche_sales_snapshots.sales_rank),
         rank_position  = COALESCE(EXCLUDED.rank_position, niche_sales_snapshots.rank_position),
         input_method   = EXCLUDED.input_method,
         memo           = COALESCE(EXCLUDED.memo, niche_sales_snapshots.memo)
       RETURNING id`,
      [
        d.competitorId,
        d.keyword,
        d.platform,
        d.snapshotDate ?? null,
        d.price ?? null,
        d.originalPrice ?? null,
        d.reviewCount ?? null,
        d.rating ?? null,
        d.salesCount ?? null,
        d.reviewDelta ?? null,
        d.salesRank ?? null,
        d.rankPosition ?? null,
        d.inputMethod,
        d.memo ?? null,
      ],
    );

    return Response.json({
      success: true,
      data: { id: result.rows[0].id },
    });
  } catch (err) {
    console.error('[POST /api/niche/sales-snapshots]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
