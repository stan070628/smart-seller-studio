/**
 * costco-client.ts
 * 코스트코 코리아 SAP Hybris OCC v2 REST API 클라이언트
 *
 * ⚠ 카테고리 필터 방법:
 *   categoryCode 파라미터는 무효 (잘못된 코드도 전체 8140개 반환)
 *   올바른 방식: query=:relevance:category:OCC_CODE
 */

import type { OccSearchResponse, CostcoApiProduct, CostcoFetchResult } from '@/types/costco';
import {
  COSTCO_API_BASE,
  COSTCO_API_DEFAULTS,
  COSTCO_CATEGORIES,
  OCC_CODE_TO_CATEGORY,
  FETCH_DELAY_MS,
  MAX_PAGES_PER_CATEGORY,
} from './costco-constants';
import { parseProductUnit } from './unit-parser';

// ─────────────────────────────────────────────────────────────────────────────
// OCC 응답 정규화
// ─────────────────────────────────────────────────────────────────────────────

function normalizeStockStatus(
  status?: string,
): 'inStock' | 'outOfStock' | 'lowStock' {
  if (status === 'outOfStock') return 'outOfStock';
  if (status === 'lowStock') return 'lowStock';
  return 'inStock';
}

function extractImageUrl(
  images?: OccSearchResponse['products'][number]['images'],
): string | undefined {
  if (!images || images.length === 0) return undefined;
  const primary =
    images.find((img) => img.imageType === 'PRIMARY' && img.format === 'product') ??
    images.find((img) => img.imageType === 'PRIMARY') ??
    images[0];
  const url = primary?.url;
  if (!url) return undefined;
  return url.startsWith('http') ? url : `https://www.costco.co.kr${url}`;
}

function occProductToApi(
  raw: OccSearchResponse['products'][number],
  categoryName: string,
  categoryCode: string,
): CostcoApiProduct | null {
  if (!raw.code || !raw.name) return null;
  const price = raw.price?.value ?? 0;
  if (price <= 0) return null;

  const productUrl = raw.url
    ? raw.url.startsWith('http')
      ? raw.url
      : `https://www.costco.co.kr${raw.url}`
    : `https://www.costco.co.kr/p/${raw.code}`;

  return {
    productCode: raw.code,
    title: raw.name,
    categoryName,
    categoryCode,
    price,
    originalPrice:
      raw.listPrice?.value && raw.listPrice.value > price
        ? raw.listPrice.value
        : undefined,
    imageUrl: extractImageUrl(raw.images),
    productUrl,
    brand: raw.manufacturer || undefined,
    averageRating: raw.averageRating || undefined,
    reviewCount: raw.numberOfReviews ?? 0,
    stockStatus: normalizeStockStatus(raw.stock?.stockLevelStatus),
    shippingIncluded: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 OCC 서브카테고리 페이지 수집
//
// 올바른 필터 형식: query=:relevance:category:cos_10.10.6
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCostcoSubcategory(
  occCode: string,
  page: number = 0,
): Promise<{ products: CostcoApiProduct[]; hasMore: boolean }> {
  const categoryName = OCC_CODE_TO_CATEGORY[occCode] ?? occCode;

  const params = new URLSearchParams({
    fields: COSTCO_API_DEFAULTS.fields,
    query: `:relevance:category:${occCode}`,
    pageSize: String(COSTCO_API_DEFAULTS.pageSize),
    currentPage: String(page),
    lang: COSTCO_API_DEFAULTS.lang,
    curr: COSTCO_API_DEFAULTS.curr,
  });

  const url = `${COSTCO_API_BASE}/products/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`OCC API ${res.status}: ${url}`);
  }

  const data = (await res.json()) as OccSearchResponse;

  const products = (data.products ?? [])
    .map((p) => occProductToApi(p, categoryName, occCode))
    .filter((p): p is CostcoApiProduct => p !== null);

  const pagination = data.pagination;
  const hasMore =
    !!pagination &&
    pagination.currentPage < pagination.totalPages - 1 &&
    products.length > 0;

  return { products, hasMore };
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 상품 조회
// OCC v2 API로 product code를 사용해 직접 조회
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCostcoProduct(code: string): Promise<CostcoApiProduct | null> {
  const params = new URLSearchParams({
    fields: COSTCO_API_DEFAULTS.fields,
    lang: COSTCO_API_DEFAULTS.lang,
    curr: COSTCO_API_DEFAULTS.curr,
  });

  const url = `${COSTCO_API_BASE}/products/${encodeURIComponent(code)}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;

  const raw = (await res.json()) as OccSearchResponse['products'][number];
  const categoryCode = (raw as unknown as { categories?: { code?: string }[] })?.categories?.[0]?.code ?? '';
  const categoryName = OCC_CODE_TO_CATEGORY[categoryCode] ?? '기타';

  return occProductToApi(raw, categoryName, categoryCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// 전체 카테고리 수집
// 카테고리 그룹 → 서브카테고리 코드 배열을 순회하며 수집
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAllCostcoProducts(options: {
  categoryNames?: string[];
  maxPages?: number;
} = {}): Promise<CostcoFetchResult> {
  const { maxPages = MAX_PAGES_PER_CATEGORY } = options;

  const targetCategories = options.categoryNames
    ? COSTCO_CATEGORIES.filter((c) => options.categoryNames!.includes(c.name))
    : COSTCO_CATEGORIES;

  const allProducts: CostcoApiProduct[] = [];
  const errors: Array<{ category: string; message: string }> = [];
  let requestCount = 0;

  for (const category of targetCategories) {
    for (const occCode of category.codes) {
      for (let page = 0; page < maxPages; page++) {
        // rate limiting (첫 번째 요청은 제외)
        if (requestCount > 0) {
          await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
        }
        requestCount++;

        try {
          const { products, hasMore } = await fetchCostcoSubcategory(occCode, page);
          allProducts.push(...products);
          if (!hasMore) break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({
            category: `${category.name}(${occCode}) p${page + 1}`,
            message: msg,
          });
          break;
        }
      }
    }
  }

  // 중복 제거 (productCode 기준)
  const seen = new Set<string>();
  const unique = allProducts.filter((p) => {
    if (seen.has(p.productCode)) return false;
    seen.add(p.productCode);
    return true;
  });

  return { products: unique, errors, totalFetched: unique.length };
}
