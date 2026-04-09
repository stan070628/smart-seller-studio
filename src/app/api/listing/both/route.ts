/**
 * /api/listing/both
 * POST — 쿠팡 + 네이버 동시 상품 등록
 *
 * Promise.allSettled 로 두 플랫폼을 병렬 호출하며,
 * 한 쪽 실패가 다른 쪽에 영향을 주지 않는다.
 * 부분 성공 포함 항상 HTTP 200을 반환한다.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import {
  buildCoupangPayload,
  buildNaverPayload,
  type CommonProductInput,
  type CoupangSpecificInput,
  type NaverSpecificInput,
} from '@/lib/listing/payload-mappers';

// ─────────────────────────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────────────────────────

const BothRegisterSchema = z.object({
  // 공통 필드
  name: z.string().min(1).max(100),
  salePrice: z.number().int().min(100),
  originalPrice: z.number().int().min(100).optional(),
  stock: z.number().int().min(1).default(999),
  thumbnailImages: z.array(z.string().url()).min(1).max(10),
  detailImages: z.array(z.string().url()).max(20).default([]),
  description: z.string().min(1),
  deliveryCharge: z.number().int().min(0).default(0),
  deliveryChargeType: z.enum(['FREE', 'NOT_FREE', 'CHARGE_RECEIVED']).default('FREE'),
  returnCharge: z.number().int().min(0).default(5000),
  // 쿠팡 전용 필드
  coupang: z.object({
    displayCategoryCode: z.number().int(),
    brand: z.string().default(''),
    maximumBuyCount: z.number().int().min(1).default(999),
    maximumBuyForPerson: z.number().int().min(0).default(0),
    outboundShippingPlaceCode: z.string().optional(),
    returnCenterCode: z.string().optional(),
  }),
  // 네이버 전용 필드
  naver: z.object({
    leafCategoryId: z.string().min(1),
    tags: z.array(z.string()).optional(),
    exchangeFee: z.number().int().min(0).default(8000),
    returnFee: z.number().int().min(0).optional(),
  }),
});

type BothRegisterInput = z.infer<typeof BothRegisterSchema>;

// ─────────────────────────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────────────────────────

interface CoupangResult {
  success: boolean;
  sellerProductId?: number;
  error?: string;
}

interface NaverResult {
  success: boolean;
  originProductNo?: number;
  channelProductNo?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// 쿠팡 등록 처리
// ─────────────────────────────────────────────────────────────

async function registerCoupang(d: BothRegisterInput): Promise<CoupangResult> {
  const client = getCoupangClient();

  // 출고지/반품지 코드 조회 (미지정 시 자동 조회)
  let outboundCode = d.coupang.outboundShippingPlaceCode ?? '';
  let returnCode = d.coupang.returnCenterCode ?? '';

  if (!outboundCode || !returnCode) {
    const [outbound, returns] = await Promise.all([
      client.getOutboundShippingPlaces(),
      client.getReturnShippingCenters(),
    ]);

    if (!outboundCode && outbound.length > 0) {
      outboundCode = String(
        (outbound[0] as Record<string, unknown>).outboundShippingPlaceCode ?? '',
      );
    }
    if (!returnCode && returns.length > 0) {
      returnCode = String(
        (returns[0] as Record<string, unknown>).returnCenterCode ?? '',
      );
    }
  }

  const common: CommonProductInput = {
    name: d.name,
    salePrice: d.salePrice,
    originalPrice: d.originalPrice,
    stock: d.stock,
    thumbnailImages: d.thumbnailImages,
    detailImages: d.detailImages,
    description: d.description,
    deliveryCharge: d.deliveryCharge,
    deliveryChargeType: d.deliveryChargeType,
    returnCharge: d.returnCharge,
  };

  const specific: CoupangSpecificInput = {
    displayCategoryCode: d.coupang.displayCategoryCode,
    brand: d.coupang.brand,
    maximumBuyCount: d.coupang.maximumBuyCount,
    maximumBuyForPerson: d.coupang.maximumBuyForPerson,
    outboundShippingPlaceCode: outboundCode,
    returnCenterCode: returnCode,
  };

  const payload = buildCoupangPayload(common, specific, client.vendor);
  const result = await client.registerProduct(payload);

  return { success: true, sellerProductId: result.sellerProductId };
}

// ─────────────────────────────────────────────────────────────
// 네이버 등록 처리
// ─────────────────────────────────────────────────────────────

async function registerNaver(d: BothRegisterInput): Promise<NaverResult> {
  const client = getNaverCommerceClient();

  const common: CommonProductInput = {
    name: d.name,
    salePrice: d.salePrice,
    originalPrice: d.originalPrice,
    stock: d.stock,
    thumbnailImages: d.thumbnailImages,
    detailImages: d.detailImages,
    description: d.description,
    deliveryCharge: d.deliveryCharge,
    deliveryChargeType: d.deliveryChargeType,
    returnCharge: d.returnCharge,
  };

  const specific: NaverSpecificInput = {
    leafCategoryId: d.naver.leafCategoryId,
    tags: d.naver.tags,
    exchangeFee: d.naver.exchangeFee,
    returnFee: d.naver.returnFee,
  };

  const payload = buildNaverPayload(common, specific);
  const result = await client.registerProduct(payload);

  return {
    success: true,
    originProductNo: result.originProductNo,
    channelProductNo: result.smartstoreChannelProductNo,
  };
}

// ─────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 요청 바디 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  // 입력값 검증
  const parseResult = BothRegisterSchema.safeParse(rawBody);
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

  // 두 플랫폼 병렬 등록 (한 쪽 실패가 다른 쪽에 영향 없음)
  const [coupangSettled, naverSettled] = await Promise.allSettled([
    registerCoupang(d),
    registerNaver(d),
  ]);

  const coupangResult: CoupangResult =
    coupangSettled.status === 'fulfilled'
      ? coupangSettled.value
      : {
          success: false,
          error:
            coupangSettled.reason instanceof Error
              ? coupangSettled.reason.message
              : '알 수 없는 오류',
        };

  const naverResult: NaverResult =
    naverSettled.status === 'fulfilled'
      ? naverSettled.value
      : {
          success: false,
          error:
            naverSettled.reason instanceof Error
              ? naverSettled.reason.message
              : '알 수 없는 오류',
        };

  if (coupangResult.success === false) {
    console.error('[POST /api/listing/both] 쿠팡 등록 실패:', coupangResult.error);
  }
  if (naverResult.success === false) {
    console.error('[POST /api/listing/both] 네이버 등록 실패:', naverResult.error);
  }

  const totalSucceeded = [coupangResult, naverResult].filter((r) => r.success).length;
  const totalFailed = 2 - totalSucceeded;

  // 부분 성공 포함 항상 200 반환
  return Response.json({
    success: true,
    data: {
      coupang: coupangResult,
      naver: naverResult,
      summary: {
        totalSucceeded,
        totalFailed,
      },
    },
  });
}
