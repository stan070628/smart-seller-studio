/**
 * GET /api/sourcing/analyze
 * sales_analysis_view 조회 → 판매 분석 데이터 반환
 *
 * 쿼리 파라미터:
 *   sort     — 정렬 컬럼 (sales_1d | sales_7d | avg_daily_sales | latest_inventory | latest_price_dome)
 *   order    — asc | desc (기본값: desc)
 *   category — 카테고리명 필터
 *   limit    — 페이지 크기 (기본값: 50, 최대 200)
 *   offset   — 시작 위치 (기본값: 0)
 *   search   — 상품명 키워드 검색
 *
 * 응답: { success: true, data: { items: SalesAnalysisItem[], total, lastCollectedAt } }
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { toParentCategory, getSubCategories } from '@/lib/sourcing/category-map';
import type { SalesAnalysisItem } from '@/types/sourcing';

// ─────────────────────────────────────────
// 허용 정렬 컬럼 화이트리스트 (SQL 인젝션 방지)
// ─────────────────────────────────────────

const ALLOWED_SORT_COLUMNS = new Set([
  'sales_1d',
  'sales_7d',
  'avg_daily_sales',
  'latest_inventory',
  'latest_price_dome',
  'latest_price_supply',
  'item_no',
  'title',
  'latest_date',
  'margin_rate',
  'moq',
  'legal_status',
]);

const DEFAULT_SORT = 'sales_7d';
const DEFAULT_ORDER = 'desc';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ─────────────────────────────────────────
// DB 행 → SalesAnalysisItem 변환
// ─────────────────────────────────────────

function toSalesAnalysisItem(row: Record<string, unknown>): SalesAnalysisItem {
  return {
    id: row.id as string,
    itemNo: row.item_no as number,
    title: row.title as string,
    status: (row.status as string) ?? null,
    categoryName: toParentCategory((row.category_name as string) ?? null),
    sellerNick: (row.seller_nick as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    domeUrl: (row.dome_url as string) ?? null,
    isTracking: row.is_tracking as boolean,
    latestDate: row.latest_date as string,
    latestInventory: row.latest_inventory as number,
    latestPriceDome: (row.latest_price_dome as number) ?? null,
    latestPriceSupply: (row.latest_price_supply as number) ?? null,
    prevInventory1d: (row.prev_inventory_1d as number) ?? null,
    sales1d: row.sales_1d as number,
    prevInventory7d: (row.prev_inventory_7d as number) ?? null,
    prev7dDate: (row.prev_7d_date as string) ?? null,
    sales7d: row.sales_7d as number,
    avgDailySales: Number(row.avg_daily_sales ?? 0),
    // 마진율 관련 추가 필드
    moq: (row.moq as number) ?? null,
    unitQty: (row.unit_qty as number) ?? null,
    deliWho: (row.deli_who as string) ?? null,
    deliFee: (row.deli_fee as number) ?? null,
    priceResaleRecommend: (row.price_resale_recommend as number) ?? null,
    marginRate: row.margin_rate != null ? Number(row.margin_rate) : null,
    // Legal 방어 로직 필드
    legalStatus: (row.legal_status as string) ?? 'unchecked',
    legalIssues: Array.isArray(row.legal_issues) ? row.legal_issues : [],
    legalCheckedAt: (row.legal_checked_at as string) ?? null,
    // IP 리스크 필드 — KIPRIS 검증 결과
    ipRiskLevel: (row.ip_risk_level as 'low' | 'medium' | 'high' | null) ?? null,
    ipCheckedAt: (row.ip_checked_at as string) ?? null,
    priceTiers: { dome: [], supply: [], resale: [] },
  } as SalesAnalysisItem;
}

// ─────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 쿼리 파라미터 파싱 및 검증
    const rawSort = searchParams.get('sort') ?? DEFAULT_SORT;
    // 화이트리스트 검증 통과한 컬럼만 SQL에 직접 삽입 (파라미터화 불가 — 컬럼명)
    const validatedSort = ALLOWED_SORT_COLUMNS.has(rawSort) ? rawSort : DEFAULT_SORT;
    // margin_rate / moq 는 SELECT 절의 alias (또는 si. 직접 참조)
    // 뷰 컬럼은 v. 접두사, si/계산 컬럼은 그대로 사용
    const VIEW_COLUMNS = new Set([
      'sales_1d', 'sales_7d', 'avg_daily_sales',
      'latest_inventory', 'latest_price_dome', 'latest_price_supply',
      'item_no', 'title', 'latest_date',
    ]);
    const SI_COLUMNS = new Set(['moq', 'legal_status']);
    const sortColumn = VIEW_COLUMNS.has(validatedSort)
      ? `v.${validatedSort}`
      : SI_COLUMNS.has(validatedSort)
        ? `si.${validatedSort}`
        : validatedSort;

    const rawOrder = searchParams.get('order') ?? DEFAULT_ORDER;
    const orderDir = rawOrder === 'asc' ? 'ASC' : 'DESC';

    const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isNaN(rawLimit)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(1, rawLimit));

    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    const category = searchParams.get('category') ?? null;
    const search = searchParams.get('search') ?? null;
    const rawMoq = searchParams.get('moq');
    const moqMax = rawMoq != null ? parseInt(rawMoq, 10) : null;
    const freeDeliOnly = searchParams.get('freeDeliOnly') === '1';

    const pool = getSourcingPool();

    // WHERE 절 동적 구성 — 파라미터 인덱스를 순서대로 증가
    // v. 접두사 없는 조건 (sales_analysis_view 컬럼)
    const vConditions: string[] = [];
    // si. 접두사 조건 (sourcing_items 컬럼)
    const siConditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (category) {
      // 상위 카테고리 → 세분류 목록으로 IN 조건
      const subs = getSubCategories(category);
      if (category === '기타' || subs.length === 0) {
        // '기타'이거나 매핑 없으면 직접 비교
        vConditions.push(`v.category_name = $${paramIdx++}`);
        params.push(category);
      } else {
        const placeholders = subs.map(() => `$${paramIdx++}`).join(', ');
        vConditions.push(`v.category_name IN (${placeholders})`);
        params.push(...subs);
      }
    }

    if (search) {
      // ILIKE로 대소문자 무관 부분 일치 검색
      vConditions.push(`v.title ILIKE $${paramIdx++}`);
      params.push(`%${search}%`);
    }

    if (moqMax != null && !Number.isNaN(moqMax)) {
      siConditions.push(`(si.moq IS NULL OR si.moq <= $${paramIdx++})`);
      params.push(moqMax);
    }

    if (freeDeliOnly) {
      siConditions.push(`si.deli_who = 'S'`);
    }

    const allConditions = [...vConditions, ...siConditions];

    // allConditions 는 이미 테이블 접두사(v./si.)가 붙어있음
    const finalWhereClause =
      allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';

    // 전체 건수 조회 (COUNT) — sourcing_items JOIN 포함
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM sales_analysis_view v
       JOIN sourcing_items si ON si.id = v.id
       ${finalWhereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    // 데이터 조회 — sortColumn과 orderDir은 화이트리스트 검증 완료로 직접 삽입
    // sourcing_items의 마진율 관련 필드를 JOIN으로 함께 조회
    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;
    const dataResult = await pool.query<Record<string, unknown>>(
      `SELECT
         v.*,
         si.moq,
         si.unit_qty,
         si.deli_who,
         si.deli_fee,
         si.price_resale_recommend,
         si.legal_status,
         si.legal_issues,
         si.legal_checked_at,
         si.ip_risk_level,
         si.ip_checked_at,
         CASE
           WHEN si.price_resale_recommend > 0
             THEN ROUND(
               (si.price_resale_recommend
                 - COALESCE(si.price_dome, v.latest_price_dome, 0)
                 - CASE WHEN si.deli_who != 'P'
                     THEN COALESCE(si.deli_fee, 0)::numeric / GREATEST(COALESCE(si.moq, 1), 1)
                     ELSE 0
                   END
               )::numeric
               / si.price_resale_recommend * 100,
               1
             )
           ELSE NULL
         END AS margin_rate
       FROM sales_analysis_view v
       JOIN sourcing_items si ON si.id = v.id
       ${finalWhereClause}
       ORDER BY ${sortColumn} ${orderDir} NULLS LAST
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset],
    );

    // 마지막 수집 시각 조회 (collection_logs 최신 성공 레코드)
    const lastLogResult = await pool.query<{ started_at: string }>(
      `SELECT started_at FROM collection_logs
       WHERE status = 'success'
       ORDER BY started_at DESC
       LIMIT 1`,
    );

    // 전체 카테고리 목록 조회
    const catResult = await pool.query<{ category_name: string }>(
      `SELECT DISTINCT category_name FROM sourcing_items
       WHERE category_name IS NOT NULL
       ORDER BY category_name`,
    );

    const rawItems = dataResult.rows.map(toSalesAnalysisItem);

    // price_tiers 일괄 조회 — 해당 페이지 아이템들의 수량별 가격 티어
    const itemIds = rawItems.map((i) => i.id);
    let tiersMap: Record<string, SalesAnalysisItem['priceTiers']> = {};
    if (itemIds.length > 0) {
      const tiersResult = await pool.query<{
        item_id: string;
        price_type: string;
        min_qty: number;
        unit_price: number;
      }>(
        `SELECT item_id, price_type, min_qty, unit_price
         FROM price_tiers
         WHERE item_id = ANY($1::uuid[])
         ORDER BY item_id, price_type, min_qty`,
        [itemIds],
      );
      for (const row of tiersResult.rows) {
        if (!tiersMap[row.item_id]) {
          tiersMap[row.item_id] = { dome: [], supply: [], resale: [] };
        }
        const bucket = tiersMap[row.item_id];
        const tier = { minQty: row.min_qty, unitPrice: row.unit_price };
        if (row.price_type === 'dome' && bucket.dome) bucket.dome.push(tier);
        else if (row.price_type === 'supply' && bucket.supply) bucket.supply.push(tier);
        else if (row.price_type === 'resale' && bucket.resale) bucket.resale.push(tier);
      }
    }

    const items = rawItems.map((item) => ({
      ...item,
      priceTiers: tiersMap[item.id] ?? { dome: [], supply: [], resale: [] },
    }));

    const lastCollectedAt = lastLogResult.rows[0]?.started_at ?? null;
    // 세분류 → 상위 카테고리 변환 후 중복 제거 + 정렬
    const categories = [...new Set(
      catResult.rows.map((r) => toParentCategory(r.category_name)),
    )].sort();

    return Response.json({
      success: true,
      data: {
        items,
        total,
        lastCollectedAt,
        categories,
      },
    });
  } catch (err) {
    console.error('[GET /api/sourcing/analyze] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
