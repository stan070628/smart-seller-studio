/**
 * 네이버 쇼핑 검색 결과 집계
 * NaverShoppingItem[] → NicheScoreInput 변환
 */

import type { NaverShoppingItem, NicheScoreInput } from '@/types/niche';
import {
  detectLargeSizeKeyword,
  detectBulkyCategory,
  detectOfficialStoreRatio,
} from './keyword-signals';

/**
 * lprice 문자열을 정수로 변환한다.
 * 빈 문자열이나 파싱 불가 값은 0을 반환한다.
 */
function parseLprice(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 숫자 배열의 중앙값을 반환한다.
 * 빈 배열이면 0을 반환한다.
 */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 네이버 쇼핑 검색 결과를 NicheScoreInput으로 변환한다.
 *
 * @param keyword     분석 대상 검색 키워드
 * @param totalCount  API 응답의 total (전체 상품 수)
 * @param items       API 응답의 items 배열 (최대 100건 샘플)
 */
export function aggregateShoppingData(
  keyword: string,
  totalCount: number,
  items: NaverShoppingItem[],
): NicheScoreInput {
  // ── 가격 집계 ──────────────────────────────────────────────
  const prices = items
    .map((item) => parseLprice(item.lprice))
    .filter((p) => p > 0);

  const sortedPrices = [...prices].sort((a, b) => a - b);

  const avgPrice =
    prices.length > 0
      ? prices.reduce((sum, p) => sum + p, 0) / prices.length
      : 0;

  const medianPrice = median(sortedPrices);

  // ── 판매자 집계 ────────────────────────────────────────────
  // mallName 기준으로 판매자별 상품 수를 집계
  const sellerCountMap = new Map<string, number>();
  for (const item of items) {
    const name = item.mallName;
    sellerCountMap.set(name, (sellerCountMap.get(name) ?? 0) + 1);
  }

  const uniqueSellerCount = sellerCountMap.size;

  // 상품 수 내림차순 정렬 후 상위 3 판매자의 합계
  const sortedSellerCounts = [...sellerCountMap.values()].sort((a, b) => b - a);
  const top3SellerProductCount = sortedSellerCounts
    .slice(0, 3)
    .reduce((sum, c) => sum + c, 0);

  // ── 브랜드 집계 ────────────────────────────────────────────
  const brandProductCount = items.filter(
    (item) => item.brand !== null && item.brand !== undefined && item.brand.trim() !== '',
  ).length;

  // ── 키워드 시그널 감지 ─────────────────────────────────────
  const titles = items.map((item) => item.title);
  const hasLargeSizeKeyword = detectLargeSizeKeyword(keyword, titles);

  // category1~4를 모두 수집하여 대형 카테고리 감지
  const allCategories = items.flatMap((item) => [
    item.category1,
    item.category2,
    item.category3,
    item.category4,
  ]);
  const hasBulkyCategory = detectBulkyCategory(allCategories);

  // mallName 전체에서 공식스토어 비율 계산
  const mallNames = items.map((item) => item.mallName);
  const officialStoreBrandRatio = detectOfficialStoreRatio(mallNames);

  return {
    keyword,
    totalProductCount: totalCount,
    avgPrice,
    medianPrice,
    uniqueSellerCount,
    sampleSize: items.length,
    brandProductCount,
    top3SellerProductCount,
    hasLargeSizeKeyword,
    hasBulkyCategory,
    officialStoreBrandRatio,
  };
}
