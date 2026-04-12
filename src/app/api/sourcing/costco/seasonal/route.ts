/**
 * POST /api/sourcing/costco/seasonal
 * Vercel Cron: 매월 1일 KST 07:00 (UTC 22:00) 계절성 지수 갱신
 *
 * vercel.json:
 *   { "path": "/api/sourcing/costco/seasonal", "schedule": "0 22 1 * *" }
 *
 * 네이버 DataLab API → costco_seasonal_cache upsert → seasonal_score 재계산
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { COSTCO_CATEGORIES } from '@/lib/sourcing/costco-constants';
import { SCORE_WEIGHTS } from '@/lib/sourcing/costco-constants';

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? '';
const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';

interface DataLabResponse {
  startDate: string;
  endDate: string;
  timeUnit: string;
  results: Array<{
    title: string;
    keywords: string[];
    data: Array<{ period: string; ratio: number }>;
  }>;
}

export async function POST(req: NextRequest) {
  // Cron 인증
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 미설정' },
      { status: 503 },
    );
  }

  const pool = getSourcingPool();

  // 기준 월 (이번 달 1일)
  const now = new Date();
  const referenceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // DataLab 조회 기간: 직전 3개월
  const endDate = referenceMonth.slice(0, 7) + '-01';
  const start = new Date(now);
  start.setMonth(start.getMonth() - 3);
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

  const errors: string[] = [];
  let updatedCount = 0;

  for (const category of COSTCO_CATEGORIES) {
    try {
      const body = {
        startDate,
        endDate,
        timeUnit: 'month',
        keywordGroups: [
          {
            groupName: category.name,
            keywords: category.keywords,
          },
        ],
      };

      const res = await fetch(DATALAB_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Naver-Client-Id': NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new Error(`DataLab API ${res.status}`);
      }

      const data = (await res.json()) as DataLabResponse;
      const result = data.results?.[0];
      if (!result?.data?.length) continue;

      // 최근 달 ratio 추출
      const latestData = result.data[result.data.length - 1];
      const ratio = latestData?.ratio ?? 0;

      // 0~100 ratio를 0~1 seasonal_index로 정규화
      const seasonalIndex = Math.min(1.0, ratio / 100);

      await pool.query(
        `INSERT INTO public.costco_seasonal_cache
           (keyword_group, reference_month, ratio, seasonal_index, fetched_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (keyword_group, reference_month) DO UPDATE SET
           ratio          = EXCLUDED.ratio,
           seasonal_index = EXCLUDED.seasonal_index,
           fetched_at     = now()`,
        [category.name, referenceMonth, ratio, seasonalIndex],
      );

      updatedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${category.name}: ${msg}`);
    }

    // rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // seasonal_score 재계산
  await pool.query(`
    UPDATE public.costco_products cp
    SET
      seasonal_score = ROUND(
        COALESCE(
          (
            SELECT LEAST(1.0, GREATEST(0.0, sc.seasonal_index::numeric)) * 100
            FROM public.costco_seasonal_cache sc
            WHERE sc.keyword_group = cp.category_name
              AND sc.reference_month = DATE_TRUNC('month', CURRENT_DATE)::date
          ),
          0.5
        ) * 100
      ),
      updated_at = now()
    WHERE is_active = true
  `);

  // 종합 스코어 재계산
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

  return NextResponse.json({
    success: true,
    referenceMonth,
    updatedCategories: updatedCount,
    errors,
  });
}
