/**
 * 경쟁 상품 자동 수집기
 *
 * 수집 전략:
 *   1. 네이버 쇼핑 API 매칭 → 가격, 검색 순위 (가장 안정적)
 *   2. 상품 페이지 스크래핑 → 리뷰수, 평점 (product_url 있는 경우)
 *   3. 이전 스냅샷 대비 review_delta 계산
 *
 * input_method='auto' 로 저장하여 수동 입력과 구분
 */

import type { NaverShoppingItem } from '@/types/niche';
import { getNaverShoppingClient } from '@/lib/niche/naver-shopping';

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface TrackedCompetitor {
  id: string;
  keyword: string;
  platform: string;
  productName: string;
  productUrl: string | null;
  productId: string | null;
}

export interface CollectedSnapshot {
  competitorId: string;
  keyword: string;
  platform: string;
  price?: number;
  reviewCount?: number;
  rating?: number;
  salesCount?: number;
  rankPosition?: number;
}

export interface CollectResult {
  collected: number;
  skipped: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

const SCRAPE_TIMEOUT = 8_000;
const API_DELAY = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// 1. 네이버 쇼핑 API 기반 매칭
// ─────────────────────────────────────────────────────────────

/** HTML 태그 제거 (네이버 API 응답 title에 <b> 포함) */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

/** 두 문자열의 유사도 (0~1). 공백/특수문자 제거 후 포함 관계 확인 */
function similarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^가-힣a-z0-9]/g, '')
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // 공통 글자 비율
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  let match = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) match++;
  }
  return match / longer.length;
}

/**
 * 네이버 쇼핑 API 검색 결과에서 추적 중인 경쟁 상품을 매칭하여
 * 가격과 검색 순위를 추출한다.
 */
export async function matchFromNaverAPI(
  keyword: string,
  competitors: TrackedCompetitor[],
): Promise<Map<string, Partial<CollectedSnapshot>>> {
  const result = new Map<string, Partial<CollectedSnapshot>>();

  try {
    const client = getNaverShoppingClient();
    const { items } = await client.searchShopping(keyword, 100);

    for (const comp of competitors) {
      let bestMatch: NaverShoppingItem | null = null;
      let bestScore = 0;
      let bestRank = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const title = stripHtml(item.title);

        // productId 일치 시 완벽 매칭
        if (comp.productId && item.productId === comp.productId) {
          bestMatch = item;
          bestRank = i + 1;
          bestScore = 1;
          break;
        }

        // 상품명 유사도 매칭
        const score = similarity(comp.productName, title);
        if (score > bestScore && score >= 0.6) {
          bestMatch = item;
          bestScore = score;
          bestRank = i + 1;
        }
      }

      if (bestMatch) {
        const price = parseInt(bestMatch.lprice, 10);
        result.set(comp.id, {
          competitorId: comp.id,
          keyword,
          platform: comp.platform,
          price: isNaN(price) ? undefined : price,
          rankPosition: bestRank,
        });
      }
    }
  } catch (err) {
    console.error(`[competitor-collector] 네이버 API 매칭 실패 (${keyword}):`, err);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// 2. 상품 페이지 스크래핑
// ─────────────────────────────────────────────────────────────

interface ScrapedData {
  price?: number;
  reviewCount?: number;
  rating?: number;
  salesCount?: number;
}

/** 쿠팡 상품 페이지에서 데이터 추출 */
function parseCoupangHtml(html: string): ScrapedData {
  const data: ScrapedData = {};

  // 가격: <meta property="product:price:amount" content="...">
  // 또는 class="total-price" 내부
  const metaPrice = html.match(/product:price:amount["'\s]*content=["'](\d+)/);
  if (metaPrice) {
    data.price = parseInt(metaPrice[1], 10);
  } else {
    const priceMatch = html.match(/total-price[^>]*>[\s\S]*?([\d,]+)\s*원/);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  }

  // 리뷰수: "상품평 (1,234)" 또는 "count" class
  const reviewPatterns = [
    /상품평\s*\(?\s*([\d,]+)\s*\)?/,
    /(?:리뷰|후기)\s*[^\d]*([\d,]+)\s*개/,
    /count[^>]*>\s*\(?\s*([\d,]+)\s*\)?/,
    /rating-total-count[^>]*>\s*\(?\s*([\d,]+)\s*\)?/,
  ];
  for (const pat of reviewPatterns) {
    const m = html.match(pat);
    if (m) {
      data.reviewCount = parseInt(m[1].replace(/,/g, ''), 10);
      break;
    }
  }

  // 평점: "4.5" 패턴
  const ratingPatterns = [
    /rating-star-num[^>]*>[\s\S]*?([\d.]+)/,
    /star-rating[^>]*>\s*([\d.]+)/,
    /ratingValue["'\s:]*["']?([\d.]+)/,
  ];
  for (const pat of ratingPatterns) {
    const m = html.match(pat);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 5) {
        data.rating = Math.round(v * 10) / 10;
        break;
      }
    }
  }

  // 판매량: "3,456개 구매중" 또는 "XX만개 구매" 패턴
  const salesPatterns = [
    /([\d,]+)\s*개\s*구매/,
    /([\d.]+)\s*만\s*개?\s*구매/,
  ];
  const m1 = html.match(salesPatterns[0]);
  const m2 = html.match(salesPatterns[1]);
  if (m1) {
    data.salesCount = parseInt(m1[1].replace(/,/g, ''), 10);
  } else if (m2) {
    data.salesCount = Math.round(parseFloat(m2[1]) * 10000);
  }

  return data;
}

/** 네이버 스마트스토어 / 쇼핑 상품 페이지에서 데이터 추출 */
function parseNaverHtml(html: string): ScrapedData {
  const data: ScrapedData = {};

  // JSON-LD 또는 meta 태그에서 가격
  const pricePatterns = [
    /product:price:amount["'\s]*content=["'](\d+)/,
    /"price"\s*:\s*["']?(\d+)/,
    /totalPrice[^>]*>([\d,]+)/,
  ];
  for (const pat of pricePatterns) {
    const m = html.match(pat);
    if (m) {
      data.price = parseInt(m[1].replace(/,/g, ''), 10);
      break;
    }
  }

  // 리뷰수
  const reviewPatterns = [
    /리뷰\s*([\d,]+)/,
    /reviewCount["'\s:]*["']?(\d+)/,
    /totalReviewCount["'\s:]*["']?(\d+)/,
  ];
  for (const pat of reviewPatterns) {
    const m = html.match(pat);
    if (m) {
      data.reviewCount = parseInt(m[1].replace(/,/g, ''), 10);
      break;
    }
  }

  // 평점
  const ratingMatch = html.match(/scoreAvg["'\s:]*["']?([\d.]+)/);
  if (ratingMatch) {
    const v = parseFloat(ratingMatch[1]);
    if (v > 0 && v <= 5) data.rating = Math.round(v * 10) / 10;
  }

  // 구매건수
  const salesMatch = html.match(/구매건수\s*([\d,]+)/);
  if (salesMatch) {
    data.salesCount = parseInt(salesMatch[1].replace(/,/g, ''), 10);
  }

  return data;
}

/**
 * 상품 URL로부터 데이터를 스크래핑한다.
 * 실패 시 빈 객체를 반환하여 전체 수집 흐름을 막지 않는다.
 */
export async function scrapeProductPage(
  url: string,
  platform: string,
): Promise<ScrapedData> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT),
    });

    if (!res.ok) {
      console.warn(`[scraper] HTTP ${res.status} — ${url}`);
      return {};
    }

    const html = await res.text();

    if (platform === 'coupang') return parseCoupangHtml(html);
    if (platform === 'naver') return parseNaverHtml(html);

    // 기타 플랫폼: 공통 패턴 시도
    return {
      ...parseCoupangHtml(html),
      ...parseNaverHtml(html),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scraper] 스크래핑 실패 (${platform}): ${msg}`);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 3. 통합 수집 파이프라인
// ─────────────────────────────────────────────────────────────

/**
 * 키워드에 속한 추적 경쟁 상품들의 데이터를 자동 수집한다.
 *
 * 수집 순서:
 *   1. 네이버 쇼핑 API 검색 → 가격 + 순위 매칭
 *   2. product_url이 있는 상품 → 페이지 스크래핑 → 리뷰/평점/판매량
 *   3. 두 소스 병합 (스크래핑 결과 우선, API 결과로 보완)
 */
export async function collectForKeyword(
  keyword: string,
  competitors: TrackedCompetitor[],
): Promise<CollectedSnapshot[]> {
  // 1) 네이버 API 매칭
  const apiData = await matchFromNaverAPI(keyword, competitors);

  // 2) 상품 페이지 스크래핑
  const snapshots: CollectedSnapshot[] = [];

  for (const comp of competitors) {
    const apiMatch = apiData.get(comp.id) ?? {};
    let scraped: ScrapedData = {};

    if (comp.productUrl) {
      scraped = await scrapeProductPage(comp.productUrl, comp.platform);
      await sleep(API_DELAY); // 스크래핑 간 딜레이
    }

    // 병합: 스크래핑 값 우선, 없으면 API 값으로 보완
    const merged: CollectedSnapshot = {
      competitorId: comp.id,
      keyword,
      platform: comp.platform,
      price: scraped.price ?? apiMatch.price,
      reviewCount: scraped.reviewCount,
      rating: scraped.rating,
      salesCount: scraped.salesCount,
      rankPosition: apiMatch.rankPosition,
    };

    // 의미 있는 데이터가 하나라도 있어야 저장
    const hasData =
      merged.price !== undefined ||
      merged.reviewCount !== undefined ||
      merged.rating !== undefined ||
      merged.salesCount !== undefined ||
      merged.rankPosition !== undefined;

    if (hasData) {
      snapshots.push(merged);
    }
  }

  return snapshots;
}
