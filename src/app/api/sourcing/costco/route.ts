/**
 * GET  /api/sourcing/costco  — DB에서 코스트코 상품 목록 조회
 * POST /api/sourcing/costco  — OCC API 수집 후 DB upsert + 스코어 재계산
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchAllCostcoProducts } from '@/lib/sourcing/costco-client';
import { recalculateSourcingScores } from '@/lib/sourcing/costco-scorer';
import { parseProductUnit } from '@/lib/sourcing/unit-parser';
import type { CostcoApiProduct } from '@/types/costco';
import type { Pool } from 'pg';
import { logDiscoveryBatch, type DiscoveryLogEntry } from '@/lib/sourcing/analytics-logger';
import { getActiveSeasonKeywords } from '@/lib/sourcing/shared/season-bonus';

// ─────────────────────────────────────────────────────────────────────────────
// GET — 상품 목록 조회
// ─────────────────────────────────────────────────────────────────────────────

const getQuerySchema = z.object({
  category: z.string().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(200).optional().default(50),
  search: z.string().optional(),
  sort: z
    .enum([
      'sourcing_score_desc',
      'unit_saving_rate_desc',
      'margin_rate_desc',
      'price_asc',
      'price_desc',
      'review_count_desc',
      'collected_desc',
    ])
    .optional()
    .default('unit_saving_rate_desc'),
  stockStatus: z.enum(['all', 'inStock', 'outOfStock', 'lowStock']).optional().default('all'),
  /** 단가 절감율 필터: high=30%+, mid=15%+, any=단가비교 가능한 것만 */
  savingFilter: z.enum(['all', 'high', 'mid', 'any']).optional().default('all'),
  /** 성별 타겟 필터: male_high=남성타겟만, male_friendly=남성친화 이상, neutral=중립, female=여성타겟 */
  genderFilter: z.enum(['all', 'male_high', 'male_friendly', 'neutral', 'female']).optional().default('all'),
  /** 시즌 상품만: true이면 현재 날짜 기준 활성 키워드 포함 상품만 조회 */
  seasonOnly: z.coerce.boolean().optional().default(false),
  /** 소싱 등급 필터 (grade.ts 기준): S=80+, A=65+, B=50+, C=35+, D=미만 */
  grade: z.enum(['all', 'S', 'A', 'B', 'C', 'D']).optional().default('all'),
  /** 별표 상품만 */
  asteriskOnly: z.coerce.boolean().optional().default(false),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = getQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { category, page, pageSize, search, sort, stockStatus, savingFilter, genderFilter, seasonOnly, grade, asteriskOnly } = parsed.data;
  const offset = (page - 1) * pageSize;

  const pool = getSourcingPool();

  const conditions: string[] = ['is_active = true'];
  const values: unknown[] = [];
  let idx = 1;

  if (category) {
    conditions.push(`category_name = $${idx++}`);
    values.push(category);
  }
  if (search) {
    conditions.push(`title ILIKE $${idx++}`);
    values.push(`%${search}%`);
  }
  if (stockStatus !== 'all') {
    conditions.push(`stock_status = $${idx++}`);
    values.push(stockStatus);
  }
  // 단가 절감율 필터 (market_unit_price / unit_price 기반)
  if (savingFilter === 'high') {
    conditions.push(`(unit_price IS NOT NULL AND market_unit_price IS NOT NULL AND market_unit_price / NULLIF(unit_price, 0) >= 1.30)`);
  } else if (savingFilter === 'mid') {
    conditions.push(`(unit_price IS NOT NULL AND market_unit_price IS NOT NULL AND market_unit_price / NULLIF(unit_price, 0) >= 1.15)`);
  } else if (savingFilter === 'any') {
    conditions.push(`(market_unit_price IS NOT NULL AND unit_price IS NOT NULL)`);
  }

  // 성별 타겟 필터 (카테고리 + 상품명 키워드 기반)
  // high 카테고리: 자동차용품 (score=40 → tier='high')
  // mid 카테고리:  완구·스포츠 (score=20 → tier='mid')
  const MALE_HIGH_CATS = ['자동차용품'];
  const MALE_MID_CATS  = ['완구·스포츠'];
  const MALE_STRONG_KW = ['남성용', '남자', '낚시', '캠핑', '골프', '공구', '면도기', '덤벨', '게이밍', '등산', '아빠'];
  const FEMALE_KW      = ['여성용', '여자', '임산부', '여성'];

  if (genderFilter === 'male_high') {
    // 자동차용품 카테고리 OR 강력 남성 키워드 2개 이상 (score≥40 근사)
    const catPart = `category_name = ANY($${idx++})`;
    values.push(MALE_HIGH_CATS);
    const kwParts = MALE_STRONG_KW.map((kw) => { const p = `title ILIKE $${idx++}`; values.push(`%${kw}%`); return p; });
    conditions.push(`(${catPart} OR ${kwParts.join(' OR ')})`);
  } else if (genderFilter === 'male_friendly') {
    // 자동차용품·완구·스포츠 카테고리 OR 강력 남성 키워드 포함
    const catPart = `category_name = ANY($${idx++})`;
    values.push([...MALE_HIGH_CATS, ...MALE_MID_CATS]);
    const kwParts = MALE_STRONG_KW.map((kw) => { const p = `title ILIKE $${idx++}`; values.push(`%${kw}%`); return p; });
    conditions.push(`(${catPart} OR ${kwParts.join(' OR ')})`);
  } else if (genderFilter === 'female') {
    const kwParts = FEMALE_KW.map((kw) => { const p = `title ILIKE $${idx++}`; values.push(`%${kw}%`); return p; });
    conditions.push(`(${kwParts.join(' OR ')})`);
  }

  // 시즌 상품 필터 — 현재 날짜 기준 활성 키워드 OR 조건
  // 활성 시즌 키워드가 없으면 빈 결과 반환 (필터가 무력화되어 전체 반환되는 버그 방지)
  if (seasonOnly) {
    const keywords = getActiveSeasonKeywords();
    if (keywords.length > 0) {
      const kParts = keywords.map((kw) => {
        const p = `title ILIKE $${idx++}`;
        values.push(`%${kw}%`);
        return p;
      });
      conditions.push(`(${kParts.join(' OR ')})`);
    } else {
      conditions.push('false');
    }
  }

  // 소싱 등급 필터 (grade.ts 컷오프: S≥80, A≥65, B≥50, C≥35, D<35)
  // costco_score_total null이면 구형 sourcing_score fallback
  if (grade !== 'all') {
    const sc = `COALESCE(costco_score_total, sourcing_score)`;
    if      (grade === 'S') conditions.push(`${sc} >= 80`);
    else if (grade === 'A') conditions.push(`${sc} >= 65 AND ${sc} < 80`);
    else if (grade === 'B') conditions.push(`${sc} >= 50 AND ${sc} < 65`);
    else if (grade === 'C') conditions.push(`${sc} >= 35 AND ${sc} < 50`);
    else if (grade === 'D') conditions.push(`${sc} < 35`);
  }

  // 별표 상품만 (migration 025 적용 시 활성화)
  if (asteriskOnly) {
    conditions.push(`has_asterisk = true`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // margin_rate_desc: 단가 기반 환산 시장가 우선, fallback → market_lowest_price
  // 공식: channel-policy.ts 기준 — 네이버 수수료 6%(0.94), VAT 10/110
  // net_profit = market * (1 - 0.06 - 10/110) - cost - logistics
  // margin_rate = net_profit / market * 100
  // 묶음 상품(예: 591ml×2)은 market_unit_price × total_quantity / divisor 로 환산하여
  // 단품 가격을 그대로 비교하는 오류를 방지한다.
  const effMarketExpr = `
    COALESCE(
      CASE
        WHEN market_unit_price IS NOT NULL AND market_unit_price > 0
             AND total_quantity  IS NOT NULL AND total_quantity  > 0
        THEN market_unit_price * total_quantity /
             CASE unit_type WHEN 'count' THEN 1.0 ELSE 100.0 END
        ELSE NULL
      END,
      NULLIF(market_lowest_price, 0)
    )
  `;
  const marginExpr = `
    CASE WHEN (${effMarketExpr}) IS NOT NULL
      THEN ((${effMarketExpr}) * (1.0 - 0.06 - 10.0/110.0) - price - 3500.0) / (${effMarketExpr}) * 100
      ELSE NULL
    END
  `;

  // 단가 절감율 정렬 표현식
  const unitSavingExpr = `
    CASE WHEN unit_price IS NOT NULL AND unit_price > 0 AND market_unit_price IS NOT NULL
      THEN (market_unit_price / unit_price - 1) * 100
      ELSE NULL
    END
  `;

  const orderBy: Record<string, string> = {
    sourcing_score_desc:    'COALESCE(costco_score_total, sourcing_score) DESC, collected_at DESC',
    unit_saving_rate_desc:  `(${unitSavingExpr}) DESC NULLS LAST, COALESCE(costco_score_total, sourcing_score) DESC`,
    margin_rate_desc:       `(${marginExpr}) DESC NULLS LAST`,
    price_asc:              'price ASC',
    price_desc:             'price DESC',
    review_count_desc:      'review_count DESC',
    collected_desc:         'collected_at DESC',
  };

  try {
    const [rowsRes, countRes, categoriesRes, lastCollectedRes] = await Promise.all([
      pool.query(
        `SELECT
           id, product_code, title, category_name, category_code,
           image_url, product_url, brand,
           price, original_price, first_price, lowest_price,
           average_rating, review_count, stock_status, shipping_included,
           market_lowest_price, market_price_source, market_price_updated_at,
           sourcing_score, demand_score, price_opp_score, urgency_score,
           seasonal_score, margin_score,
           unit_type, total_quantity, unit_price, unit_price_label, market_unit_price, market_unit_title,
           pack_qty, has_asterisk, expected_turnover_days,
           male_tier, male_bonus, season_bonus, season_labels, asterisk_bonus,
           blocked_reason, needs_review,
           costco_score_legal, costco_score_price, costco_score_cs,
           costco_score_margin, costco_score_demand, costco_score_turnover,
           costco_score_supply, costco_score_total, costco_score_calculated_at,
           collected_at
         FROM public.costco_products
         ${where}
         ORDER BY ${orderBy[sort]}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM public.costco_products ${where}`,
        values,
      ),
      pool.query(
        `SELECT DISTINCT category_name
         FROM public.costco_products
         WHERE is_active = true AND category_name IS NOT NULL
         ORDER BY category_name`,
      ),
      pool.query(
        `SELECT MAX(collected_at) AS last_collected FROM public.costco_products`,
      ),
    ]);

    // ── Layer 1 자동 로깅 (fire-and-forget) ──────────────────────────────
    void _logCostcoDiscovery(rowsRes.rows);

    return NextResponse.json({
      products: rowsRes.rows,
      total: countRes.rows[0]?.total ?? 0,
      page,
      pageSize,
      categories: categoriesRes.rows.map((r) => r.category_name),
      lastCollected: lastCollectedRes.rows[0]?.last_collected ?? null,
    });
  } catch (err) {
    console.error('[costco] GET 오류:', err);
    return NextResponse.json({ error: '상품 조회 실패' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — OCC API 수집 + DB upsert + 스코어 재계산
// ─────────────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  categoryNames: z.array(z.string()).optional(),
  maxPages: z.number().min(1).max(20).optional().default(10),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const pool = getSourcingPool();

  const logRes = await pool.query(
    `INSERT INTO public.costco_collection_logs (trigger_type) VALUES ('manual') RETURNING id`,
  );
  const logId: string = logRes.rows[0].id;

  try {
    const result = await fetchAllCostcoProducts({ categoryNames: parsed.data.categoryNames, maxPages: parsed.data.maxPages });

    if (result.products.length > 0) {
      const collectedCodes = result.products.map((p) => p.productCode);

      // 수집된 카테고리의 기존 상품만 비활성화 (다른 카테고리는 유지)
      const collectedCategories = [...new Set(result.products.map((p) => p.categoryName))];
      if (collectedCategories.length > 0) {
        await pool.query(
          `UPDATE public.costco_products SET is_active = false
           WHERE category_name = ANY($1) AND NOT (product_code = ANY($2))`,
          [collectedCategories, collectedCodes],
        );
      }

      for (const product of result.products) {
        await upsertProduct(pool, product);
      }

      // 일별 가격 로그
      await logPrices(pool, result.products);

      // 소싱 스코어 재계산
      await recalculateSourcingScores(pool);
    }

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

    return NextResponse.json({
      success: true,
      data: { totalFetched: result.totalFetched, errors: result.errors },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[costco] POST 오류:', msg);

    await pool.query(
      `UPDATE public.costco_collection_logs
       SET finished_at = now(), status = 'failed', errors = $1
       WHERE id = $2`,
      [JSON.stringify([{ category: 'global', message: msg }]), logId],
    );

    return NextResponse.json({ error: '수집 실패', detail: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

async function upsertProduct(pool: Pool, product: CostcoApiProduct) {
  // 단위 파싱 결과 계산 (실패 시 null)
  const unitResult = parseProductUnit(product.title);
  const unitType       = unitResult.success ? unitResult.parsed.unitType       : null;
  const totalQuantity  = unitResult.success ? unitResult.parsed.totalQuantity  : null;
  const baseUnit       = unitResult.success ? unitResult.parsed.baseUnit       : null;
  const unitPriceLabel = unitResult.success ? unitResult.parsed.unitPriceLabel : null;
  // 단가 = 가격 / 총량 * divisor (예: 13680ml → 100ml당)
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
       -- first_price: 최초 수집 가격은 덮어쓰지 않음
       first_price      = COALESCE(costco_products.first_price, EXCLUDED.price),
       -- lowest_price: 항상 더 낮은 값으로 갱신
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
      product.productCode,           // $1
      product.title,                 // $2
      product.categoryName,          // $3
      product.categoryCode,          // $4
      product.price,                 // $5
      product.originalPrice ?? null, // $6
      product.imageUrl ?? null,      // $7
      product.productUrl,            // $8
      product.brand ?? null,         // $9
      product.averageRating ?? null, // $10
      product.reviewCount,           // $11
      product.stockStatus,           // $12
      unitType,                      // $13
      totalQuantity,                 // $14
      baseUnit,                      // $15
      unitPrice,                     // $16
      unitPriceLabel,                // $17
    ],
  );
}

async function logPrices(pool: Pool, products: CostcoApiProduct[]) {
  if (products.length === 0) return;

  // product_code → id 매핑을 한 번의 IN 쿼리로 일괄 조회
  const codes = products.map((p) => p.productCode);
  const idRes = await pool.query(
    `SELECT id, product_code FROM public.costco_products WHERE product_code = ANY($1)`,
    [codes],
  );
  const codeToId: Record<string, string> = {};
  for (const row of idRes.rows) codeToId[row.product_code] = row.id;

  // 유효한 상품만 필터링
  const validProducts = products.filter((p) => codeToId[p.productCode]);
  if (validProducts.length === 0) return;

  // VALUES ($1,$2,$3,CURRENT_DATE), ... 로 bulk insert — PostgreSQL 65535 파라미터 한도
  // 파라미터 3개/행 → 배치당 최대 5000행 (안전 마진 포함)
  const BATCH_SIZE = 5000;
  for (let start = 0; start < validProducts.length; start += BATCH_SIZE) {
    const batch = validProducts.slice(start, start + BATCH_SIZE);
    const valuePlaceholders: string[] = [];
    const values: unknown[] = [];
    batch.forEach((p, i) => {
      const base = i * 3;
      valuePlaceholders.push(`($${base + 1},$${base + 2},$${base + 3},CURRENT_DATE)`);
      values.push(codeToId[p.productCode], p.productCode, p.price);
    });
    await pool.query(
      `INSERT INTO public.costco_price_logs (product_id, product_code, price, logged_at)
       VALUES ${valuePlaceholders.join(',')}
       ON CONFLICT (product_code, logged_at) DO UPDATE SET price = EXCLUDED.price`,
      values,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 로깅 헬퍼 — costco_products row[] → DiscoveryLogEntry[] 변환 후 upsert
// ─────────────────────────────────────────────────────────────────────────────

async function _logCostcoDiscovery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: Record<string, any>[],
): Promise<void> {
  if (products.length === 0) return;

  const entries: DiscoveryLogEntry[] = products.map((p) => ({
    channelSource: 'costco' as const,
    productId:     String(p.product_code),
    productName:   String(p.title ?? ''),
    category:      p.category_name ?? null,

    // v2 스코어가 있으면 사용, 없으면 구형 sourcing_score로 fallback
    scoreTotal:     p.costco_score_total ?? p.sourcing_score ?? null,
    scoreBreakdown: (p.costco_score_legal != null) ? {
      legal:    p.costco_score_legal    ?? 0,
      price:    p.costco_score_price    ?? 0,
      cs:       p.costco_score_cs       ?? 0,
      margin:   p.costco_score_margin   ?? 0,
      demand:   p.costco_score_demand   ?? 0,
      turnover: p.costco_score_turnover ?? 0,
      supply:   p.costco_score_supply   ?? 0,
    } : null,
    grade: null, // logDiscoveryBatch 내부에서 scoreTotal 기반 계산

    recommendedPriceNaver:   p.market_lowest_price ?? null,
    recommendedPriceCoupang: null,  // 코스트코는 단일 시장가 기준

    maleScore:     p.male_bonus    ?? null,
    maleTier:      p.male_tier     ?? null,
    seasonBonus:   p.season_bonus  ?? null,
    seasonLabels:  p.season_labels
      ? String(p.season_labels).split(',').filter(Boolean)
      : [],
    needsReview:   p.needs_review  ?? false,
    blockedReason: p.blocked_reason ?? null,
  }));

  await logDiscoveryBatch(entries);
}
