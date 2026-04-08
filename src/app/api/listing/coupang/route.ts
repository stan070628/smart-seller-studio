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

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') ?? 'APPROVED';
  const maxPerPage = parseInt(sp.get('maxPerPage') ?? '20', 10);
  const nextToken = sp.get('nextToken') ?? '';

  try {
    const client = getCoupangClient();
    const result = await client.getSellerProducts(status, maxPerPage, nextToken);

    return Response.json({
      success: true,
      data: {
        items: result.items,
        nextToken: result.nextToken,
      },
    });
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
  images: z.array(z.string().url()).min(1).max(10),
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

    // 출고지/반품지 코드 조회 (미지정 시 자동 조회)
    let outboundCode = d.outboundShippingPlaceCode ?? '';
    let returnCode = d.returnCenterCode ?? '';

    if (!outboundCode || !returnCode) {
      const [outbound, returns] = await Promise.all([
        client.getOutboundShippingPlaces(),
        client.getReturnShippingCenters(),
      ]);

      if (!outboundCode && outbound.length > 0) {
        outboundCode = String((outbound[0] as Record<string, unknown>).outboundShippingPlaceCode ?? '');
      }
      if (!returnCode && returns.length > 0) {
        returnCode = String((returns[0] as Record<string, unknown>).returnCenterCode ?? '');
      }
    }

    const payload = {
      displayCategoryCode: d.displayCategoryCode,
      sellerProductName: d.sellerProductName,
      vendorId: client.vendor,
      saleStartedAt: new Date().toISOString().slice(0, 19),
      saleEndedAt: '2099-12-31T23:59:59',
      brand: d.brand,
      generalProductName: d.sellerProductName,
      deliveryInfo: {
        deliveryType: 'NORMAL',
        deliveryAttributeType: 'NORMAL',
        deliveryCompanyCode: 'CJGLS',
        deliveryChargeType: d.deliveryChargeType,
        deliveryCharge: d.deliveryCharge,
        freeShipOverAmount: 0,
        deliveryChargeOnReturn: d.returnCharge,
        returnCenterCode: returnCode,
        outboundShippingPlaceCode: outboundCode,
      },
      returnCharge: d.returnCharge,
      items: [
        {
          itemName: d.sellerProductName,
          originalPrice: d.originalPrice ?? d.salePrice,
          salePrice: d.salePrice,
          maximumBuyCount: d.maximumBuyCount,
          maximumBuyForPerson: d.maximumBuyForPerson,
          unitCount: 1,
          images: d.images.map((url, i) => ({
            imageOrder: i,
            imageType: i === 0 ? 'REPRESENTATIVE' : 'DETAIL',
            vendorPath: url,
          })),
          attributes: [],
          contents: [
            {
              contentsType: 'HTML',
              contentDetails: [
                { content: d.description, detailType: 'HTML' },
              ],
            },
          ],
          notices: [
            {
              noticeCategoryName: '기타 재화',
              noticeCategoryDetailName: '품명 및 모델명',
              content: d.sellerProductName,
            },
            {
              noticeCategoryName: '기타 재화',
              noticeCategoryDetailName: '제조국(원산지)',
              content: '상세페이지 참조',
            },
            {
              noticeCategoryName: '기타 재화',
              noticeCategoryDetailName: '법에 의한 인증·허가 등을 받았음을 확인할 수 있는 경우 그에 대한 사항',
              content: '해당사항 없음',
            },
            {
              noticeCategoryName: '기타 재화',
              noticeCategoryDetailName: 'A/S 책임자와 전화번호',
              content: '판매자 문의',
            },
          ],
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
