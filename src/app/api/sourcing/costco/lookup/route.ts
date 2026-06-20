/**
 * GET /api/sourcing/costco/lookup
 * 코스트코 상품코드(7자리 숫자)로 단일 상품을 조회한다.
 *
 * 우선순위:
 *  1. DB(costco_products) 조회 — is_active = true 인 행
 *  2. OCC API fallback — DB에 없으면 실시간 요청
 *
 * 쿼리 파라미터:
 *  - code: 5~10자리 숫자 문자열 (필수)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchCostcoProduct, fetchCostcoProductBySearch } from '@/lib/sourcing/costco-client';
import { upsertCostcoProduct } from '@/lib/sourcing/costco-upsert';
import type { CostcoApiProduct, CostcoProductRow } from '@/types/costco';
import { requireAuth } from '@/lib/supabase/auth';

export const runtime = 'nodejs';
export const maxDuration = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 입력 검증 스키마
// ─────────────────────────────────────────────────────────────────────────────

const querySchema = z.object({
  code: z.string().regex(/^\d+$/, '숫자만 허용').min(5).max(10),
});

// ─────────────────────────────────────────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface LookupResult {
  /** 데이터 출처: DB 캐시 또는 실시간 OCC API */
  source: 'db' | 'api';
  productCode: string;
  title: string;
  imageUrl: string | null;
  categoryName: string | null;
  onlinePrice: number;
  averageRating: number | null;
  reviewCount: number;
  unitPriceLabel: string | null;
  unitPrice: number | null;
  marketLowestPrice: number | null;
  marketUnitPrice: number | null;
  productUrl: string;
  unitType: 'weight' | 'volume' | 'count' | null;
  totalQuantity: number | null;
  baseUnit: string | null;
  stockStatus: 'inStock' | 'outOfStock' | 'lowStock';
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 행 → LookupResult 변환
// ─────────────────────────────────────────────────────────────────────────────

function rowToResult(row: CostcoProductRow): LookupResult {
  return {
    source: 'db',
    productCode: row.product_code,
    title: row.title,
    imageUrl: row.image_url,
    categoryName: row.category_name,
    onlinePrice: row.price,
    averageRating: row.average_rating ? parseFloat(row.average_rating) : null,
    reviewCount: row.review_count,
    unitPriceLabel: row.unit_price_label ?? null,
    unitPrice: row.unit_price ?? null,
    marketLowestPrice: row.market_lowest_price,
    marketUnitPrice: row.market_unit_price ?? null,
    productUrl: row.product_url,
    unitType: row.unit_type ?? null,
    totalQuantity: row.total_quantity ?? null,
    baseUnit: null,
    stockStatus: row.stock_status ?? 'inStock',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OCC API 응답 → LookupResult 변환
// ─────────────────────────────────────────────────────────────────────────────

function apiProductToLookupResult(product: CostcoApiProduct): LookupResult {
  return {
    source: 'api',
    productCode: product.productCode,
    title: product.title,
    imageUrl: product.imageUrl ?? null,
    categoryName: product.categoryName,
    onlinePrice: product.price,
    averageRating: product.averageRating ?? null,
    reviewCount: product.reviewCount,
    unitPriceLabel: null,
    unitPrice: null,
    marketLowestPrice: null,
    marketUnitPrice: null,
    productUrl: product.productUrl,
    unitType: null,
    totalQuantity: null,
    baseUnit: null,
    stockStatus: product.stockStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // 입력 검증
  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({ code: searchParams.get('code') });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { code } = parsed.data;

  // 1. DB 우선 조회
  try {
    const pool = getSourcingPool();
    const res = await pool.query<CostcoProductRow>(
      `SELECT * FROM public.costco_products WHERE product_code = $1 AND is_active = true LIMIT 1`,
      [code],
    );
    if (res.rows.length > 0) {
      return NextResponse.json(rowToResult(res.rows[0]));
    }
  } catch (err) {
    console.error('[costco/lookup] DB 조회 실패:', err);
    return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
  }

  // 2. OCC API fallback — DB에 상품이 없을 때 실시간 조회
  let product;
  try {
    product = await fetchCostcoProduct(code);
  } catch (err) {
    console.error('[costco/lookup] OCC API 조회 실패:', err);
    return NextResponse.json({ error: 'API 조회 실패' }, { status: 500 });
  }
  if (!product) {
    // 3. OCC search API fallback — product detail에서도 찾지 못할 때
    let searchProduct: CostcoApiProduct | null;
    try {
      searchProduct = await fetchCostcoProductBySearch(code);
    } catch (err) {
      console.error('[costco/lookup] OCC search 조회 실패:', err);
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }
    if (!searchProduct) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }

    // DB 저장 — 다음 조회부터 step 1에서 즉시 반환됨
    // upsert 실패해도 이번 조회 결과는 정상 반환 (fire-and-forget)
    try {
      const pool = getSourcingPool();
      await upsertCostcoProduct(pool, searchProduct);
    } catch (err) {
      console.error('[costco/lookup] search 결과 upsert 실패:', err);
    }

    return NextResponse.json(apiProductToLookupResult(searchProduct));
  }

  // OCC product detail 성공
  return NextResponse.json(apiProductToLookupResult(product));
}
