/**
 * /api/listing/coupang/[id]/approve
 * POST — 쿠팡 상품 판매 승인 요청
 *
 * 등록 직후 상태는 SAVED(임시저장)이며 승인 요청 없이는 판매가 시작되지 않는다.
 * 상세설명을 수정하면 승인완료 상품도 임시저장으로 되돌아가므로 다시 요청해야 한다.
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { id } = await context.params;
  const sellerProductId = Number.parseInt(id, 10);

  if (Number.isNaN(sellerProductId) || sellerProductId <= 0) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  const client = getCoupangClient();

  try {
    await client.requestApproval(sellerProductId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[POST /api/listing/coupang/[id]/approve] 승인 요청 실패:', message);
    return Response.json({ success: false, error: message }, { status: 502 });
  }

  // 승인 요청 직후 상태를 함께 돌려준다. 쿠팡은 반영에 지연이 있어 SAVED로 보일 수 있다.
  let statusName: string | undefined;
  try {
    const detail = (await client.getProductDetail(sellerProductId)) as { statusName?: string };
    statusName = detail?.statusName;
  } catch {
    // 상태 조회 실패는 승인 요청 자체의 성공을 무효화하지 않는다.
  }

  return Response.json({ success: true, data: { sellerProductId, statusName } });
}
