/**
 * /api/listing/coupang
 * GET  — 쿠팡 등록 상품 목록 조회
 * POST — 쿠팡 상품 등록
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// ─────────────────────────────────────────────────────────────
// GET — 판매자 상품 목록
// ─────────────────────────────────────────────────────────────

// 쿠팡 판매자 상품 status 목록
const ALL_PRODUCT_STATUSES = ['APPROVED', 'SUSPENSION', 'UNDER_REVIEW', 'REJECTED'];

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') ?? '';          // 빈 문자열 = 전체
  const maxPerPage = parseInt(sp.get('maxPerPage') ?? '50', 10);
  const nextToken = sp.get('nextToken') ?? '';

  try {
    const client = getCoupangClient();

    if (status) {
      // 특정 상태만 조회
      const result = await client.getSellerProducts(status, maxPerPage, nextToken);
      return Response.json({ success: true, data: { items: result.items, nextToken: result.nextToken } });
    }

    // 전체 상태 병렬 조회 후 합산
    const results = await Promise.allSettled(
      ALL_PRODUCT_STATUSES.map((s) => client.getSellerProducts(s, maxPerPage, ''))
    );

    const items = results.flatMap((r) => r.status === 'fulfilled' ? r.value.items : []);
    // 최신 등록순 정렬
    items.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

    return Response.json({ success: true, data: { items, nextToken: null } });
  } catch (err) {
    console.error('[GET /api/listing/coupang]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST — 상품 등록
// ─────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  displayCategoryCode: z.number().int(),
  sellerProductName: z.string().min(1).max(200),
  brand: z.string().default(''),
  salePrice: z.number().int().min(100),
  originalPrice: z.number().int().min(100).optional(),
  stock: z.number().int().min(1).default(999),
  thumbnailImages: z.array(z.string().url()).min(1).max(10),
  detailImages: z.array(z.string().url()).max(20).default([]),
  description: z.string().min(1),
  deliveryCharge: z.number().int().min(0).default(0),
  deliveryChargeType: z.enum(['FREE', 'NOT_FREE', 'CHARGE_RECEIVED']).default('FREE'),
  returnCharge: z.number().int().min(0).default(5000),
  // 선택 필드
  maximumBuyCount: z.number().int().min(1).default(999),
  maximumBuyForPerson: z.number().int().min(0).default(0),
  outboundShippingPlaceCode: z.string().optional(),
  returnCenterCode: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = RegisterSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      {
        success: false,
        error: '입력값 검증 실패',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const d = parseResult.data;

  try {
    const client = getCoupangClient();

    // 출고지/반품지 코드 (명시적 전달 → 환경변수 → 에러)
    const outboundCode = d.outboundShippingPlaceCode || client.getOutboundShippingPlaceCode();
    const returnCode = d.returnCenterCode || client.getReturnCenterCode();

    const contents = d.detailImages.length > 0
      ? d.detailImages.map((url: string) => ({
          contentsType: 'IMAGE' as const,
          contentDetails: [{ content: url, detailType: 'IMAGE' as const }],
        }))
      : [{ contentsType: 'TEXT' as const, contentDetails: [{ content: d.description || d.sellerProductName, detailType: 'TEXT' as const }] }];

    const payload: import('@/lib/listing/coupang-client').CoupangProductPayload = {
      displayCategoryCode: d.displayCategoryCode,
      sellerProductName: d.sellerProductName,
      vendorId: client.vendor,
      saleStartedAt: '1970-01-01T00:00:00',
      saleEndedAt: '2999-01-01T00:00:00',
      brand: d.brand,
      generalProductName: d.sellerProductName,
      deliveryMethod: 'SEQUENCIAL',
      deliveryCompanyCode: 'LOTTE',
      deliveryChargeType: d.deliveryCharge === 0 ? 'FREE' : 'NOT_FREE',
      deliveryCharge: d.deliveryCharge,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: d.returnCharge,
      deliverySurcharge: 0,
      remoteAreaDeliverable: 'N',
      bundlePackingDelivery: 0,
      unionDeliveryType: 'NOT_UNION_DELIVERY',
      returnCenterCode: returnCode,
      outboundShippingPlaceCode: outboundCode,
      returnChargeName: process.env.COUPANG_RETURN_NAME ?? '',
      companyContactNumber: process.env.COUPANG_CONTACT_NUMBER ?? '',
      returnZipCode: process.env.COUPANG_RETURN_ZIPCODE ?? '',
      returnAddress: process.env.COUPANG_RETURN_ADDRESS ?? '',
      returnAddressDetail: process.env.COUPANG_RETURN_ADDRESS_DETAIL ?? '',
      returnCharge: d.returnCharge,
      vendorUserId: process.env.COUPANG_VENDOR_USER_ID ?? '',
      items: [
        {
          itemName: d.sellerProductName,
          originalPrice: d.originalPrice ?? d.salePrice,
          salePrice: d.salePrice,
          maximumBuyCount: d.maximumBuyCount,
          maximumBuyForPerson: d.maximumBuyForPerson,
          maximumBuyForPersonPeriod: 1,
          outboundShippingTimeDay: 3,
          unitCount: 1,
          adultOnly: 'EVERYONE',
          taxType: 'TAX',
          overseasPurchased: 'NOT_OVERSEAS_PURCHASED',
          images: [
            ...d.thumbnailImages.map((url, i) => ({
              imageOrder: i,
              imageType: i === 0 ? 'REPRESENTATION' as const : 'DETAIL' as const,
              vendorPath: url,
            })),
            ...d.detailImages.map((url: string, i: number) => ({
              imageOrder: d.thumbnailImages.length + i,
              imageType: 'DETAIL' as const,
              vendorPath: url,
            })),
          ],
          attributes: [],
          contents,
          notices: [],
        },
      ],
    };

    const result = await client.registerProduct(payload);

    return Response.json({
      success: true,
      data: {
        sellerProductId: result.sellerProductId,
        productUrl: `https://www.coupang.com/vp/products/${result.sellerProductId}`, // productId는 등록 후 별도 조회 필요
      },
    });
  } catch (err) {
    console.error('[POST /api/listing/coupang]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
