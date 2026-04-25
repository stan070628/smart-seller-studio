/**
 * /api/listing/coupang/[id]
 * GET    — 쿠팡 상품 상세 조회
 * PUT    — 쿠팡 상품 수정
 * DELETE — 쿠팡 상품 삭제 + 등록 이력 soft delete
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── DELETE — 상품 삭제 ───────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id } = await context.params;
  const sellerProductId = parseInt(id, 10);

  if (isNaN(sellerProductId) || sellerProductId <= 0) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    await client.deleteProduct(sellerProductId);
  } catch (err) {
    console.error(`[DELETE /api/listing/coupang/${id}]`, err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }

  // 등록 이력 soft delete (본인 데이터만)
  try {
    const supabase = getSupabaseServerClient();
    await supabase
      .from('coupang_registered_products')
      .update({
        deleted_at: new Date().toISOString(),
        wings_status: 'DELETED',
      })
      .eq('seller_product_id', sellerProductId)
      .eq('user_id', userId)
      .is('deleted_at', null);
  } catch (saveErr) {
    console.warn(`[DELETE /api/listing/coupang/${id}] Supabase 업데이트 실패 (무시됨):`, saveErr);
  }

  return Response.json({ success: true });
}

// ─── GET — 상세 조회 ─────────────────────────────────────────

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const sellerProductId = parseInt(id, 10);

  if (isNaN(sellerProductId)) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const data = await client.getProductDetail(sellerProductId);

    return Response.json({ success: true, data });
  } catch (err) {
    console.error(`[GET /api/listing/coupang/${id}]`, err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── PUT — 수정 ──────────────────────────────────────────────

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const sellerProductId = parseInt(id, 10);

  if (isNaN(sellerProductId)) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const result = await client.updateProduct(sellerProductId, body as Parameters<typeof client.updateProduct>[1]);

    return Response.json({ success: true, data: result });
  } catch (err) {
    console.error(`[PUT /api/listing/coupang/${id}]`, err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
