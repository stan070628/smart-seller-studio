import type { LogisticsSize } from '@/types/shortlist';

/** Claude가 네이버 캡처 한 장(조각)에서 뽑은 상품 카드 */
export interface ExtractedListing {
  row: number;
  col: number;
  title: string;
  seller: string;
  price: number;
  list_price: number | null;
  discount_pct: number | null;
  review_count: number | null;
  rating: number | null;
  badges: string[];
}

export interface ExtractedNaverPage {
  screen: 'naver_list' | 'other';
  sort_bar_seen: boolean;
  category_path: string | null;
  sort_label: string | null;
  products: ExtractedListing[];
}

/** 병합 후 저장할 한 줄 */
export interface MergedListing extends Omit<ExtractedListing, 'row' | 'col'> {
  rank: number;
  dedup_key: string;
  number_check: string | null;
}

export interface Tier { min_qty: number; cny: number }
export interface OptionPrice { name: string; cny: number | null }

export interface Extracted1688 {
  screen: '1688' | 'other';
  title_cn: string | null;
  tiers: Tier[];
  options: OptionPrice[];
  sold_count: number | null;
  sale_unit: string | null;
  match_verdict: 'same' | 'diff' | 'different';
  match_reason: string;
}

/** DB 행 (sourcing_listings + scan의 category_path) */
export interface ListingRow {
  id: string;
  scan_id: string;
  rank: number;
  title: string;
  seller: string;
  price: number;
  list_price: number | null;
  discount_pct: number | null;
  review_count: number | null;
  rating: number | null;
  badges: string[];
  number_check: string | null;
  starred: boolean;
  excluded_override: boolean | null;
  memo: string | null;
  size: LogisticsSize;
  price_override: number | null;
  category_path: string | null;
  /** 네이버 상세 페이지 별점 옆 ⓘ에서 사람이 직접 옮겨 적는다 — ⭐ 후보에만 있다 */
  recent6m_review_count: number | null;
  recent6m_rating: number | null;
}

/** DB 행 (sourcing_offers) */
export interface OfferRow {
  id: string;
  listing_id: string;
  image_paths: string[];
  url: string | null;
  title_cn: string | null;
  tiers: Tier[] | null;
  options: OptionPrice[] | null;
  sold_count: number | null;
  sale_unit: string | null;
  tier_check: string | null;
  match_verdict: 'same' | 'diff' | 'different' | null;
  match_reason: string | null;
  cny_override: number | null;
  adopted: boolean;
  parse_status: 'pending' | 'parsing' | 'parsed' | 'failed';
  parse_error: string | null;
}
