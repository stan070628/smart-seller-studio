/**
 * /api/niche/competitors
 * GET  — 키워드별 경쟁 상품 목록 조회
 * POST — 경쟁 상품 등록
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────────────────────────────────────────
// 스키마
// ─────────────────────────────────────────────────────────────────────────────

const CreateCompetitorSchema = z.object({
  keyword: z.string().trim().min(1).max(100),
  platform: z.enum(['coupang', 'naver', 'gmarket', 'auction', 'etc']).default('coupang'),
  productUrl: z.string().url().nullable().optional(),
  productId: z.string().max(100).nullable().optional(),
  productName: z.string().trim().min(1).max(300),
  sellerName: z.string().max(200).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isRocket: z.boolean().optional().default(false),
  isAd: z.boolean().optional().default(false),
  rankPosition: z.number().int().min(1).max(9999).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET — 키워드별 경쟁 상품 목록
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword');
  if (!keyword) {
    return Response.json(
      { success: false, error: 'keyword 쿼리 파라미터가 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const pool = getSourcingPool();
    const result = await pool.query(
      `SELECT
         id, keyword, platform, product_url, product_id,
         product_name, seller_name, image_url,
         is_rocket, is_ad, rank_position,
         is_tracking, memo, created_at, updated_at
       FROM niche_competitor_products
       WHERE keyword = $1
       ORDER BY created_at ASC`,
      [keyword],
    );

    const items = result.rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      platform: r.platform,
      productUrl: r.product_url,
      productId: r.product_id,
      productName: r.product_name,
      sellerName: r.seller_name,
      imageUrl: r.image_url,
      isRocket: r.is_rocket,
      isAd: r.is_ad,
      rankPosition: r.rank_position,
      isTracking: r.is_tracking,
      memo: r.memo,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return Response.json({ success: true, data: { items, total: items.length } });
  } catch (err) {
    console.error('[GET /api/niche/competitors]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — 경쟁 상품 등록
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

  const parseResult = CreateCompetitorSchema.safeParse(rawBody);
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
      `INSERT INTO niche_competitor_products (
         keyword, platform, product_url, product_id,
         product_name, seller_name, image_url,
         is_rocket, is_ad, rank_position, memo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        d.keyword,
        d.platform,
        d.productUrl ?? null,
        d.productId ?? null,
        d.productName,
        d.sellerName ?? null,
        d.imageUrl ?? null,
        d.isRocket,
        d.isAd,
        d.rankPosition ?? null,
        d.memo ?? null,
      ],
    );

    return Response.json({
      success: true,
      data: { id: result.rows[0].id },
    });
  } catch (err) {
    console.error('[POST /api/niche/competitors]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';

    // 중복 등록 감지
    if (message.includes('uidx_niche_competitor_kw_plat_pid')) {
      return Response.json(
        { success: false, error: '이미 등록된 경쟁 상품입니다.' },
        { status: 409 },
      );
    }

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
