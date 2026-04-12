/**
 * GET /api/dashboard/summary
 * 3채널(도매꾹·코스트코·니치) 통합 대시보드 요약 데이터
 *
 * 응답: {
 *   success: true,
 *   data: {
 *     overview: { totalProducts, totalRevenue7d, totalOrders7d, avgMargin, legalIssues },
 *     channels: {
 *       domeggook: { products, avgMargin, topSellers[], legalBlocked, legalWarning, lastCollected },
 *       costco:    { products, avgMargin, avgScore, gradeDistribution, lastCollected },
 *       niche:     { trackedKeywords, avgScore, topKeywords[] },
 *     },
 *     orders: { totalOrders, totalRevenue, newOrders, recentOrders[] },
 *   }
 * }
 */

import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { CHANNEL_FEE, VAT_RATE } from '@/lib/sourcing/shared/channel-policy';

export const dynamic = 'force-dynamic';

// 코스트코 마진 역산 상수 (channel-policy 기반)
// 순이익 = 시장가 × (1 - 네이버수수료 - VAT) - 매입가 - 배송비
const NAVER_NET_RATE = 1 - CHANNEL_FEE.naver - VAT_RATE; // ≈ 0.849
const COSTCO_SHIPPING = 3500; // 기본 배송비 (getShippingCost 기준 최소값)
// 이상치 클램프: 0% ~ 80% 범위 밖은 NULL 처리
const MARGIN_MIN = 0;
const MARGIN_MAX = 80;

export async function GET() {
  const pool = getSourcingPool();

  // ── 채널별 독립 병렬 실행 (하나 실패해도 나머지 정상 반환) ─────────────
  const [
    domeggookRes,
    domeggookTopRes,
    domeggookMarginRes,
    costcoRes,
    costcoGradeRes,
    costcoMarginRes,
    nicheRes,
    nicheTopRes,
  ] = await Promise.allSettled([
    // 도매꾹: 총 상품수 + 법적이슈
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE legal_status = 'blocked')::int AS legal_blocked,
        COUNT(*) FILTER (WHERE legal_status = 'warning')::int AS legal_warning,
        MAX(latest_date) AS last_collected
      FROM public.sales_analysis_view
    `),
    // 도매꾹: Top 5 판매
    pool.query(`
      SELECT title, sales_7d, margin_rate,
             score_total, latest_price_dome
      FROM public.sales_analysis_view
      ORDER BY sales_7d DESC NULLS LAST
      LIMIT 5
    `),
    // 도매꾹: 평균 마진율
    pool.query(`
      SELECT ROUND(AVG(margin_rate)::numeric, 1) AS avg_margin
      FROM public.sales_analysis_view
      WHERE margin_rate IS NOT NULL AND margin_rate > 0
    `),
    // 코스트코: 총 상품수 + 평균 스코어
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        ROUND(AVG(COALESCE(costco_score_total, sourcing_score))::numeric, 1) AS avg_score,
        MAX(collected_at) AS last_collected
      FROM public.costco_products
      WHERE is_active = true
    `),
    // 코스트코: 등급 분포
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(costco_score_total, sourcing_score) >= 80)::int AS grade_s,
        COUNT(*) FILTER (WHERE COALESCE(costco_score_total, sourcing_score) >= 65
                          AND COALESCE(costco_score_total, sourcing_score) < 80)::int AS grade_a,
        COUNT(*) FILTER (WHERE COALESCE(costco_score_total, sourcing_score) >= 50
                          AND COALESCE(costco_score_total, sourcing_score) < 65)::int AS grade_b,
        COUNT(*) FILTER (WHERE COALESCE(costco_score_total, sourcing_score) < 50)::int AS grade_cd
      FROM public.costco_products
      WHERE is_active = true
    `),
    // 코스트코: 평균 마진율 (시장가 대비, channel-policy 상수 사용 + 이상치 클램프)
    pool.query(
      `SELECT ROUND(AVG(margin_pct)::numeric, 1) AS avg_margin
       FROM (
         SELECT GREATEST($1, LEAST($2,
           ((market_lowest_price * $3 - price - $4) / market_lowest_price * 100)
         )) AS margin_pct
         FROM public.costco_products
         WHERE is_active = true
           AND market_lowest_price IS NOT NULL
           AND market_lowest_price > price  -- 시장가가 매입가보다 낮은 이상치 제거
       ) sub`,
      [MARGIN_MIN, MARGIN_MAX, NAVER_NET_RATE, COSTCO_SHIPPING],
    ),
    // 니치: 추적 키워드 수 + 평균 스코어
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        ROUND(AVG(total_score)::numeric, 1) AS avg_score
      FROM public.niche_keywords
    `),
    // 니치: Top 5 키워드
    pool.query(`
      SELECT keyword, total_score, grade, analyzed_at
      FROM public.niche_keywords
      ORDER BY total_score DESC NULLS LAST
      LIMIT 5
    `),
  ]);

  // ── 결과 안전하게 추출 (실패한 쿼리는 기본값으로 대체) ────────────────
  const dome      = domeggookRes.status === 'fulfilled'     ? domeggookRes.value.rows[0]     : null;
  const domeTop   = domeggookTopRes.status === 'fulfilled'  ? domeggookTopRes.value.rows      : [];
  const domeMargin= domeggookMarginRes.status === 'fulfilled' ? domeggookMarginRes.value.rows[0] : null;
  const costco    = costcoRes.status === 'fulfilled'        ? costcoRes.value.rows[0]         : null;
  const costcoGrade = costcoGradeRes.status === 'fulfilled' ? costcoGradeRes.value.rows[0]   : null;
  const costcoMargin= costcoMarginRes.status === 'fulfilled' ? costcoMarginRes.value.rows[0] : null;
  const niche     = nicheRes.status === 'fulfilled'         ? nicheRes.value.rows[0]          : null;
  const nicheTop  = nicheTopRes.status === 'fulfilled'      ? nicheTopRes.value.rows          : [];

  return NextResponse.json({
    success: true,
    data: {
      overview: {
        totalProducts: (dome?.total ?? 0) + (costco?.total ?? 0),
        avgMarginDomeggook: parseFloat(domeMargin?.avg_margin) || null,
        avgMarginCostco: parseFloat(costcoMargin?.avg_margin) || null,
        legalBlocked: dome?.legal_blocked ?? 0,
        legalWarning: dome?.legal_warning ?? 0,
      },
      channels: {
        domeggook: {
          products: dome?.total ?? 0,
          avgMargin: parseFloat(domeMargin?.avg_margin) || null,
          topSellers: (domeTop as Record<string, unknown>[]).map((r) => ({
            title: r.title,
            sales7d: r.sales_7d,
            marginRate: r.margin_rate != null ? parseFloat(r.margin_rate as string) : null,
            scoreTotal: r.score_total != null ? parseFloat(r.score_total as string) : null,
            priceDome: r.latest_price_dome,
          })),
          legalBlocked: dome?.legal_blocked ?? 0,
          legalWarning: dome?.legal_warning ?? 0,
          lastCollected: dome?.last_collected ?? null,
        },
        costco: {
          products: costco?.total ?? 0,
          avgScore: parseFloat(costco?.avg_score) || null,
          avgMargin: parseFloat(costcoMargin?.avg_margin) || null,
          gradeDistribution: {
            S: costcoGrade?.grade_s ?? 0,
            A: costcoGrade?.grade_a ?? 0,
            B: costcoGrade?.grade_b ?? 0,
            CD: costcoGrade?.grade_cd ?? 0,
          },
          lastCollected: costco?.last_collected ?? null,
        },
        niche: {
          trackedKeywords: niche?.total ?? 0,
          avgScore: parseFloat(niche?.avg_score) || null,
          topKeywords: (nicheTop as Record<string, unknown>[]).map((r) => ({
            keyword: r.keyword,
            totalScore: r.total_score != null ? parseFloat(r.total_score as string) : null,
            grade: r.grade,
            analyzedAt: r.analyzed_at,
          })),
        },
      },
    },
  });
}
