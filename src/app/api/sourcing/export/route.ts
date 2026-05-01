/**
 * GET /api/sourcing/export
 * sales_analysis_view 데이터를 CSV 파일로 다운로드
 *
 * analyze와 동일한 쿼리 파라미터 지원:
 *   sort, order, category, limit, offset, search
 *
 * 응답: text/csv (Content-Disposition: attachment; filename="sourcing_export_YYYYMMDD.csv")
 *
 * CSV 컬럼: 상품번호, 상품명, 카테고리, 판매자, 현재재고, 전일판매, 7일판매, 일평균판매, 도매가, 공급가
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────
// 허용 정렬 컬럼 화이트리스트
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
]);

const DEFAULT_SORT = 'sales_7d';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

// ─────────────────────────────────────────
// CSV 셀 이스케이프 (RFC 4180 준수)
// ─────────────────────────────────────────

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // 쉼표, 큰따옴표, 줄바꿈이 포함된 경우 큰따옴표로 감싸고 내부 큰따옴표는 ""로 이스케이프
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─────────────────────────────────────────
// DB 행 → CSV 행 변환
// ─────────────────────────────────────────

function rowToCsvLine(row: Record<string, unknown>): string {
  const cells = [
    row.item_no,
    row.title,
    row.category_name,
    row.seller_nick,
    row.latest_inventory,
    row.sales_1d,
    row.sales_7d,
    row.avg_daily_sales,
    row.latest_price_dome,
    row.latest_price_supply,
  ];
  return cells.map((c) => escapeCsvCell(c as string | number | null)).join(',');
}

// ─────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 쿼리 파라미터 파싱
    const rawSort = searchParams.get('sort') ?? DEFAULT_SORT;
    // 화이트리스트 검증 통과한 컬럼만 SQL에 직접 삽입 (컬럼명은 파라미터화 불가)
    const sortColumn = ALLOWED_SORT_COLUMNS.has(rawSort) ? rawSort : DEFAULT_SORT;

    const rawOrder = searchParams.get('order') ?? 'desc';
    const orderDir = rawOrder === 'asc' ? 'ASC' : 'DESC';

    const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isNaN(rawLimit)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(1, rawLimit));

    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    const category = searchParams.get('category') ?? null;
    const search = searchParams.get('search') ?? null;

    const pool = getSourcingPool();

    // WHERE 절 동적 구성 — 파라미터 인덱스를 순서대로 증가
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (category) {
      // 부모 카테고리 기준 — analyze 라우트와 동일하게 parent_category_name 사용
      conditions.push(`parent_category_name = $${paramIdx++}`);
      params.push(category);
    }

    if (search) {
      conditions.push(`title ILIKE $${paramIdx++}`);
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;

    const dataResult = await pool.query<Record<string, unknown>>(
      `SELECT *
       FROM sales_analysis_view
       ${whereClause}
       ORDER BY ${sortColumn} ${orderDir} NULLS LAST
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, limit, offset],
    );

    // CSV 생성
    const header =
      '상품번호,상품명,카테고리,판매자,현재재고,전일판매,7일판매,일평균판매,도매가,공급가';

    const lines = [
      header,
      ...dataResult.rows.map((row) => rowToCsvLine(row)),
    ];

    // UTF-8 BOM 추가 (Excel 한글 깨짐 방지)
    const BOM = '\uFEFF';
    const csvContent = BOM + lines.join('\r\n');

    // 파일명에 오늘 날짜 포함
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const dateStr = kstNow.toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `sourcing_export_${dateStr}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[GET /api/sourcing/export] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
