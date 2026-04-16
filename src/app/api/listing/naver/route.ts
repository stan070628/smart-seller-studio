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
    };

    const payload = buildNaverPayload(common, specific);
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
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
