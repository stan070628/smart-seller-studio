/**
 * POST /api/listing/domeggook/prepare
 *
 * 도매꾹 상품번호를 받아 상품등록에 필요한 에셋을 준비합니다.
 *
 * 처리 내용:
 * 1. getItemView API 호출 → thumb.original(대표이미지), desc.contents.item(상세 HTML) 추출
 * 2. 대표이미지: 다운로드 → Sharp 800×800 정방형 + 워터마크 → Supabase Storage 업로드
 * 3. 상세 HTML: img URL 추출 → 이미지 병렬 다운로드(동시 8개) → Sharp 리사이즈 → 업로드 → URL 치환
 * 4. 불필요 요소(연락처·광고) 제거 → 커스텀 블록 3개(배송/CS/개인정보) 삽입
 * 5. 가공 결과 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage, getSupabaseServerClient } from '@/lib/supabase/server';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import {
  extractImageUrls,
  sanitizeHtml,
  replaceImageUrls,
} from '@/lib/listing/html-sanitizer';
import { renderAllCustomBlocks } from '@/lib/listing/detail-blocks';
import type { MoqStrategy } from '@/lib/sourcing/domeggook-pricing';
import {
  calcRecommendedSalePrice,
  calcMinSalePrice,
  DOMEGGOOK_TARGET_MARGIN_RATE,
} from '@/lib/sourcing/shared/channel-policy';
import { parseEffectiveDeliFee } from '@/lib/sourcing/deli-parser';
import {
  processMainImage,
  processDetailImage,
  downloadImage,
  withConcurrencyLimit,
} from '@/lib/listing/image-processor';

// ─────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────

const RequestSchema = z.object({
  itemNo: z.number().int().positive(),
  sellerName: z.string().min(1).max(50),
  sellerBrandName: z.string().max(30).optional(),
  csPhone: z.string().min(1).max(20),
  csHours: z.string().min(1).max(80),
  returnAddress: z.string().max(200).optional(),
  shippingDays: z.number().int().min(1).max(14).optional(),
});

type RequestBody = z.infer<typeof RequestSchema>;

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface PrepareSuccessData {
  thumbnail: {
    originalUrl: string;
    processedUrl: string;
    storagePath: string;
    assetId: string;
  };
  detail: {
    originalImageCount: number;
    processedImageCount: number;
    failedImageCount: number;
    processedHtml: string;
    detailAssetIds: string[];
  };
  source: {
    itemNo: number;
    title: string;
    licenseUsable: boolean;
  };
  pricing: {
    priceDome: number;           // 도매가
    moq: number;                 // MOQ
    costTotal: number;           // 원가 합계 (도매가×MOQ + 배송비)
    strategy: string | null;     // 묶음 전략 (single/1+1/2+1)
    deliWho: string | null;
    deliFee: number | null;
    naver: {
      minPrice: number;          // 최소판매가 (break-even, 마진 0%)
      recommendedPrice: number;  // 추천판매가 (마진 10% 포함)
      feeRate: number;           // 적용 수수료율
    };
    coupang: {
      minPrice: number;
      recommendedPrice: number;
      feeRate: number;
    };
  };
}

type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_INPUT'
  | 'ITEM_NOT_FOUND'
  | 'LICENSE_NOT_USABLE'
  | 'THUMBNAIL_DOWNLOAD_FAILED'
  | 'IMAGE_PROCESSING_FAILED'
  | 'STORAGE_UPLOAD_FAILED'
  | 'SERVER_ERROR';

function errorResponse(code: ErrorCode, message: string, status: number) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

// ─────────────────────────────────────────
// Storage 경로 헬퍼
// ─────────────────────────────────────────

function thumbPath(userId: string, itemNo: number, ts: number) {
  return `listings/${userId}/domeggook/${itemNo}/thumb_${ts}.jpg`;
}

function detailPath(userId: string, itemNo: number, idx: number, ts: number) {
  const padded = String(idx).padStart(3, '0');
  return `listings/${userId}/domeggook/${itemNo}/detail_${padded}_${ts}.jpg`;
}

// ─────────────────────────────────────────
// assets INSERT 헬퍼
// ─────────────────────────────────────────

async function insertAsset(
  userId: string,
  storagePath: string,
  publicUrl: string,
  fileSize: number,
  usageContext: 'listing_thumbnail' | 'listing_detail',
): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('assets')
    .insert({
      user_id: userId,
      project_id: null,
      storage_path: storagePath,
      public_url: publicUrl,
      file_name: storagePath.split('/').pop() ?? '',
      mime_type: 'image/jpeg',
      file_size: fileSize,
      usage_context: usageContext,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[domeggook/prepare] assets INSERT 실패:', error);
    return null;
  }
  return data.id as string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) {
    return errorResponse('AUTH_REQUIRED', '로그인이 필요합니다.', 401);
  }
  const { userId } = auth;

  // 2. 입력 검증
  let body: RequestBody;
  try {
    const raw = await request.json();
    body = RequestSchema.parse(raw);
  } catch {
    return errorResponse('INVALID_INPUT', '요청 데이터가 올바르지 않습니다.', 400);
  }

  const {
    itemNo,
    sellerName,
    sellerBrandName,
    csPhone,
    csHours,
    returnAddress,
    shippingDays,
  } = body;

  const ts = Date.now();

  // 3. 도매꾹 API 호출
  let detail;
  try {
    const client = getDomeggookClient();
    detail = await client.getItemView(itemNo);
  } catch (err) {
    console.error('[domeggook/prepare] getItemView 실패:', err);
    return errorResponse('ITEM_NOT_FOUND', `상품 ${itemNo}을(를) 찾을 수 없습니다.`, 404);
  }

  const title = detail.basis.title ?? '';
  const licenseUsable = detail.desc?.license?.usable === 'true';
  const supplierName = detail.seller?.nick || detail.seller?.id || null;

  // 4. 라이선스 확인 — false면 전체 중단
  if (!licenseUsable) {
    console.warn(`[domeggook/prepare] 상품 ${itemNo} 이미지 라이선스 비허가`);
    return errorResponse(
      'LICENSE_NOT_USABLE',
      '이 상품의 이미지는 판매자가 재사용을 허가하지 않았습니다. 직접 촬영한 이미지를 사용해주세요.',
      403,
    );
  }

  // ─────────────────────────────────────
  // 5-A. 대표이미지 처리
  // ─────────────────────────────────────

  const originalThumbUrl = detail.thumb?.original ?? detail.image?.url ?? '';

  if (!originalThumbUrl) {
    return errorResponse('THUMBNAIL_DOWNLOAD_FAILED', '대표이미지 URL을 찾을 수 없습니다.', 422);
  }

  let thumbBuffer: Buffer;
  try {
    thumbBuffer = await downloadImage(originalThumbUrl);
  } catch (err) {
    console.error('[domeggook/prepare] 대표이미지 다운로드 실패:', err);
    return errorResponse('THUMBNAIL_DOWNLOAD_FAILED', '대표이미지 다운로드에 실패했습니다.', 502);
  }

  let processedThumbBuffer: Buffer;
  try {
    processedThumbBuffer = await processMainImage(thumbBuffer, sellerBrandName || null);
  } catch (err) {
    console.error('[domeggook/prepare] 대표이미지 Sharp 처리 실패:', err);
    return errorResponse('IMAGE_PROCESSING_FAILED', '대표이미지 처리 중 오류가 발생했습니다.', 500);
  }

  const thumbStoragePath = thumbPath(userId, itemNo, ts);
  let thumbUploadResult;
  try {
    thumbUploadResult = await uploadToStorage(
      thumbStoragePath,
      processedThumbBuffer.buffer as ArrayBuffer,
      'image/jpeg',
      processedThumbBuffer.length,
    );
  } catch (err) {
    console.error('[domeggook/prepare] 대표이미지 Storage 업로드 실패:', err);
    return errorResponse('STORAGE_UPLOAD_FAILED', '대표이미지 업로드에 실패했습니다.', 502);
  }

  const thumbAssetId = await insertAsset(
    userId,
    thumbUploadResult.path,
    thumbUploadResult.url,
    processedThumbBuffer.length,
    'listing_thumbnail',
  );

  // ─────────────────────────────────────
  // 5-B. 상세 HTML 처리
  // ─────────────────────────────────────

  const rawHtml = detail.desc?.contents?.item ?? '';
  const sanitized = sanitizeHtml(rawHtml);
  const imageUrls = extractImageUrls(sanitized);

  // 이미지 병렬 다운로드 + 처리 + 업로드 (최대 8개 동시)
  const urlMap = new Map<string, string>();
  const detailAssetIds: string[] = [];
  let failedCount = 0;

  const tasks = imageUrls.map((url, idx) => async () => {
    const buf = await downloadImage(url);
    const processed = await processDetailImage(buf);
    const path = detailPath(userId, itemNo, idx, ts);
    const result = await uploadToStorage(path, processed.buffer as ArrayBuffer, 'image/jpeg', processed.length);
    return { url, newUrl: result.url, path, size: processed.length };
  });

  const results = await withConcurrencyLimit(tasks, 8);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      const { url, newUrl, path, size } = r.value;
      urlMap.set(url, newUrl);
      const assetId = await insertAsset(userId, path, newUrl, size, 'listing_detail');
      if (assetId) detailAssetIds.push(assetId);
    } else {
      console.warn(`[domeggook/prepare] 상세이미지 처리 실패 [${imageUrls[i]}]:`, r.reason);
      failedCount++;
    }
  }

  // URL 치환 → 커스텀 블록 삽입
  const replacedHtml = replaceImageUrls(sanitized, urlMap);
  const customBlocks = renderAllCustomBlocks({
    sellerName,
    supplierName: supplierName ?? undefined,
    csPhone,
    csHours,
    returnAddress,
    shippingDays,
  });
  const finalHtml = replacedHtml + '\n' + customBlocks;

  // ─────────────────────────────────────
  // 6. 추천판매가 계산
  // ─────────────────────────────────────

  const priceDome = typeof detail.price?.dome === 'string'
    ? parseInt(detail.price.dome, 10)
    : (detail.price?.dome ?? 0);
  const moq = typeof detail.qty?.domeMoq === 'string'
    ? parseInt(detail.qty.domeMoq as unknown as string, 10)
    : (detail.qty?.domeMoq ?? 1);

  const effectiveDeliFee = parseEffectiveDeliFee(detail.deli);
  // 응답용: 원본 fee 값 (deliWho 판단용)
  const deliRaw = detail.deli as Record<string, unknown> | undefined;
  const deliWho = (deliRaw?.who as string | undefined) ?? (deliRaw?.pay as string | undefined) ?? null;
  const deliFee = effectiveDeliFee;

  const moqStrategies: Record<number, MoqStrategy> = { 1: 'single', 2: '1+1', 3: '2+1' };
  const strategy: MoqStrategy = moqStrategies[moq] ?? null;
  const costTotal = priceDome * moq + effectiveDeliFee;
  const targetProfit = Math.ceil(costTotal * DOMEGGOOK_TARGET_MARGIN_RATE);

  const naverMin = calcMinSalePrice(costTotal, 'naver');
  const naverRecommended = calcRecommendedSalePrice(costTotal, targetProfit, 'naver');
  const coupangMin = calcMinSalePrice(costTotal, 'coupang');
  const coupangRecommended = calcRecommendedSalePrice(costTotal, targetProfit, 'coupang');

  // ─────────────────────────────────────
  // 7. 응답
  // ─────────────────────────────────────

  const responseData: PrepareSuccessData = {
    thumbnail: {
      originalUrl: originalThumbUrl,
      processedUrl: thumbUploadResult.url,
      storagePath: thumbStoragePath,
      assetId: thumbAssetId ?? '',
    },
    detail: {
      originalImageCount: imageUrls.length,
      processedImageCount: imageUrls.length - failedCount,
      failedImageCount: failedCount,
      processedHtml: finalHtml,
      detailAssetIds,
    },
    source: {
      itemNo,
      title,
      licenseUsable,
    },
    pricing: {
      priceDome,
      moq,
      costTotal,
      strategy,
      deliWho,
      deliFee,
      naver: {
        minPrice: naverMin,
        recommendedPrice: naverRecommended,
        feeRate: 0.06,
      },
      coupang: {
        minPrice: coupangMin,
        recommendedPrice: coupangRecommended,
        feeRate: 0.11,
      },
    },
  };

  return NextResponse.json({ success: true, data: responseData });
}
