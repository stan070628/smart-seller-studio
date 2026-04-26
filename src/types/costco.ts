/**
 * Costco 소싱 관련 타입 정의
 * OCC v2 API 응답, DB 행, UI 정렬 키 등
 */

// ─────────────────────────────────────────────────────────────────────────────
// OCC API 응답 타입
// ─────────────────────────────────────────────────────────────────────────────

/** OCC classifications 스펙 피처 */
export interface OccFeatureValue {
  value: string;
  unit?: { name?: string; symbol?: string };
}
export interface OccFeature {
  code?: string;
  name: string;
  featureValues: OccFeatureValue[];
  comparable?: boolean;
  range?: boolean;
}
export interface OccClassification {
  code?: string;
  name?: string;
  features: OccFeature[];
}

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
  /** 상품 상세 설명 (OCC fields=FULL에서 반환) */
  description?: string;
  /** 짧은 요약 */
  summary?: string;
  /** 상품 스펙/분류 (OCC fields=FULL에서 반환) */
  classifications?: OccClassification[];
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
  galleryImages?: string[];
  description?: string;
  productUrl: string;
  brand?: string;
  averageRating?: number;
  reviewCount: number;
  stockStatus: 'inStock' | 'outOfStock' | 'lowStock';
  shippingIncluded: boolean;
  /** OCC classifications 스펙 데이터 */
  classifications?: OccClassification[];
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

  average_rating: string | null; // numeric → string (pg driver)
  review_count: number;
  stock_status: 'inStock' | 'outOfStock' | 'lowStock';
  shipping_included: boolean;

  market_lowest_price: number | null;
  market_price_source: 'manual' | 'naver_api' | 'coupang_api' | null;
  market_price_updated_at: string | null;

  /** 단위 유형: 무게/부피/개수 */
  unit_type?: 'weight' | 'volume' | 'count' | null;
  /** 총 수량 (g / ml / 개) — 마진 환산에 사용 */
  total_quantity?: number | null;
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

  // v2 입수·별표·회전 메타
  pack_qty: number;
  has_asterisk: boolean;
  expected_turnover_days: number | null;

  // v2 성별·시즌 분류
  male_tier: 'high' | 'mid' | 'neutral' | 'female' | null;
  male_bonus: number | null;
  season_bonus: number | null;
  season_labels: string | null;
  asterisk_bonus: number | null;

  // v2 차단·검토
  blocked_reason: string | null;
  needs_review: boolean;

  // v2 개별 스코어 (costco-scoring.ts 결과)
  costco_score_legal: number | null;
  costco_score_price: number | null;
  costco_score_cs: number | null;
  costco_score_margin: number | null;
  costco_score_demand: number | null;
  costco_score_turnover: number | null;
  costco_score_supply: number | null;
  costco_score_total: number | null;
  costco_score_calculated_at: string | null;

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
