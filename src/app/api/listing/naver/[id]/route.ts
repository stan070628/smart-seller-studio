/**
 * /api/listing/naver/[id]
 * GET — 네이버 상품 상세 조회
 * PUT — 네이버 상품 수정
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const originProductNo = parseInt(id, 10);
  if (isNaN(originProductNo)) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  try {
    const client = getNaverCommerceClient();
    const data = await client.getProductDetail(originProductNo);
    return Response.json({ success: true, data });
  } catch (err) {
    console.error(`[GET /api/listing/naver/${id}]`, err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const originProductNo = parseInt(id, 10);
  if (isNaN(originProductNo)) {
    return Response.json({ success: false, error: '유효하지 않은 상품 ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  try {
    const client = getNaverCommerceClient();
    const result = await client.updateProduct(originProductNo, body as Record<string, unknown>);
    return Response.json({ success: true, data: result });
  } catch (err) {
    console.error(`[PUT /api/listing/naver/${id}]`, err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
