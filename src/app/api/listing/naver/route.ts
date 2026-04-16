/**
 * /api/listing/naver
 * GET  — 네이버 등록 상품 목록 조회
 * POST — 네이버 상품 등록
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

// ─── GET — 상품 목록 ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const page = parseInt(sp.get('page') ?? '1', 10);
  const size = parseInt(sp.get('size') ?? '20', 10);
  const status = sp.get('status') ?? undefined;

  try {
    const client = getNaverCommerceClient();
    const result = await client.searchProducts(page, size, status);

    // 플랫폼 형태로 변환
    const items = result.contents.flatMap((c) =>
      c.channelProducts.map((cp) => ({
        originProductNo: c.originProductNo,
        channelProductNo: cp.channelProductNo,
        name: cp.name,
        statusType: cp.statusType,
        salePrice: cp.salePrice,
        stockQuantity: cp.stockQuantity,
        categoryName: cp.wholeCategoryName,
        categoryId: cp.categoryId,
        imageUrl: cp.representativeImage?.url ?? null,
        deliveryFee: cp.deliveryFee,
        returnFee: cp.returnFee,
        exchangeFee: cp.exchangeFee,
        tags: cp.sellerTags.map((t) => t.text),
        regDate: cp.regDate,
        modifiedDate: cp.modifiedDate,
      })),
    );

    return Response.json({
      success: true,
      data: { items, total: result.totalElements ?? items.length, page, size },
    });
  } catch (err) {
    console.error('[GET /api/listing/naver]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─── POST — 상품 등록 ────────────────────────────────────────

const RegisterSchema = z.object({
  name: z.string().min(1).max(100),
  leafCategoryId: z.string().min(1),
  salePrice: z.number().int().min(100),
  stockQuantity: z.number().int().min(0).default(999),
  thumbnailImages: z.array(z.string().url()).min(1).max(10),
  detailImages: z.array(z.string().url()).max(20).default([]),
  detailContent: z.string().min(1),
  deliveryFee: z.number().int().min(0).default(0),
  returnFee: z.number().int().min(0).default(4000),
  exchangeFee: z.number().int().min(0).default(8000),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const parseResult = RegisterSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json({
      success: false,
      error: '입력값 검증 실패',
      details: parseResult.error.flatten().fieldErrors,
    }, { status: 400 });
  }

  const d = parseResult.data;

  try {
    const client = getNaverCommerceClient();

    const payload = {
      originProduct: {
        statusType: 'SALE',
        saleType: 'NEW',
        leafCategoryId: d.leafCategoryId,
        name: d.name,
        images: {
          representativeImage: { url: d.thumbnailImages[0] },
          optionalImages: d.thumbnailImages.slice(1).map((url) => ({ url })),
        },
        detailAttribute: {
          naverShoppingSearchInfo: {
            manufacturerName: '상세페이지 참조',
          },
          afterServiceInfo: {
            afterServiceTelephoneNumber: '판매자 문의',
            afterServiceGuideContent: '판매자에게 문의해주세요.',
          },
          originAreaInfo: {
            originAreaCode: '00',
            content: '상세페이지 참조',
          },
          sellerCodeInfo: {},
          optionInfo: { simpleOptionSortType: 'CREATE' },
          minorPurchasable: true,
          seoInfo: {},
        },
        customerBenefit: {},
        salePrice: d.salePrice,
        stockQuantity: d.stockQuantity,
        deliveryInfo: {
          deliveryType: 'DELIVERY',
          deliveryAttributeType: 'NORMAL',
          deliveryCompany: 'CJGLS',
          deliveryFee: {
            deliveryFeeType: d.deliveryFee === 0 ? 'FREE' : 'PAID',
            baseFee: d.deliveryFee,
          },
          claimDeliveryInfo: {
            returnDeliveryFee: d.returnFee,
            exchangeDeliveryFee: d.exchangeFee,
          },
        },
        // detailImages가 있으면 detailContent 끝에 이미지 태그를 추가한다
        detailContent: `<div>${d.detailContent}${
          d.detailImages.length > 0
            ? d.detailImages
                .map(url => `<img src="${url}" style="width:100%;display:block;" />`)
                .join('')
            : ''
        }</div>`,
      },
      smartstoreChannelProduct: {
        naverShoppingRegistration: true,
        channelProductDisplayStatusType: 'ON',
      },
    };

    // 태그 추가
    if (d.tags && d.tags.length > 0) {
      (payload.originProduct.detailAttribute as Record<string, unknown>).sellerTags =
        d.tags.map((text) => ({ text }));
    }

    const result = await client.registerProduct(payload);

    return Response.json({
      success: true,
      data: {
        originProductNo: result.originProductNo,
        channelProductNo: result.smartstoreChannelProductNo,
      },
    });
  } catch (err) {
    console.error('[POST /api/listing/naver]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
