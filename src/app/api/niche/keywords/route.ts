/**
 * GET /api/niche/keywords
 * niche_keywords 테이블 목록 조회 (필터·정렬·페이지네이션)
 *
 * 쿼리 파라미터:
 *   grade    — 콤마 구분 등급 필터 (예: "S,A") — 없으면 전체
 *   category — category_tag 컬럼 일치 필터
 *   sort     — totalScore (기본) | analyzedAt
 *   order    — desc (기본) | asc
 *   limit    — 페이지 크기 (기본 30, 최대 100)
 *   offset   — 시작 위치 (기본 0)
 *   search   — keyword ILIKE 검색
 *
 * 응답: { success: true, data: { items: NicheKeyword[], total, unreadAlertCount } }
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { NicheKeyword } from '@/types/niche';

// ─────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────

const DEFAULT_LIMIT = 30;
const MAX_LIMIT     = 100;
const DEFAULT_ORDER = 'DESC';

// SQL 인젝션 방지: 허용 등급 목록
const ALLOWED_GRADES = new Set(['S', 'A', 'B', 'C', 'D']);

// sort 파라미터 → 실제 컬럼명 매핑 (화이트리스트)
const SORT_COLUMN_MAP: Record<string, string> = {
  totalScore:  'total_score',
  analyzedAt:  'analyzed_at',
};

const DEFAULT_SORT_COLUMN = 'total_score';

// ─────────────────────────────────────────────────
// DB 행 → NicheKeyword 변환 (snake_case → camelCase)
// ─────────────────────────────────────────────────

function toNicheKeyword(row: Record<string, unknown>): NicheKeyword {
  return {
    id:               row.id as string,
    keyword:          row.keyword as string,
    categoryTag:      (row.category_tag as string) ?? null,
    totalScore:       Number(row.total_score),
    grade:            row.grade as string,
    breakdown: {
      rocketNonEntry:       Number(row.score_rocket_non_entry ?? 0),
      competitionLevel:     Number(row.score_competition_level ?? 0),
      sellerDiversity:      Number(row.score_seller_diversity ?? 0),
      monopolyLevel:        Number(row.score_monopoly_level ?? 0),
      brandRatio:           Number(row.score_brand_ratio ?? 0),
      priceMarginViability: Number(row.score_price_margin ?? 0),
      domesticRarity:       Number(row.score_domestic_rarity ?? 0),
    },
    signals:           Array.isArray(row.signals) ? (row.signals as string[]) : [],
    rawTotalProducts:  row.raw_total_products != null ? Number(row.raw_total_products) : null,
    rawAvgPrice:       row.raw_avg_price      != null ? Number(row.raw_avg_price)      : null,
    rawMedianPrice:    row.raw_median_price   != null ? Number(row.raw_median_price)   : null,
    rawUniqueSellers:  row.raw_unique_sellers != null ? Number(row.raw_unique_sellers) : null,
    analyzedAt:        row.analyzed_at as string,
  };
}

// ─────────────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // ── 쿼리 파라미터 파싱 ────────────────────────

    // grade: 콤마 구분 → 유효한 등급만 필터
    const rawGrade = searchParams.get('grade');
    const gradeFilter: string[] = rawGrade
      ? rawGrade.split(',').map((g) => g.trim().toUpperCase()).filter((g) => ALLOWED_GRADES.has(g))
      : [];

    // category: category_tag 일치 필터
    const categoryFilter = searchParams.get('category') ?? null;

    // sort: 화이트리스트 매핑
    const rawSort   = searchParams.get('sort') ?? 'totalScore';
    const sortColumn = SORT_COLUMN_MAP[rawSort] ?? DEFAULT_SORT_COLUMN;

    // order: asc | desc
    const rawOrder = searchParams.get('order') ?? 'desc';
    const orderDir = rawOrder === 'asc' ? 'ASC' : DEFAULT_ORDER;

    // limit: 기본 30, 최대 100
    const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isNaN(rawLimit)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(1, rawLimit));

    // offset: 기본 0
    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    // search: keyword ILIKE
    const search = searchParams.get('search') ?? null;

    // ── WHERE 절 동적 구성 ───────────────────────
    const conditions: string[] = [];
    const params: unknown[]    = [];
    let paramIdx = 1;

    if (gradeFilter.length > 0) {
      const placeholders = gradeFilter.map(() => `$${paramIdx++}`).join(', ');
      conditions.push(`grade IN (${placeholders})`);
      params.push(...gradeFilter);
    }

    if (categoryFilter) {
      conditions.push(`category_tag = $${paramIdx++}`);
      params.push(categoryFilter);
    }

    if (search) {
      conditions.push(`keyword ILIKE $${paramIdx++}`);
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const pool = getSourcingPool();

    // ── COUNT 조회 ───────────────────────────────
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM niche_keywords ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    // ── 데이터 조회 ──────────────────────────────
    // sortColumn과 orderDir은 화이트리스트 검증 완료로 직접 삽입
    const limitParam  = paramIdx++;
    const offsetParam = paramIdx++;
    const dataResult  = await pool.query<Record<string, unknown>>(
      `SELECT
         id,
         keyword,
         category_tag,
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
         analyzed_at
       FROM niche_keywords
       ${whereClause}
       ORDER BY ${sortColumn} ${orderDir} NULLS LAST
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset],
    );

    // ── 미읽 알림 건수 조회 ──────────────────────
    const alertResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM niche_alerts WHERE is_read = false`,
    );
    const unreadAlertCount = parseInt(alertResult.rows[0]?.cnt ?? '0', 10);

    // ── 응답 반환 ────────────────────────────────
    const items: NicheKeyword[] = dataResult.rows.map(toNicheKeyword);

    return Response.json({
      success: true,
      data: {
        items,
        total,
        unreadAlertCount,
      },
    });
  } catch (err) {
    console.error('[GET /api/niche/keywords] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
