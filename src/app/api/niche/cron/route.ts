/**
 * GET /api/niche/cron
 * 니치 키워드 추천 일괄 분석 — CRON 스케줄러 전용 엔드포인트
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 * 파이프라인:
 *   1. niche_cron_logs INSERT (status='running') → logId
 *   2. SEED_KEYWORDS 순회 → getSuggestions()로 파생 키워드 확장 (최대 200개)
 *   3. 키워드별 searchShopping → aggregateShoppingData → calcNicheScore
 *   4. niche_keywords UPSERT, niche_score_history INSERT (오늘 날짜 스냅샷)
 *   5. 등급이 S/A이고 기존 등급과 다른 경우 niche_alerts INSERT
 *   6. 완료/실패 시 niche_cron_logs UPDATE
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getNaverShoppingClient } from '@/lib/niche/naver-shopping';
import { aggregateShoppingData } from '@/lib/niche/aggregator';
import { calcNicheScore } from '@/lib/niche/scoring';
import {
  SEED_KEYWORDS_LARGE_APPLIANCES,
  SEED_KEYWORDS_FURNITURE,
  SEED_KEYWORDS_INDUSTRIAL,
  SEED_KEYWORDS_SPECIALTY,
  SEED_KEYWORDS_OUTDOOR,
} from '@/lib/niche/seed-keywords';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 분석 가능한 최대 키워드 수 */
const MAX_KEYWORDS = 200;

/** 네이버 API 딜레이 (ms) — 차단 방지 */
const API_DELAY_MS = 200;

/** 카테고리 태그 → 시드 키워드 배열 매핑 */
const SEED_KEYWORDS: Record<string, string[]> = {
  '대형가전/업소용': SEED_KEYWORDS_LARGE_APPLIANCES,
  '가구/대형인테리어': SEED_KEYWORDS_FURNITURE,
  '산업용품/업소설비': SEED_KEYWORDS_INDUSTRIAL,
  '특수/틈새': SEED_KEYWORDS_SPECIALTY,
  '아웃도어/대형레저': SEED_KEYWORDS_OUTDOOR,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[niche-cron] CRON_SECRET 환경변수가 설정되지 않았습니다.');
    return Response.json({ success: false, error: '서버 설정 오류' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token !== cronSecret) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }

  const pool = getSourcingPool();
  const startTime = Date.now();

  // niche_cron_logs 시작 기록
  let logId: string;
  try {
    const logResult = await pool.query<{ id: string }>(
      `INSERT INTO niche_cron_logs (status)
       VALUES ('running')
       RETURNING id`,
    );
    const logRow = logResult.rows[0];
    if (!logRow) throw new Error('로그 INSERT 결과 없음');
    logId = logRow.id;
  } catch (logErr) {
    console.error('[niche-cron] niche_cron_logs 생성 실패:', logErr);
    return Response.json({ success: false, error: '크론 로그 생성 실패' }, { status: 500 });
  }

  try {
    const naverClient = getNaverShoppingClient();

    // ── 1단계: 시드 키워드 → 파생 키워드 확장 (중복 제거) ──────────────────
    const keywordCategoryMap = new Map<string, string>(); // keyword → categoryTag

    for (const [categoryTag, seeds] of Object.entries(SEED_KEYWORDS)) {
      for (const seed of seeds) {
        // 시드 키워드 자체 포함
        if (!keywordCategoryMap.has(seed)) {
          keywordCategoryMap.set(seed, categoryTag);
        }

        // 자동완성으로 파생 키워드 확장
        const suggestions = await naverClient.getSuggestions(seed);
        for (const suggestion of suggestions) {
          if (!keywordCategoryMap.has(suggestion)) {
            keywordCategoryMap.set(suggestion, categoryTag);
          }
        }

        // 최대 키워드 수 도달 시 조기 종료
        if (keywordCategoryMap.size >= MAX_KEYWORDS) break;
      }
      if (keywordCategoryMap.size >= MAX_KEYWORDS) break;
    }

    const allKeywords = [...keywordCategoryMap.entries()].slice(0, MAX_KEYWORDS);
    console.info(`[niche-cron] 분석 대상 키워드: ${allKeywords.length}개`);

    // ── 2단계: 키워드별 순차 분석 ──────────────────────────────────────────
    // KST 기준 오늘 날짜
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'

    let analyzedCount = 0;
    let updatedCount = 0;
    let newSACount = 0;

    for (let i = 0; i < allKeywords.length; i++) {
      const [keyword, categoryTag] = allKeywords[i];

      try {
        // 네이버 쇼핑 검색
        const { total, items } = await naverClient.searchShopping(keyword, 100);

        // 데이터 집계 및 니치점수 계산
        const scoreInput = aggregateShoppingData(keyword, total, items);
        const scoreResult = calcNicheScore(scoreInput);

        // 기존 등급 조회 (알림 발송 여부 판단용)
        const existingRow = await pool.query<{ grade: string }>(
          `SELECT grade FROM niche_keywords WHERE keyword = $1`,
          [keyword],
        );
        const previousGrade = existingRow.rows[0]?.grade ?? null;

        // niche_keywords UPSERT
        await pool.query(
          `INSERT INTO niche_keywords
             (keyword, category_tag, total_score, grade,
              score_rocket_non_entry, score_competition_level, score_seller_diversity,
              score_monopoly_level, score_brand_ratio, score_price_margin, score_domestic_rarity,
              signals, raw_total_products, raw_avg_price, raw_median_price, raw_unique_sellers,
              raw_brand_count, raw_top3_seller_count, raw_sample_size, analyzed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
           ON CONFLICT (keyword) DO UPDATE SET
             category_tag             = EXCLUDED.category_tag,
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
             analyzed_at              = now(),
             updated_at               = now()`,
          [
            keyword,
            categoryTag,
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

        // niche_score_history INSERT (오늘 날짜 스냅샷, 중복 시 무시)
        await pool.query(
          `INSERT INTO niche_score_history
             (keyword, snapshot_date, total_score, grade, raw_total_products, raw_avg_price)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (keyword, snapshot_date) DO NOTHING`,
          [
            keyword,
            today,
            scoreResult.totalScore,
            scoreResult.grade,
            scoreInput.totalProductCount,
            Math.round(scoreInput.avgPrice),
          ],
        );

        // S/A 등급이고 기존 등급이 다른 경우 알림 INSERT
        const isTopGrade = scoreResult.grade === 'S' || scoreResult.grade === 'A';
        const gradeChanged = previousGrade !== scoreResult.grade;

        if (isTopGrade && gradeChanged) {
          await pool.query(
            `INSERT INTO niche_alerts
               (keyword, grade, total_score, is_read)
             VALUES ($1, $2, $3, false)`,
            [keyword, scoreResult.grade, scoreResult.totalScore],
          );
          newSACount++;
        }

        analyzedCount++;
        updatedCount++;

        // 마지막 키워드가 아니면 딜레이 적용
        if (i < allKeywords.length - 1) {
          await sleep(API_DELAY_MS);
        }
      } catch (kwErr) {
        console.error(`[niche-cron] 키워드 분석 실패 (${keyword}):`, kwErr);
        // 개별 키워드 실패는 전체 흐름을 중단하지 않음
      }
    }

    const elapsed = Date.now() - startTime;

    // niche_cron_logs 완료 업데이트
    await pool.query(
      `UPDATE niche_cron_logs
       SET status            = 'success',
           finished_at       = now(),
           keywords_analyzed = $1,
           keywords_updated  = $2,
           new_sa_count      = $3
       WHERE id = $4`,
      [analyzedCount, updatedCount, newSACount, logId],
    );

    return Response.json({
      success: true,
      data: {
        analyzed: analyzedCount,
        updated: updatedCount,
        newSA: newSACount,
        elapsed,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    const elapsed = Date.now() - startTime;
    console.error('[niche-cron] 파이프라인 오류:', message);

    // 실패 상태로 로그 업데이트 — 이 UPDATE 실패도 원래 오류를 반환
    await pool
      .query(
        `UPDATE niche_cron_logs
         SET status      = 'failed',
             finished_at = now(),
             errors      = $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ error: message }), logId],
      )
      .catch((updateErr) => {
        console.error('[niche-cron] 실패 로그 업데이트 오류:', updateErr);
      });

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
