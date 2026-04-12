/**
 * /api/listing/coupang/[id]
 * GET — 쿠팡 상품 상세 조회
 * PUT — 쿠팡 상품 수정
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

interface RouteContext {
  params: Promise<{ id: string }>;
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
