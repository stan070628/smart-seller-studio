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
  type OptionsInput,
} from '@/lib/listing/payload-mappers';

// ─────────────────────────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────────────────────────

const BothRegisterSchema = z.object({
  // 공통 필드
  name: z.string().min(1).max(100),
  salePrice: z.number().int().min(100),
  naverPrice: z.number().int().min(100).optional(),   // 네이버 전용 판매가 (미입력 시 salePrice 사용)
  coupangPrice: z.number().int().min(100).optional(), // 쿠팡 전용 판매가 (미입력 시 salePrice 사용)
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
  // 미리보기 모드 — true면 실제 등록하지 않고 payload만 반환
  preview: z.boolean().optional().default(false),
  // 옵션(variants) — 없으면 단일 상품으로 등록
  options: z
    .object({
      groups: z.array(
        z.object({
          groupName: z.string().min(1),
          values: z.array(z.string()),
        }),
      ),
      variants: z.array(
        z.object({
          optionValues: z.array(z.string()),
          sourceHash: z.string().nullable(),
          costPrice: z.number(),
          salePrices: z.object({
            coupang: z.number().int().min(100),
            naver: z.number().int().min(100),
          }),
          stock: z.number().int().min(0),
          enabled: z.boolean(),
        }),
      ),
    })
    .optional(),
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

async function registerCoupang(
  d: BothRegisterInput,
  options?: OptionsInput,
): Promise<CoupangResult> {
  const client = getCoupangClient();

  // 출고지/반품지 코드 (명시적 전달 → 환경변수 → 에러)
  const outboundCode = d.coupang.outboundShippingPlaceCode || client.getOutboundShippingPlaceCode();
  const returnCode = d.coupang.returnCenterCode || client.getReturnCenterCode();

  const common: CommonProductInput = {
    name: d.name,
    // coupangPrice 입력 시 우선 사용, 미입력 시 공통 salePrice 사용
    salePrice: d.coupangPrice ?? d.salePrice,
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

  // 카테고리 메타에서 고시정보 자동 생성 (첫 번째 noticeCategory의 "기타 재화" 우선, 없으면 첫 항목)
  let autoNotices: { noticeCategoryName: string; noticeCategoryDetailName: string; content: string }[] = [];
  try {
    const meta = await client.getCategoryMeta(d.coupang.displayCategoryCode);
    const cats = meta.noticeCategories as { noticeCategoryName: string; noticeCategoryDetailNames: { noticeCategoryDetailName: string }[] }[] | undefined;
    if (cats && cats.length > 0) {
      const chosen = cats.find((c) => c.noticeCategoryName === '기타 재화') ?? cats[0];
      autoNotices = chosen.noticeCategoryDetailNames.map((det) => ({
        noticeCategoryName: chosen.noticeCategoryName,
        noticeCategoryDetailName: det.noticeCategoryDetailName,
        content: '상세페이지 참조',
      }));
    }
  } catch (e) {
    console.warn('[registerCoupang] 카테고리 메타 조회 실패, 고시정보 빈 배열:', e);
  }

  const payload = buildCoupangPayload(common, specific, client.vendor, options, autoNotices);
  const result = await client.registerProduct(payload);

  return { success: true, sellerProductId: result.sellerProductId };
}

// ─────────────────────────────────────────────────────────────
// 네이버 등록 처리
// ─────────────────────────────────────────────────────────────

async function registerNaver(
  d: BothRegisterInput,
  options?: OptionsInput,
): Promise<NaverResult> {
  const client = getNaverCommerceClient();

  // 네이버는 외부 URL 직접 사용 불가 → 이미지 업로드 API로 변환
  console.info('[registerNaver] 이미지 업로드 시작:', d.thumbnailImages.length, '장');
  const naverThumbnails = await client.uploadImagesFromUrls(d.thumbnailImages);
  if (naverThumbnails.length === 0) {
    throw new Error('네이버 이미지 업로드에 모두 실패했습니다. 이미지 URL을 확인해주세요.');
  }

  const common: CommonProductInput = {
    name: d.name,
    salePrice: d.naverPrice ?? d.salePrice,
    originalPrice: d.originalPrice,
    stock: d.stock,
    thumbnailImages: naverThumbnails,
    detailImages: d.detailImages,  // 상세 이미지는 HTML 내 img 태그로 삽입되므로 업로드 불필요
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

  const payload = buildNaverPayload(common, specific, options);
  console.info('[registerNaver] payload:', JSON.stringify(payload).slice(0, 2000));
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

  // options가 있으면 OptionsInput 형태로 변환 (없으면 undefined 전달)
  const optionsInput: OptionsInput | undefined = d.options;

  // ── 미리보기 모드: payload만 생성하여 반환, 실제 등록 안 함 ──
  if (d.preview) {
    const client = getCoupangClient();
    const outboundCode = d.coupang.outboundShippingPlaceCode || client.getOutboundShippingPlaceCode();
    const returnCode = d.coupang.returnCenterCode || client.getReturnCenterCode();

    // 쿠팡 고시정보 자동 조회
    let autoNotices: { noticeCategoryName: string; noticeCategoryDetailName: string; content: string }[] = [];
    try {
      const meta = await client.getCategoryMeta(d.coupang.displayCategoryCode);
      const cats = meta.noticeCategories as { noticeCategoryName: string; noticeCategoryDetailNames: { noticeCategoryDetailName: string }[] }[] | undefined;
      if (cats && cats.length > 0) {
        const chosen = cats.find((c) => c.noticeCategoryName === '기타 재화') ?? cats[0];
        autoNotices = chosen.noticeCategoryDetailNames.map((det) => ({
          noticeCategoryName: chosen.noticeCategoryName,
          noticeCategoryDetailName: det.noticeCategoryDetailName,
          content: '상세페이지 참조',
        }));
      }
    } catch { /* ignore */ }

    const coupangCommon: CommonProductInput = {
      name: d.name, salePrice: d.coupangPrice ?? d.salePrice,
      originalPrice: d.originalPrice, stock: d.stock,
      thumbnailImages: d.thumbnailImages, detailImages: d.detailImages,
      description: d.description, deliveryCharge: d.deliveryCharge,
      deliveryChargeType: d.deliveryChargeType, returnCharge: d.returnCharge,
    };
    const coupangSpecific: CoupangSpecificInput = {
      displayCategoryCode: d.coupang.displayCategoryCode, brand: d.coupang.brand,
      maximumBuyCount: d.coupang.maximumBuyCount, maximumBuyForPerson: d.coupang.maximumBuyForPerson,
      outboundShippingPlaceCode: outboundCode, returnCenterCode: returnCode,
    };
    const coupangPayload = buildCoupangPayload(coupangCommon, coupangSpecific, client.vendor, optionsInput, autoNotices);

    const naverCommon: CommonProductInput = {
      name: d.name, salePrice: d.naverPrice ?? d.salePrice,
      originalPrice: d.originalPrice, stock: d.stock,
      thumbnailImages: d.thumbnailImages, detailImages: d.detailImages,
      description: d.description, deliveryCharge: d.deliveryCharge,
      deliveryChargeType: d.deliveryChargeType, returnCharge: d.returnCharge,
    };
    const naverSpecific: NaverSpecificInput = {
      leafCategoryId: d.naver.leafCategoryId, tags: d.naver.tags,
      exchangeFee: d.naver.exchangeFee, returnFee: d.naver.returnFee,
    };
    const naverPayload = buildNaverPayload(naverCommon, naverSpecific, optionsInput);

    return Response.json({
      success: true,
      preview: true,
      data: { coupang: coupangPayload, naver: naverPayload },
    });
  }

  // 두 플랫폼 병렬 등록 (한 쪽 실패가 다른 쪽에 영향 없음)
  const [coupangSettled, naverSettled] = await Promise.allSettled([
    registerCoupang(d, optionsInput),
    registerNaver(d, optionsInput),
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
