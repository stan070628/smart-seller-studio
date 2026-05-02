/**
 * /api/listing/coupang
 * GET  — 쿠팡 등록 상품 목록 조회
 * POST — 쿠팡 상품 등록
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { assertCoupangReturnEnv } from '@/lib/listing/coupang-env';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

// ─────────────────────────────────────────────────────────────
// GET — 판매자 상품 목록
// ─────────────────────────────────────────────────────────────

// 쿠팡 판매자 상품 status 목록
const ALL_PRODUCT_STATUSES = ['APPROVED', 'SUSPENSION', 'UNDER_REVIEW', 'REJECTED'];

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

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

// 옵션(variant) 단일 항목 스키마
const VariantSchema = z.object({
  itemName: z.string().min(1),
  attributes: z.array(z.object({
    attributeTypeName: z.string(),
    attributeValueName: z.string(),
  })),
  salePrice: z.number().int().min(100),
  originalPrice: z.number().int().min(100).optional(),
  stock: z.number().int().min(0).default(100),
});

const RegisterSchema = z.object({
  displayCategoryCode: z.number().int(),
  sellerProductName: z.string().min(1).max(200),
  brand: z.string().default(''),
  salePrice: z.number().int().min(100),
  originalPrice: z.number().int().min(100).optional(),
  stock: z.number().int().min(1).default(999),
  thumbnailImages: z.array(z.string().url()).min(1).max(10),
  detailImages: z.array(z.string().url()).max(20).default([]),
  description: z.string().default(''),
  deliveryCharge: z.number().int().min(0).default(0),
  deliveryChargeType: z.enum(['FREE', 'NOT_FREE', 'CHARGE_RECEIVED']).default('FREE'),
  returnCharge: z.number().int().min(0).default(5000),
  // dry-run: 실제 쿠팡 API 호출 없이 성공 응답만 반환
  dryRun: z.boolean().optional(),
  // 선택 필드
  maximumBuyCount: z.number().int().min(1).default(999),
  maximumBuyForPerson: z.number().int().min(0).default(0),
  outboundShippingPlaceCode: z.string().optional(),
  returnCenterCode: z.string().optional(),
  deliveryCompanyCode: z.string().optional(),
  outboundShippingTimeDay: z.number().int().min(1).max(30).optional(),
  adultOnly: z.enum(['EVERYONE', 'ADULTS_ONLY']).optional(),
  taxType: z.enum(['TAX', 'TAX_FREE', 'ZERO_TAX']).optional(),
  overseasPurchased: z.enum(['NOT_OVERSEAS_PURCHASED', 'OVERSEAS_PURCHASED']).optional(),
  parallelImported: z.enum(['NOT_PARALLEL_IMPORTED', 'PARALLEL_IMPORTED', 'CONFIRMED_CARRIED_OUT']).optional(),
  notices: z.array(z.object({
    noticeCategoryName: z.string(),
    noticeCategoryDetailName: z.string(),
    content: z.string(),
  })).optional(),
  // 상품 옵션(variant) — 있으면 각 조합마다 별도 item 생성
  variants: z.array(VariantSchema).optional(),
  searchTags: z.array(z.string()).max(10).optional(),
});

export async function POST(request: NextRequest) {
  // 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

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
    assertCoupangReturnEnv();
    const client = getCoupangClient();

    if (d.dryRun) {
      return Response.json({
        success: true,
        dryRun: true,
        data: {
          sellerProductId: 99999999,
          productUrl: 'https://www.coupang.com/vp/products/99999999',
          wingsUrl: 'https://wing.coupang.com',
        },
      });
    }

    // 출고지/반품지 코드 (명시적 전달 → 환경변수 → 에러)
    const outboundCode = d.outboundShippingPlaceCode || client.getOutboundShippingPlaceCode();
    const returnCode = d.returnCenterCode || client.getReturnCenterCode();

    const contents = d.detailImages.length > 0
      ? d.detailImages.map((url: string) => ({
          contentsType: 'IMAGE' as const,
          contentDetails: [{ content: url, detailType: 'IMAGE' as const }],
        }))
      : [{ contentsType: 'TEXT' as const, contentDetails: [{ content: d.description || d.sellerProductName, detailType: 'TEXT' as const }] }];

    // 이미지 목록 (썸네일 + 상세) — 모든 item이 공유
    const itemImages = [
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
    ];

    // 공통 notice 목록 — getCategoryMeta 실제값으로 재교정
    // draft 로드나 AI 오류로 잘못된 값(예: "의류", "품명")이 들어와도 여기서 최종 교정됨
    const itemNotices = await (async () => {
      if (!d.notices || d.notices.length === 0) return [];
      try {
        const meta = await client.getCategoryMeta(d.displayCategoryCode) as Record<string, unknown>;
        type RawCat = { noticeCategoryName?: string; noticeCategoryDetailNames?: { noticeCategoryDetailName?: string }[] };
        const cats = (meta['noticeCategories'] as RawCat[] | undefined) ?? [];
        if (cats.length === 0) {
          // 메타 없음 → 그대로 전달
          return d.notices.map((n) => ({
            noticeCategoryName: n.noticeCategoryName,
            noticeCategoryDetailName: n.noticeCategoryDetailName,
            content: n.content,
          }));
        }
        const findCat = (name: string) => {
          if (!name) return undefined;
          return cats.find((c) => c.noticeCategoryName === name) ??
            cats.find((c) => (c.noticeCategoryName ?? '').startsWith(name) || name.startsWith(c.noticeCategoryName ?? '')) ??
            cats.find((c) => (c.noticeCategoryName ?? '').includes(name) || name.includes(c.noticeCategoryName ?? ''));
        };

        const mapped = d.notices
          .map((n) => {
            const cat = findCat(n.noticeCategoryName);
            if (!cat?.noticeCategoryName) return null;
            const details = (cat.noticeCategoryDetailNames ?? [])
              .map((det) => det.noticeCategoryDetailName ?? '')
              .filter(Boolean);
            const matchedDetail =
              details.find((det) => det === n.noticeCategoryDetailName) ??
              details.find((det) => det.includes(n.noticeCategoryDetailName) || n.noticeCategoryDetailName.includes(det)) ??
              // details[0] 폴백 제거 — 모든 항목이 첫 번째 필드로 중복 매핑되는 원인
              n.noticeCategoryDetailName;
            return { noticeCategoryName: cat.noticeCategoryName, noticeCategoryDetailName: matchedDetail, content: n.content };
          })
          .filter((n): n is { noticeCategoryName: string; noticeCategoryDetailName: string; content: string } => n !== null);

        // 중복 detailName 제거 (첫 번째 항목 우선)
        const seenKeys = new Set<string>();
        return mapped.filter((n) => {
          if (seenKeys.has(n.noticeCategoryDetailName)) return false;
          seenKeys.add(n.noticeCategoryDetailName);
          return true;
        });
      } catch {
        // getCategoryMeta 실패 시 입력값 그대로 사용
        return d.notices.map((n) => ({
          noticeCategoryName: n.noticeCategoryName,
          noticeCategoryDetailName: n.noticeCategoryDetailName,
          content: n.content,
        }));
      }
    })();

    // variants가 있으면 각 조합을 별도 item으로, 없으면 단일 item(기존 동작)
    const items: import('@/lib/listing/coupang-client').CoupangProductItem[] =
      d.variants && d.variants.length > 0
        ? d.variants.map((v) => ({
            itemName: v.itemName,
            originalPrice: v.originalPrice ?? d.originalPrice ?? d.salePrice,
            salePrice: v.salePrice,
            maximumBuyCount: d.maximumBuyCount,
            maximumBuyForPerson: d.maximumBuyForPerson,
            maximumBuyForPersonPeriod: 1,
            outboundShippingTimeDay: d.outboundShippingTimeDay ?? 3,
            unitCount: 1,
            adultOnly: d.adultOnly ?? 'EVERYONE',
            taxType: d.taxType ?? 'TAX',
            overseasPurchased: d.overseasPurchased ?? 'NOT_OVERSEAS_PURCHASED',
            parallelImported: d.parallelImported ?? 'NOT_PARALLEL_IMPORTED',
            images: itemImages,
            attributes: v.attributes,
            contents,
            notices: itemNotices,
          }))
        : [
            {
              itemName: d.sellerProductName,
              originalPrice: d.originalPrice ?? d.salePrice,
              salePrice: d.salePrice,
              maximumBuyCount: d.maximumBuyCount,
              maximumBuyForPerson: d.maximumBuyForPerson,
              maximumBuyForPersonPeriod: 1,
              outboundShippingTimeDay: d.outboundShippingTimeDay ?? 3,
              unitCount: 1,
              adultOnly: d.adultOnly ?? 'EVERYONE',
              taxType: d.taxType ?? 'TAX',
              overseasPurchased: d.overseasPurchased ?? 'NOT_OVERSEAS_PURCHASED',
              parallelImported: d.parallelImported ?? 'NOT_PARALLEL_IMPORTED',
              images: itemImages,
              attributes: [],
              contents,
              notices: itemNotices,
            },
          ];

    const payload: import('@/lib/listing/coupang-client').CoupangProductPayload = {
      displayCategoryCode: d.displayCategoryCode,
      sellerProductName: d.sellerProductName,
      vendorId: client.vendor,
      saleStartedAt: '1970-01-01T00:00:00',
      saleEndedAt: '2999-01-01T00:00:00',
      brand: d.brand,
      generalProductName: d.sellerProductName,
      deliveryMethod: 'SEQUENCIAL',
      deliveryCompanyCode: d.deliveryCompanyCode ?? 'CJGLS',
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
      items,
      searchTags: d.searchTags ?? [],
    };

    const result = await client.registerProduct(payload);

    // 등록 이력 Supabase에 저장 (실패해도 등록 성공에 영향 없음)
    try {
      const supabase = getSupabaseServerClient();
      await supabase.from('coupang_registered_products').insert({
        user_id: userId,
        seller_product_id: result.sellerProductId,
        seller_product_name: d.sellerProductName,
        source_type: 'manual',
        wings_status: 'UNDER_REVIEW',
      });
    } catch (saveErr) {
      console.warn('[POST /api/listing/coupang] Supabase 저장 실패 (무시됨):', saveErr);
    }

    return Response.json({
      success: true,
      data: {
        sellerProductId: result.sellerProductId,
        productUrl: `https://www.coupang.com/vp/products/${result.sellerProductId}`,
        wingsUrl: 'https://wing.coupang.com',
      },
    });
  } catch (err) {
    console.error('[POST /api/listing/coupang]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
