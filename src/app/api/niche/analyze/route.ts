/**
 * POST /api/niche/analyze
 * 단일 키워드 니치점수 분석
 *
 * 처리 흐름:
 *   1. body에서 keyword 추출 후 Zod 검증
 *   2. 네이버 쇼핑 API 검색 (최대 100건)
 *   3. 검색 결과 집계 → NicheScoreInput 변환
 *   4. 니치점수 계산 → NicheScoreResult 산출
 *   5. niche_keywords UPSERT (keyword UNIQUE)
 *   6. niche_analyses INSERT (수동 분석 로그)
 *   7. 결과 반환
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getNaverShoppingClient } from '@/lib/niche/naver-shopping';
import { aggregateShoppingData } from '@/lib/niche/aggregator';
import { calcNicheScore } from '@/lib/niche/scoring';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────────────
// 요청 바디 스키마
// ─────────────────────────────────────────────────

const AnalyzeBodySchema = z.object({
  keyword: z
    .string({ error: 'keyword는 필수입니다.' })
    .trim()
    .min(1, 'keyword는 1자 이상이어야 합니다.')
    .max(100, 'keyword는 100자 이하여야 합니다.'),
});

// ─────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. 요청 바디 파싱 및 검증 ───────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = AnalyzeBodySchema.safeParse(rawBody);
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

  const { keyword } = parseResult.data;

  try {
    // ── 2. 네이버 쇼핑 API 검색 ───────────────────
    const client = getNaverShoppingClient();
    const { total: totalCount, items } = await client.searchShopping(keyword, 100);

    // ── 3. 검색 결과 집계 → NicheScoreInput 변환 ──
    const scoreInput = aggregateShoppingData(keyword, totalCount, items);

    // ── 4. 니치점수 계산 ──────────────────────────
    const scoreResult = calcNicheScore(scoreInput);

    // ── 5. DB 저장 ────────────────────────────────
    const pool = getSourcingPool();

    // niche_keywords UPSERT — keyword UNIQUE 제약 기준
    const upsertResult = await pool.query<{ id: string }>(
      `INSERT INTO niche_keywords (
         keyword,
         total_score,
         grade,
         score_rocket_non_entry,
         score_competition_level,
         score_seller_diversity,
         score_monopoly_level,
         score_brand_ratio,
         score_price_margin,
         score_domestic_rarity,
         signals,
         raw_total_products,
         raw_avg_price,
         raw_median_price,
         raw_unique_sellers,
         raw_brand_count,
         raw_top3_seller_count,
         raw_sample_size,
         analyzed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (keyword) DO UPDATE SET
         total_score              = EXCLUDED.total_score,
         grade                    = EXCLUDED.grade,
         score_rocket_non_entry   = EXCLUDED.score_rocket_non_entry,
         score_competition_level  = EXCLUDED.score_competition_level,
         score_seller_diversity   = EXCLUDED.score_seller_diversity,
         score_monopoly_level     = EXCLUDED.score_monopoly_level,
         score_brand_ratio        = EXCLUDED.score_brand_ratio,
         score_price_margin       = EXCLUDED.score_price_margin,
         score_domestic_rarity    = EXCLUDED.score_domestic_rarity,
         signals                  = EXCLUDED.signals,
         raw_total_products       = EXCLUDED.raw_total_products,
         raw_avg_price            = EXCLUDED.raw_avg_price,
         raw_median_price         = EXCLUDED.raw_median_price,
         raw_unique_sellers       = EXCLUDED.raw_unique_sellers,
         raw_brand_count          = EXCLUDED.raw_brand_count,
         raw_top3_seller_count    = EXCLUDED.raw_top3_seller_count,
         raw_sample_size          = EXCLUDED.raw_sample_size,
         analyzed_at              = EXCLUDED.analyzed_at,
         updated_at               = NOW()
       RETURNING id`,
      [
        keyword,
        scoreResult.totalScore,
        scoreResult.grade,
        scoreResult.breakdown.rocketNonEntry,
        scoreResult.breakdown.competitionLevel,
        scoreResult.breakdown.sellerDiversity,
        scoreResult.breakdown.monopolyLevel,
        scoreResult.breakdown.brandRatio,
        scoreResult.breakdown.priceMarginViability,
        scoreResult.breakdown.domesticRarity,
        JSON.stringify(scoreResult.signals),
        scoreInput.totalProductCount,
        Math.round(scoreInput.avgPrice),
        Math.round(scoreInput.medianPrice),
        scoreInput.uniqueSellerCount,
        scoreInput.brandProductCount,
        scoreInput.top3SellerProductCount,
        scoreInput.sampleSize,
      ],
    );

    const keywordId = upsertResult.rows[0]?.id ?? null;

    // ── 6. niche_analyses INSERT (수동 분석 로그) ──
    {
      await pool.query(
        `INSERT INTO niche_analyses (
           keyword, total_score, grade, breakdown, signals, raw_data
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          keyword,
          scoreResult.totalScore,
          scoreResult.grade,
          JSON.stringify(scoreResult.breakdown),
          JSON.stringify(scoreResult.signals),
          JSON.stringify(scoreInput),
        ],
      );
    }

    // ── 7. 결과 반환 ──────────────────────────────
    return Response.json({
      success: true,
      data: {
        keyword,
        totalScore: scoreResult.totalScore,
        grade:      scoreResult.grade,
        breakdown:  scoreResult.breakdown,
        signals:    scoreResult.signals,
        rawData: {
          totalProductCount: scoreInput.totalProductCount,
          avgPrice:          scoreInput.avgPrice,
          medianPrice:       scoreInput.medianPrice,
          uniqueSellerCount: scoreInput.uniqueSellerCount,
          sampleSize:        scoreInput.sampleSize,
          brandProductCount: scoreInput.brandProductCount,
          top3SellerProductCount: scoreInput.top3SellerProductCount,
          hasLargeSizeKeyword:   scoreInput.hasLargeSizeKeyword,
          hasBulkyCategory:      scoreInput.hasBulkyCategory,
          officialStoreBrandRatio: scoreInput.officialStoreBrandRatio,
        },
      },
    });
  } catch (err) {
    console.error('[POST /api/niche/analyze] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
