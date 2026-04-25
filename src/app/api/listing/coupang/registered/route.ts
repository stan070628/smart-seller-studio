/**
 * /api/listing/coupang/registered
 * GET — 현재 사용자의 쿠팡 등록 이력 조회 (삭제되지 않은 항목, 최신순 20개)
 */

import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

export async function GET(request: NextRequest) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('coupang_registered_products')
      .select('seller_product_id, seller_product_name, source_type, wings_status, created_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    const items = (data ?? []).map((row) => ({
      sellerProductId: row.seller_product_id as number,
      sellerProductName: row.seller_product_name as string,
      sourceType: row.source_type as string,
      wingsStatus: row.wings_status as string,
      createdAt: row.created_at as string,
    }));

    return Response.json({ items });
  } catch (err) {
    console.error('[GET /api/listing/coupang/registered]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
