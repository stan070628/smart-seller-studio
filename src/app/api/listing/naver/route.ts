/**
 * /api/listing/naver
 * GET  — 네이버 등록 상품 목록 조회
 * POST — 네이버 상품 등록
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { buildNaverPayload } from '@/lib/listing/payload-mappers';
import type { CommonProductInput, NaverSpecificInput } from '@/lib/listing/payload-mappers';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

const PERMISSION_ERROR_KEYWORDS = ['등록권한', '권한이 있어야', '판매가 가능합니다', 'SALE_PROHIBITION'];

function isPermissionError(message: string): boolean {
  return PERMISSION_ERROR_KEYWORDS.some((kw) => message.includes(kw));
}

async function saveNaverDraft(productName: string, payload: Record<string, unknown>, errorMessage: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('listing_drafts')
    .insert({ platform: 'naver', product_name: productName, payload, error_message: errorMessage })
    .select('id')
    .single();
  if (error) throw new Error(`임시저장 실패: ${error.message}`);
  return data.id as string;
}

// ─── GET — 상품 목록 ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

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

  /**
   * 옵션(SKU) 조합. buildNaverPayload가 원래 지원하는데 이 라우트만 받지 않아
   * 사이즈·색상이 있는 의류가 단일 상품으로 등록됐다 — 구매자가 사이즈를 고를 수 없다.
   */
  options: z.object({
    groups: z.array(z.object({
      groupName: z.string().min(1),
      values: z.array(z.string()).default([]),
    })).min(1).max(4),
    variants: z.array(z.object({
      optionValues: z.array(z.string()).min(1).max(4),
      stock: z.number().int().min(0),
      salePrice: z.number().int().min(0),
    })).min(1),
  }).optional(),

  // 표시사항·원산지 — 수입품을 국산으로 등록하지 않으려면 명시해야 한다
  manufacturerName: z.string().optional(),
  originAreaCode: z.string().optional(),
  importer: z.string().optional(),
  noticeType: z.enum(['ETC', 'WEAR', 'SHOES', 'BAG', 'FASHION_ITEMS']).optional(),
  noticeFields: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

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

    // 네이버는 외부 URL 직접 사용 불가 → 이미지 업로드 API로 변환
    console.info('[POST /api/listing/naver] 이미지 업로드 시작:', d.thumbnailImages.length, '장');
    const naverThumbnails = await client.uploadImagesFromUrls(d.thumbnailImages);
    if (naverThumbnails.length === 0) {
      return Response.json(
        { success: false, error: '네이버 이미지 업로드에 모두 실패했습니다. 이미지 URL을 확인해주세요.' },
        { status: 422 },
      );
    }

    const common: CommonProductInput = {
      name: d.name,
      salePrice: d.salePrice,
      stock: d.stockQuantity,
      thumbnailImages: naverThumbnails,
      detailImages: d.detailImages,
      description: d.detailContent,
      deliveryCharge: d.deliveryFee,
      deliveryChargeType: d.deliveryFee === 0 ? 'FREE' : 'NOT_FREE',
      returnCharge: d.returnFee,
    };

    const specific: NaverSpecificInput = {
      leafCategoryId: d.leafCategoryId,
      tags: d.tags,
      exchangeFee: d.exchangeFee,
      returnFee: d.returnFee,
      manufacturerName: d.manufacturerName,
      originAreaCode: d.originAreaCode,
      importer: d.importer,
      noticeType: d.noticeType,
      noticeFields: d.noticeFields,
    };

    // 라우트 스키마 → 매퍼의 OptionsInput. 매퍼가 요구하는 원가/채널별 가격은
    // 이 경로에 없으므로 네이버 판매가로 채운다.
    const options = d.options && {
      groups: d.options.groups,
      variants: d.options.variants.map(v => ({
        optionValues: v.optionValues,
        sourceHash: null,
        costPrice: 0,
        salePrices: { coupang: v.salePrice, naver: v.salePrice },
        stock: v.stock,
        enabled: true,
      })),
    };

    const payload = buildNaverPayload(common, specific, options);
    console.info('[POST /api/listing/naver] payload:', JSON.stringify(payload).slice(0, 2000));
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

    // 카테고리 권한 오류 → 임시저장 폴백
    if (isPermissionError(message)) {
      let draftId: string | undefined;
      try {
        const payload = buildNaverPayload(
          {
            name: d.name,
            salePrice: d.salePrice,
            stock: d.stockQuantity,
            thumbnailImages: d.thumbnailImages,
            detailImages: d.detailImages,
            description: d.detailContent,
            deliveryCharge: d.deliveryFee,
            deliveryChargeType: d.deliveryFee === 0 ? 'FREE' : 'NOT_FREE',
            returnCharge: d.returnFee,
          },
          { leafCategoryId: d.leafCategoryId, tags: d.tags, exchangeFee: d.exchangeFee, returnFee: d.returnFee },
        );
        draftId = await saveNaverDraft(d.name, payload, message);
      } catch (draftErr) {
        console.error('[POST /api/listing/naver] 임시저장 실패 (테이블 미생성):', draftErr);
      }
      return Response.json({
        success: false,
        draft: true,
        draftId,
        error: `[네이버] 카테고리 판매 권한이 없습니다. 스마트스토어센터에서 권한 신청 후 수기 등록해주세요.`,
      }, { status: 200 });
    }

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
