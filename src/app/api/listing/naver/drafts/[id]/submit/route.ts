/**
 * /api/listing/naver/drafts/[id]/submit
 * POST — 임시저장된 draft를 네이버 스마트스토어 OPEN API에 실제 제출
 *
 * 처리 순서:
 * 1. 인증 + 소유권 확인
 * 2. Supabase에서 draft_data 조회
 * 3. 필수 필드 검증
 * 4. thumbnailImages → 네이버 CDN 업로드
 * 5. buildNaverPayload → registerProduct 호출
 * 6. 성공 시 draft.status='submitted', 등록 번호 저장
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { buildNaverPayload } from '@/lib/listing/payload-mappers';
import type { CommonProductInput, NaverSpecificInput } from '@/lib/listing/payload-mappers';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface NaverDraftData {
  name?: string;
  leafCategoryId?: string;
  leafCategoryPath?: string;
  salePrice?: number;
  stock?: number;
  thumbnailImages?: string[];
  detailHtml?: string;
  tags?: string[];
  deliveryCharge?: number;
  returnCharge?: number;
  exchangeFee?: number;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const supabase = getSupabaseServerClient();

  const { data: draft, error: fetchError } = await supabase
    .from('naver_drafts')
    .select('id, user_id, product_name, draft_data, status')
    .eq('id', draftId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !draft) {
    return Response.json(
      { success: false, error: '해당 draft를 찾을 수 없거나 접근 권한이 없습니다.' },
      { status: 404 },
    );
  }

  if ((draft.status as string) === 'submitted') {
    return Response.json(
      { success: false, error: '이미 제출된 draft입니다.' },
      { status: 409 },
    );
  }

  const d = (draft.draft_data ?? {}) as NaverDraftData;

  const name = d.name ?? (draft.product_name as string) ?? '';
  const leafCategoryId = d.leafCategoryId ?? '';
  const salePrice = Number(d.salePrice) || 0;
  const stock = Number(d.stock) || 999;
  const thumbnailImages = Array.isArray(d.thumbnailImages) ? d.thumbnailImages.filter(Boolean) : [];
  const detailHtml = d.detailHtml ?? name;
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const deliveryCharge = Number(d.deliveryCharge) ?? 0;
  const returnCharge = Number(d.returnCharge) || 4000;
  const exchangeFee = Number(d.exchangeFee) || returnCharge * 2;

  if (!name || !leafCategoryId || !salePrice) {
    return Response.json(
      { success: false, error: '필수 필드(상품명, 카테고리, 판매가)가 누락되었습니다.' },
      { status: 400 },
    );
  }

  if (thumbnailImages.length === 0) {
    return Response.json(
      { success: false, error: '대표이미지가 없습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getNaverCommerceClient();

    // 네이버는 외부 URL 직접 사용 불가 — 네이버 CDN에 업로드 필요
    console.log('[submit] 네이버 이미지 업로드 시작:', thumbnailImages.length, '장');
    const naverThumbnails = await client.uploadImagesFromUrls(thumbnailImages);

    if (naverThumbnails.length === 0) {
      return Response.json(
        { success: false, error: '네이버 이미지 업로드에 모두 실패했습니다.' },
        { status: 422 },
      );
    }

    const common: CommonProductInput = {
      name,
      salePrice,
      stock,
      thumbnailImages: naverThumbnails,
      detailImages: [],
      description: detailHtml,
      deliveryCharge,
      deliveryChargeType: deliveryCharge === 0 ? 'FREE' : 'NOT_FREE',
      returnCharge,
    };

    const specific: NaverSpecificInput = {
      leafCategoryId,
      tags,
      exchangeFee,
      returnFee: returnCharge,
    };

    const payload = buildNaverPayload(common, specific);
    console.log('[submit] 네이버 상품 등록 요청...');
    const result = await client.registerProduct(payload);

    const originProductNo = result.originProductNo;
    const channelProductNo = result.smartstoreChannelProductNo;
    const smartstoreUrl = `https://smartstore.naver.com/home/product/${channelProductNo}`;

    await supabase
      .from('naver_drafts')
      .update({
        status: 'submitted',
        naver_origin_product_no: originProductNo,
        naver_channel_product_no: channelProductNo,
        smartstore_url: smartstoreUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId)
      .eq('user_id', userId);

    return Response.json({ success: true, originProductNo, channelProductNo, smartstoreUrl });
  } catch (err) {
    console.error('[POST /api/listing/naver/drafts/[id]/submit]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
