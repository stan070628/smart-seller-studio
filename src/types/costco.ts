/**
 * Costco 소싱 관련 타입 정의
 * OCC v2 API 응답, DB 행, UI 정렬 키 등
 */

// ─────────────────────────────────────────────────────────────────────────────
// OCC API 응답 타입
// ─────────────────────────────────────────────────────────────────────────────

/** OCC products/search API의 단일 상품 항목 */
export interface OccProduct {
  code: string;
  name: string;
  price?: {
    value: number;
    currencyIso: string;
    formattedValue?: string;
  };
  /** 할인 전 정가 */
  listPrice?: {
    value: number;
    currencyIso: string;
  };
  images?: Array<{
    imageType: string; // 'PRIMARY' | 'GALLERY'
    url: string;
    format?: string;   // 'product' | 'thumbnail' | 'zoom'
  }>;
  averageRating?: number;
  numberOfReviews?: number;
  stock?: {
    stockLevelStatus: 'inStock' | 'outOfStock' | 'lowStock';
    stockLevel?: number;
  };
  manufacturer?: string;
  categories?: Array<{ code: string; name: string }>;
  url?: string;
}

/** OCC products/search API 페이지 응답 */
export interface OccSearchResponse {
  products: OccProduct[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalResults: number;
  };
  currentQuery?: {
    query?: { value?: string };
    url?: string;
  };
}

/** 정규화된 코스트코 상품 (OCC → 내부 표현) */
export interface CostcoApiProduct {
  productCode: string;
  title: string;
  categoryName: string;
  categoryCode: string;
  price: number;
  originalPrice?: number;
  imageUrl?: string;
  productUrl: string;
  brand?: string;
  averageRating?: number;
  reviewCount: number;
  stockStatus: 'inStock' | 'outOfStock' | 'lowStock';
  shippingIncluded: boolean;
}

/** 카테고리별 수집 결과 */
export interface CostcoFetchResult {
  products: CostcoApiProduct[];
  errors: Array<{ category: string; message: string }>;
  totalFetched: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 행 타입
// ─────────────────────────────────────────────────────────────────────────────

/** costco_products 테이블 행 */
export interface CostcoProductRow {
  id: string;
  product_code: string;
  title: string;
  category_name: string | null;
  category_code: string | null;
  image_url: string | null;
  product_url: string;
  brand: string | null;

  price: number;
  original_price: number | null;
  first_price: number | null;
  lowest_price: number | null;
  target_sell_price: number | null; // GENERATED ALWAYS AS

  average_rating: string | null; // numeric → string (pg driver)
  review_count: number;
  stock_status: 'inStock' | 'outOfStock' | 'lowStock';
  shipping_included: boolean;

  market_lowest_price: number | null;
  market_price_source: 'manual' | 'naver_api' | 'coupang_api' | null;
  market_price_updated_at: string | null;

  /** 단위 (예: "100g", "1정", "100ml") */
  costco_unit: string | null;
  /** 코스트코 단위당 가격 (예: 100g당 450원) */
  costco_unit_price: number | null;
  /** 네이버 동일 단위 최저가 (예: 100g당 820원) */
  naver_unit_price: number | null;
  /** 단가 절감율 (예: 45.1 → 45.1% 저렴) */
  unit_saving_rate: number | null;

  /** 단위 유형: 무게/부피/개수 */
  unit_type?: 'weight' | 'volume' | 'count' | null;
  /** 코스트코 단가 (100g당/100ml당/1개당) */
  unit_price?: number | null;
  /** 단가 레이블 (예: '100g당', '100ml당', '1개당') */
  unit_price_label?: string | null;
  /** 네이버 동일 기준 단가 */
  market_unit_price?: number | null;
  /** 매칭된 네이버 상품명 */
  market_unit_title?: string | null;

  sourcing_score: number;
  demand_score: number;
  price_opp_score: number;
  urgency_score: number;
  seasonal_score: number;
  margin_score: number;

  is_active: boolean;
  collected_at: string;
  created_at: string;
  updated_at: string;
}

/** costco_seasonal_cache 테이블 행 */
export interface SeasonalCacheRow {
  id: string;
  keyword_group: string;
  reference_month: string; // date → 'YYYY-MM-DD'
  ratio: string;           // numeric → string
  seasonal_index: string | null;
  fetched_at: string;
}

/** costco_market_prices 테이블 행 */
export interface MarketPriceRow {
  id: string;
  product_id: string;
  product_code: string;
  market_price: number;
  source: 'manual' | 'naver_api' | 'coupang_api';
  logged_at: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI / API 쿼리 타입
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/sourcing/costco 정렬 키 */
export type CostcoSortKey =
  | 'sourcing_score_desc'
  | 'unit_saving_rate_desc'
  | 'margin_rate_desc'
  | 'price_asc'
  | 'price_desc'
  | 'review_count_desc'
  | 'collected_desc';

/** GET /api/sourcing/costco 응답 */
export interface CostcoListResponse {
  products: CostcoProductRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  lastCollected: string | null;
}

/** PUT /api/sourcing/costco/market-price 요청 */
export interface MarketPriceInput {
  productCode: string;
  marketPrice: number;
  source?: 'manual' | 'naver_api' | 'coupang_api';
}
