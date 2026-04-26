/**
 * /api/listing/coupang/drafts/[id]/submit
 * POST — 임시저장된 draft를 Coupang OPEN API에 실제 제출
 *
 * 처리 순서:
 * 1. 인증 + 소유권 확인
 * 2. Supabase에서 draft_data 조회
 * 3. draft_data → CoupangProductPayload 구성 (기존 /api/listing/coupang POST 로직과 동일)
 * 4. getCoupangClient().registerProduct(payload) 호출
 * 5. 성공 시 draft.status='submitted', coupang_registered_products insert
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import type { CoupangProductPayload } from '@/lib/listing/coupang-client';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

// 라우트 파라미터 타입
interface RouteContext {
  params: Promise<{ id: string }>;
}

// 옵션(variant) 단일 항목 타입
interface DraftVariant {
  itemName: string;
  attributes: { attributeTypeName: string; attributeValueName: string }[];
  salePrice: number;
  originalPrice?: number;
  stock: number;
}

// draft_data 내부 구조 타입
interface DraftData {
  name?: string;
  categoryCode?: string;
  brand?: string;
  salePrice?: number;
  originalPrice?: number;
  stock?: number;
  thumbnail?: string;
  detailHtml?: string;
  deliveryMethod?: 'SEQUENCIAL' | 'VENDOR_DIRECT';
  deliveryChargeType?: 'FREE' | 'NOT_FREE';
  deliveryCharge?: number;
  returnCharge?: number;
  outboundCode?: string;
  returnCode?: string;
  notices?: { categoryName: string; detailName: string; content: string }[];
  tags?: string[];
  detailImages?: string[];
  adultOnly?: 'EVERYONE' | 'ADULTS_ONLY';
  taxType?: 'TAX' | 'TAX_FREE';
  parallelImported?: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED';
  // 상품 옵션(variant) — 있으면 각 조합마다 별도 item 생성
  variants?: DraftVariant[];
}

export async function POST(request: NextRequest, context: RouteContext) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: draftId } = await context.params;

  const supabase = getSupabaseServerClient();

  // draft 조회 + 소유권 확인
  const { data: draft, error: fetchError } = await supabase
    .from('coupang_drafts')
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

  // draft_data에서 Coupang payload 구성
  const d = (draft.draft_data ?? {}) as DraftData;

  const sellerProductName = d.name ?? (draft.product_name as string) ?? '';
  const displayCategoryCode = Number(d.categoryCode) || 0;
  const brand = d.brand ?? '';
  const salePrice = Number(d.salePrice) || 0;
  const originalPrice = Number(d.originalPrice) || salePrice;
  const deliveryCharge = Number(d.deliveryCharge) || 0;
  const returnCharge = Number(d.returnCharge) || 0;
  const detailImages = Array.isArray(d.detailImages) ? d.detailImages as string[] : [];
  const thumbnailImages = d.thumbnail ? [d.thumbnail] : [];

  if (!sellerProductName || !displayCategoryCode || !salePrice) {
    return Response.json(
      { success: false, error: '필수 필드(상품명, 카테고리 코드, 판매가)가 누락되었습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getCoupangClient();

    // 출고지/반품지 코드 (draft_data 우선 → 환경변수 fallback)
    const outboundCode = d.outboundCode || client.getOutboundShippingPlaceCode();
    const returnCenterCode = d.returnCode || client.getReturnCenterCode();

    // 상세페이지 콘텐츠 구성 (기존 route.ts와 동일 로직)
    const contents = detailImages.length > 0
      ? detailImages.map((url: string) => ({
          contentsType: 'IMAGE' as const,
          contentDetails: [{ content: url, detailType: 'IMAGE' as const }],
        }))
      : [{
          contentsType: 'TEXT' as const,
          contentDetails: [{ content: d.detailHtml ?? sellerProductName, detailType: 'TEXT' as const }],
        }];

    // 이미지 목록 (썸네일 + 상세) — 모든 item이 공유
    const itemImages = [
      ...thumbnailImages.map((url: string, i: number) => ({
        imageOrder: i,
        imageType: i === 0 ? 'REPRESENTATION' as const : 'DETAIL' as const,
        vendorPath: url,
      })),
      ...detailImages.map((url: string, i: number) => ({
        imageOrder: thumbnailImages.length + i,
        imageType: 'DETAIL' as const,
        vendorPath: url,
      })),
    ];

    // 공통 notice 목록
    const itemNotices = (d.notices ?? []).map((n) => ({
      noticeCategoryName: n.categoryName,
      noticeCategoryDetailName: n.detailName,
      content: n.content,
    }));

    // draft_data에서 읽은 상품 속성 값 (없으면 기본값)
    const adultOnly = d.adultOnly || 'EVERYONE';
    const taxType = d.taxType || 'TAX';
    const parallelImported = d.parallelImported || 'NOT_PARALLEL_IMPORTED';

    // variants가 있으면 각 조합을 별도 item으로, 없으면 단일 item(기존 동작)
    const variants = Array.isArray(d.variants) && d.variants.length > 0 ? d.variants : null;
    const items: import('@/lib/listing/coupang-client').CoupangProductItem[] = variants
      ? variants.map((v) => ({
          itemName: v.itemName,
          originalPrice: v.originalPrice ?? originalPrice,
          salePrice: v.salePrice,
          maximumBuyCount: 999,
          maximumBuyForPerson: 0,
          maximumBuyForPersonPeriod: 1,
          outboundShippingTimeDay: 3,
          unitCount: 1,
          adultOnly,
          taxType,
          overseasPurchased: 'NOT_OVERSEAS_PURCHASED',
          parallelImported,
          images: itemImages,
          attributes: v.attributes,
          contents,
          notices: itemNotices,
        }))
      : [
          {
            itemName: sellerProductName,
            originalPrice,
            salePrice,
            maximumBuyCount: 999,
            maximumBuyForPerson: 0,
            maximumBuyForPersonPeriod: 1,
            outboundShippingTimeDay: 3,
            unitCount: 1,
            adultOnly,
            taxType,
            overseasPurchased: 'NOT_OVERSEAS_PURCHASED',
            parallelImported,
            images: itemImages,
            attributes: [],
            contents,
            notices: itemNotices,
          },
        ];

    const payload: CoupangProductPayload = {
      displayCategoryCode,
      sellerProductName,
      vendorId: client.vendor,
      saleStartedAt: '1970-01-01T00:00:00',
      saleEndedAt: '2999-01-01T00:00:00',
      brand,
      generalProductName: sellerProductName,
      deliveryMethod: d.deliveryMethod ?? 'SEQUENCIAL',
      deliveryCompanyCode: 'CJGLS',
      deliveryChargeType: deliveryCharge === 0 ? 'FREE' : 'NOT_FREE',
      deliveryCharge,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: returnCharge,
      deliverySurcharge: 0,
      remoteAreaDeliverable: 'N',
      bundlePackingDelivery: 0,
      unionDeliveryType: 'NOT_UNION_DELIVERY',
      returnCenterCode,
      outboundShippingPlaceCode: outboundCode,
      returnChargeName: process.env.COUPANG_RETURN_NAME ?? '',
      companyContactNumber: process.env.COUPANG_CONTACT_NUMBER ?? '',
      returnZipCode: process.env.COUPANG_RETURN_ZIPCODE ?? '',
      returnAddress: process.env.COUPANG_RETURN_ADDRESS ?? '',
      returnAddressDetail: process.env.COUPANG_RETURN_ADDRESS_DETAIL ?? '',
      returnCharge,
      vendorUserId: process.env.COUPANG_VENDOR_USER_ID ?? '',
      items,
      searchTags: d.tags || [],
    };

    // Coupang API 실제 호출
    const result = await client.registerProduct(payload);
    const sellerProductId = result.sellerProductId;
    const wingsUrl = 'https://wing.coupang.com';

    // draft 상태 업데이트: submitted
    await supabase
      .from('coupang_drafts')
      .update({
        status: 'submitted',
        seller_product_id: sellerProductId,
        wings_url: wingsUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draftId)
      .eq('user_id', userId);

    // 등록 이력 저장 (실패해도 제출 성공에 영향 없음)
    try {
      await supabase.from('coupang_registered_products').insert({
        user_id: userId,
        seller_product_id: sellerProductId,
        seller_product_name: sellerProductName,
        source_type: 'draft',
        wings_status: 'UNDER_REVIEW',
      });
    } catch (saveErr) {
      console.warn('[POST /api/listing/coupang/drafts/[id]/submit] 이력 저장 실패 (무시됨):', saveErr);
    }

    return Response.json({ success: true, sellerProductId, wingsUrl });
  } catch (err) {
    console.error('[POST /api/listing/coupang/drafts/[id]/submit]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
