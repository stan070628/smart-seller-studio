/**
 * 등록 상품 수 집계.
 * - 쿠팡: coupang_registered_products 테이블 (deleted_at IS NULL)
 * - 네이버: naver-commerce-client.searchProducts 첫 페이지의 totalElements
 */
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

export async function countCoupangProducts(userId: string): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase
    .from('coupang_registered_products')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    console.warn('[dashboard] 쿠팡 상품 수 조회 실패:', error.message);
    return 0;
  }
  return count ?? 0;
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
