/**
 * 등록 상품 수 집계.
 * - 쿠팡: Wing seller-products API (전체 카탈로그 페이징 합산, 최대 5000개 cap)
 * - 네이버: naver-commerce-client.searchProducts 첫 페이지의 totalElements
 */
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

const COUPANG_PAGE_SIZE = 100;
const COUPANG_MAX_PAGES = 50; // 안전 상한 5000개

export async function countCoupangProducts(_userId: string): Promise<number> {
  try {
    const client = getCoupangClient();
    let total = 0;
    let nextToken: string = '';
    for (let page = 0; page < COUPANG_MAX_PAGES; page++) {
      const result = await client.getSellerProducts('APPROVED', COUPANG_PAGE_SIZE, nextToken);
      total += result.items.length;
      if (!result.nextToken) break;
      nextToken = result.nextToken;
    }
    return total;
  } catch (err) {
    console.warn('[dashboard] 쿠팡 상품 수 조회 실패:', err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function countNaverProducts(): Promise<number> {
  try {
    const client = getNaverCommerceClient();
    const result = await client.searchProducts(1, 1);
    // searchProducts 응답 형태: { contents: [], totalElements: number, ... }
    const total = (result as { totalElements?: number }).totalElements;
    return typeof total === 'number' ? total : 0;
  } catch (err) {
    console.warn('[dashboard] 네이버 상품 수 조회 실패:', err instanceof Error ? err.message : err);
    return 0;
  }
}
