/**
 * costco-scorer.ts
 * 코스트코 상품 소싱 스코어 재계산
 *
 * 단일 UPDATE SQL로 모든 서브 스코어와 종합 스코어를 한 번에 계산합니다.
 *
 * 스코어 구성 (합계 100):
 *   demand_score    (25): 리뷰 수 + 별점
 *   price_opp_score (30): 시장가 대비 마진율
 *   urgency_score   (15): 재고 상태
 *   seasonal_score  (15): Naver DataLab 계절성 지수
 *   margin_score    (15): 순이익률
 */

import type { Pool } from 'pg';
import { SCORE_WEIGHTS } from './costco-constants';

/**
 * 전체 상품의 소싱 스코어를 재계산합니다.
 * @returns 업데이트된 상품 수
 */
export async function recalculateSourcingScores(pool: Pool): Promise<number> {
  const result = await pool.query(`
    WITH seasonal AS (
      -- 현재 월의 계절성 지수를 카테고리별로 조회
      SELECT
        keyword_group,
        AVG(COALESCE(seasonal_index, 0.5))::numeric(4,2) AS avg_index
      FROM public.costco_seasonal_cache
      WHERE reference_month = DATE_TRUNC('month', CURRENT_DATE)::date
      GROUP BY keyword_group
    )
    UPDATE public.costco_products cp
    SET
      -- ── 수요 점수 (25점) ──────────────────────────────────────────────
      -- 리뷰 수: 0~200개 범위를 0~70으로 정규화
      -- 별점: 0~5점을 0~30으로 정규화
      demand_score = LEAST(100, (
        LEAST(review_count, 200) * 70 / 200 +
        ROUND(COALESCE(average_rating, 0) * 6)
      )),

      -- ── 가격 기회 점수 (30점) ──────────────────────────────────────────
      -- 우선순위 1: 단가 비교 가능한 경우 → (market_unit_price / unit_price - 1) × 100
      --   시장 단가가 코스트코 단가보다 얼마나 비싼지를 점수화
      --   예: 시장 100g당 820원, 코스트코 450원 → (820/450-1)×100 ≈ 82점
      -- 우선순위 2: 단가 정보 없는 경우 → 총액 기준 fallback
      --   (market_lowest_price / target_sell_price - 1) × 100
      price_opp_score = CASE
        WHEN market_unit_price IS NOT NULL AND market_unit_price > 0
             AND unit_price IS NOT NULL AND unit_price > 0
          THEN
            CASE
              WHEN market_unit_price <= unit_price THEN 0
              ELSE LEAST(100, ROUND(
                (market_unit_price::numeric / unit_price - 1) * 100
              ))
            END
        WHEN market_lowest_price IS NULL OR market_lowest_price <= 0 THEN 0
        WHEN market_lowest_price <= target_sell_price THEN 0
        ELSE LEAST(100, ROUND(
          (market_lowest_price::numeric / target_sell_price - 1) * 100
        ))
      END,

      -- ── 긴급성 점수 (15점) ────────────────────────────────────────────
      -- lowStock: 100 (희소성), inStock: 50 (일반), outOfStock: 0 (수집 불가)
      urgency_score = CASE stock_status
        WHEN 'lowStock'   THEN 100
        WHEN 'inStock'    THEN 50
        WHEN 'outOfStock' THEN 0
        ELSE 50
      END,

      -- ── 계절성 점수 (15점) ────────────────────────────────────────────
      -- seasonal_cache에서 카테고리별 지수를 가져와 0~100으로 변환
      -- 미수집 시 50 (중립)
      seasonal_score = ROUND(
        COALESCE(
          (
            SELECT LEAST(1.0, GREATEST(0.0, s.avg_index)) * 100
            FROM seasonal s
            WHERE s.keyword_group = cp.category_name
          ),
          50
        )
      ),

      -- ── 마진 점수 (15점) ──────────────────────────────────────────────
      -- 순이익률 = (0.90 × market_price - purchase_price - 3500) / 1.10 / market_price
      -- >= 30%: 100 | >= 20%: 80 | >= 10%: 60 | >= 5%: 40 | > 0%: 20 | <= 0%: 0
      margin_score = CASE
        WHEN market_lowest_price IS NULL OR market_lowest_price <= 0 THEN 0
        ELSE
          CASE
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.30 THEN 100
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.20 THEN 80
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.10 THEN 60
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.05 THEN 40
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price > 0     THEN 20
            ELSE 0
          END
      END,

      updated_at = now()

    WHERE is_active = true
    RETURNING id
  `);

  // 종합 스코어를 서브 스코어 가중합으로 계산
  await pool.query(`
    UPDATE public.costco_products
    SET sourcing_score = ROUND(
      demand_score    * ${SCORE_WEIGHTS.demand}    / 100.0 +
      price_opp_score * ${SCORE_WEIGHTS.price_opp} / 100.0 +
      urgency_score   * ${SCORE_WEIGHTS.urgency}   / 100.0 +
      seasonal_score  * ${SCORE_WEIGHTS.seasonal}  / 100.0 +
      margin_score    * ${SCORE_WEIGHTS.margin}     / 100.0
    )
    WHERE is_active = true
  `);

  return result.rowCount ?? 0;
}

/**
 * 특정 상품 1개의 소싱 스코어만 재계산
 */
export async function recalculateProductScore(
  pool: Pool,
  productCode: string,
): Promise<void> {
  // 전체 재계산 함수를 단일 상품 필터로 실행하기 위해
  // 임시로 market_lowest_price만 업데이트된 상품 코드를 기준으로 재계산
  await pool.query(`
    WITH seasonal AS (
      SELECT keyword_group, AVG(COALESCE(seasonal_index, 0.5))::numeric(4,2) AS avg_index
      FROM public.costco_seasonal_cache
      WHERE reference_month = DATE_TRUNC('month', CURRENT_DATE)::date
      GROUP BY keyword_group
    )
    UPDATE public.costco_products cp
    SET
      demand_score = LEAST(100, (
        LEAST(review_count, 200) * 70 / 200 +
        ROUND(COALESCE(average_rating, 0) * 6)
      )),
      price_opp_score = CASE
        WHEN market_unit_price IS NOT NULL AND market_unit_price > 0
             AND unit_price IS NOT NULL AND unit_price > 0
          THEN
            CASE
              WHEN market_unit_price <= unit_price THEN 0
              ELSE LEAST(100, ROUND(
                (market_unit_price::numeric / unit_price - 1) * 100
              ))
            END
        WHEN market_lowest_price IS NULL OR market_lowest_price <= 0 THEN 0
        WHEN market_lowest_price <= target_sell_price THEN 0
        ELSE LEAST(100, ROUND(
          (market_lowest_price::numeric / target_sell_price - 1) * 100
        ))
      END,
      urgency_score = CASE stock_status
        WHEN 'lowStock'   THEN 100
        WHEN 'inStock'    THEN 50
        WHEN 'outOfStock' THEN 0
        ELSE 50
      END,
      seasonal_score = ROUND(
        COALESCE(
          (SELECT LEAST(1.0, GREATEST(0.0, s.avg_index)) * 100
           FROM seasonal s WHERE s.keyword_group = cp.category_name),
          50
        )
      ),
      margin_score = CASE
        WHEN market_lowest_price IS NULL OR market_lowest_price <= 0 THEN 0
        ELSE
          CASE
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.30 THEN 100
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.20 THEN 80
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.10 THEN 60
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price >= 0.05 THEN 40
            WHEN (0.90 * market_lowest_price - price - 3500.0) / 1.10
                 / market_lowest_price > 0     THEN 20
            ELSE 0
          END
      END,
      updated_at = now()
    WHERE product_code = $1
  `, [productCode]);

  await pool.query(`
    UPDATE public.costco_products
    SET sourcing_score = ROUND(
      demand_score    * ${SCORE_WEIGHTS.demand}    / 100.0 +
      price_opp_score * ${SCORE_WEIGHTS.price_opp} / 100.0 +
      urgency_score   * ${SCORE_WEIGHTS.urgency}   / 100.0 +
      seasonal_score  * ${SCORE_WEIGHTS.seasonal}  / 100.0 +
      margin_score    * ${SCORE_WEIGHTS.margin}     / 100.0
    )
    WHERE product_code = $1
  `, [productCode]);
}
