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
import { assertCoupangReturnEnv } from '@/lib/listing/coupang-env';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { ensureCoupangImages } from '@/lib/image/coupang-constraints';

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
  // extra 필드 접근 (DraftData 인터페이스에 없는 필드)
  const raw = (draft.draft_data ?? {}) as Record<string, unknown>;

  const sellerProductName = d.name ?? (draft.product_name as string) ?? '';
  const displayCategoryCode = Number(d.categoryCode) || 0;
  const brand = d.brand ?? '';
  const salePrice = Number(d.salePrice) || 0;
  const originalPrice = Number(d.originalPrice) || salePrice;
  const deliveryCharge = Number(d.deliveryCharge) || 0;
  const returnCharge = Number(d.returnCharge) || 0;

  // 대표이미지·추가이미지용: thumbnailImages 배열 (최대 10장)
  // draft 저장 시 thumbnailImages 배열 전체가 raw 필드에 저장됨
  const thumbnailImages: string[] = Array.isArray(raw['thumbnailImages'])
    ? (raw['thumbnailImages'] as string[]).filter(Boolean).slice(0, 10)
    : d.thumbnail ? [d.thumbnail] : [];

  // 상세설명(HTML) 우선: detailPageSnippet → detailHtml
  // 쿠팡 상세설명은 반드시 HTML(TEXT)로 등록
  const detailHtmlContent: string =
    typeof raw['detailPageSnippet'] === 'string' && raw['detailPageSnippet']
      ? raw['detailPageSnippet']
      : d.detailHtml ?? sellerProductName;

  // pickedDetailImages: 사용자가 직접 선택한 이미지 — 상세설명 contents 이미지 폴백용
  // itemImages(추가이미지)에는 넣지 않음
  const pickedDetailImages: string[] = Array.isArray(raw['pickedDetailImages'])
    ? (raw['pickedDetailImages'] as string[]).filter(Boolean)
    : Array.isArray(d.detailImages) ? (d.detailImages as string[]) : [];

  if (!sellerProductName || !displayCategoryCode || !salePrice) {
    return Response.json(
      { success: false, error: '필수 필드(상품명, 카테고리 코드, 판매가)가 누락되었습니다.' },
      { status: 400 },
    );
  }

  try {
    assertCoupangReturnEnv();
    const client = getCoupangClient();

    // 출고지/반품지 코드 (draft_data 우선 → 환경변수 fallback)
    const outboundCode = d.outboundCode || client.getOutboundShippingPlaceCode();
    const returnCenterCode = d.returnCode || client.getReturnCenterCode();

    // ── 쿠팡 이미지 규격 적용 (min 500×500, max 5000×5000, max 10MB) ──────────
    // pickedDetailImages(상세 버킷 이미지)는 thumbnailImages에서 제외:
    // 상세 이미지가 대표이미지/추가이미지 슬롯에 잘못 등록되는 문제 방지
    console.log('[submit] 이미지 규격 검사 시작...');
    const pickedDetailSet = new Set(pickedDetailImages);
    let thumbsOnly = thumbnailImages.filter((url) => !pickedDetailSet.has(url));
    // 필터링으로 모든 이미지가 제거된 경우 원본 thumbnailImages 사용 (빈 이미지 방지)
    if (thumbsOnly.length === 0 && thumbnailImages.length > 0) {
      thumbsOnly = thumbnailImages;
      console.warn('[submit] thumbsOnly 필터링으로 이미지 전부 제거 → thumbnailImages 원본 사용');
    }
    const imagesToProcess = thumbsOnly.length > 0 ? thumbsOnly : d.thumbnail ? [d.thumbnail] : [];
    const safeThumbUrls = await ensureCoupangImages(imagesToProcess);

    // ── 대표이미지 + 추가이미지 (itemImages) ─────────────────────────────────
    // thumbnailImages(상세 이미지 제외)만 사용: [0] = REPRESENTATION, [1..9] = DETAIL (추가이미지)
    // pickedDetailImages는 상세설명(contents)에만 사용 — 추가이미지 슬롯에 넣지 않음
    const itemImages = safeThumbUrls.map((url: string, i: number) => ({
      imageOrder: i,
      imageType: i === 0 ? 'REPRESENTATION' as const : 'DETAIL' as const,
      vendorPath: url,
    }));

    if (itemImages.length === 0) {
      return Response.json(
        { success: false, error: '등록할 이미지가 없습니다. 상품 이미지를 1장 이상 추가하고 임시저장 후 다시 시도하세요.' },
        { status: 400 },
      );
    }

    // ── 상세설명 contents: HTML 우선, 없으면 pickedDetailImages 이미지 배열 ─────
    // 쿠팡 상세설명은 HTML(TEXT)로 등록하는 것이 정식 방법
    const contents = detailHtmlContent
      ? [{
          contentsType: 'TEXT' as const,
          contentDetails: [{ content: detailHtmlContent, detailType: 'TEXT' as const }],
        }]
      : pickedDetailImages.length > 0
        ? pickedDetailImages.map((url: string) => ({
            contentsType: 'IMAGE' as const,
            contentDetails: [{ content: url, detailType: 'IMAGE' as const }],
          }))
        : [{
            contentsType: 'TEXT' as const,
            contentDetails: [{ content: sellerProductName, detailType: 'TEXT' as const }],
          }];

    // 공통 notice 목록 — getCategoryMeta 실제값으로 재교정 후 중복 detailName 제거
    // draft에 저장된 값이 AI 약식 표현('의류', '품명')일 경우 정확한 API 허용값으로 보정
    const itemNotices = await (async () => {
      if (!d.notices || d.notices.length === 0) return [];
      type RawCat = { noticeCategoryName?: string; noticeCategoryDetailNames?: { noticeCategoryDetailName?: string }[] };
      let cats: RawCat[] = [];
      try {
        const meta = await client.getCategoryMeta(displayCategoryCode) as Record<string, unknown>;
        cats = (meta['noticeCategories'] as RawCat[] | undefined) ?? [];
      } catch {
        // getCategoryMeta 실패 시 원본값 그대로 사용
      }

      const findCat = (name: string) => {
        if (!name || cats.length === 0) return undefined;
        return cats.find((c) => c.noticeCategoryName === name) ??
          cats.find((c) => (c.noticeCategoryName ?? '').startsWith(name) || name.startsWith(c.noticeCategoryName ?? '')) ??
          cats.find((c) => (c.noticeCategoryName ?? '').includes(name) || name.includes(c.noticeCategoryName ?? ''));
      };

      const mapped = d.notices.map((n) => {
        if (!n.detailName) return null;
        const cat = findCat(n.categoryName);
        // cats가 있는데 매칭 실패 → 유효하지 않은 카테고리명이므로 제외
        if (!cat && cats.length > 0) return null;
        const correctedCategoryName = cat?.noticeCategoryName ?? n.categoryName;
        const details = (cat?.noticeCategoryDetailNames ?? [])
          .map((det) => det.noticeCategoryDetailName ?? '')
          .filter(Boolean);
        const correctedDetailName =
          details.find((det) => det === n.detailName) ??
          details.find((det) => det.includes(n.detailName) || n.detailName.includes(det)) ??
          n.detailName;
        return {
          noticeCategoryName: correctedCategoryName,
          noticeCategoryDetailName: correctedDetailName,
          content: n.content,
        };
      });

      // null 제거 + 빈 content 제거 + 중복 detailName 제거 (같은 키가 2개 이상이면 400 오류)
      const seenNoticeKeys = new Set<string>();
      const corrected = mapped.filter((n): n is { noticeCategoryName: string; noticeCategoryDetailName: string; content: string } => {
        if (!n || !n.noticeCategoryDetailName) return false;
        if (!n.content?.trim()) return false;
        if (seenNoticeKeys.has(n.noticeCategoryDetailName)) return false;
        seenNoticeKeys.add(n.noticeCategoryDetailName);
        return true;
      });

      // 교정 후 전부 필터링된 경우: 원본 notices를 폴백으로 사용 (빈 notices 방지)
      // 카테고리 변경 등으로 매핑 실패해도 원본값으로 시도
      if (corrected.length === 0) {
        console.warn('[submit] 교정 후 notices 전부 필터링 → 원본 notices 폴백 사용');
        const seenFallback = new Set<string>();
        return d.notices
          .filter((n) => n.detailName && n.content?.trim())
          .filter((n) => {
            if (seenFallback.has(n.detailName)) return false;
            seenFallback.add(n.detailName);
            return true;
          })
          .map((n) => ({
            noticeCategoryName: n.categoryName,
            noticeCategoryDetailName: n.detailName,
            content: n.content,
          }));
      }
      return corrected;
    })();

    // draft_data에서 읽은 상품 속성 값 (없으면 기본값)
    const adultOnly = d.adultOnly || 'EVERYONE';
    const taxType = d.taxType || 'TAX';
    const parallelImported = d.parallelImported || 'NOT_PARALLEL_IMPORTED';

    // KC 인증정보 — certification은 쉼표 구분 여러 번호일 수 있음 (예: "XU100557-25047, R-R-ONH-FANSTAND4C")
    // 인증번호 패턴으로 Coupang certificationType 자동 매핑
    const certRaw = typeof raw['certification'] === 'string' ? raw['certification'].trim() : '';
    const certifications = certRaw
      ? certRaw.split(',').map(s => s.trim()).filter(Boolean).map(code => {
          let certificationType = 'KC_ELECTRONICS_CONFIRM'; // 기본값 (XU... 안전확인)
          if (/^R-R-/i.test(code) || /^MSIP-REI-/i.test(code)) {
            certificationType = 'COMMUNICATION_EQUIPMENT'; // 방송통신기자재 적합성
          } else if (/^SU\d{5}/i.test(code)) {
            certificationType = 'KC_ELECTRONICS_CERTIFICATION'; // 안전인증
          } else if (/^KB/i.test(code)) {
            certificationType = 'KC_ELECTRONICS_CERTIFICATION'; // 안전인증
          }
          return { certificationCode: code, certificationType };
        })
      : [];

    // variants가 있으면 각 조합을 별도 item으로, 없으면 단일 item(기존 동작)
    const variants = Array.isArray(d.variants) && d.variants.length > 0 ? d.variants : null;
    const items: import('@/lib/listing/coupang-client').CoupangProductItem[] = variants
      ? variants.map((v, idx) => ({
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
          notices: idx === 0 ? itemNotices : [],
          ...(certifications.length > 0 && { certifications }),
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
            ...(certifications.length > 0 && { certifications }),
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
    console.log('[submit] notices 전송:', JSON.stringify(itemNotices));
    console.log('[submit] payload 요약:', JSON.stringify({ displayCategoryCode, sellerProductName, salePrice, itemCount: items.length, noticeCount: itemNotices.length }));
    let result: { sellerProductId: number };
    let noticesFallback = false;
    try {
      result = await client.registerProduct(payload);
    } catch (firstErr) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      // notices 관련 오류 감지 → notices를 제거하고 재시도
      const isNoticeError = /고시정보.*카테고리명|고시정보.*카테고리상세명|입력할 수 없습니다|고시정보.*다시 확인|고시정보.*입력해야/i.test(firstMsg);
      if (isNoticeError && itemNotices.length > 0) {
        console.warn('[submit] notices 오류 감지, notices 제거 후 재시도:', firstMsg);
        const fallbackPayload = {
          ...payload,
          items: payload.items.map((item) => ({ ...item, notices: [] })),
        };
        result = await client.registerProduct(fallbackPayload);
        noticesFallback = true;
      } else {
        throw firstErr;
      }
    }
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

    return Response.json({
      success: true,
      sellerProductId,
      wingsUrl,
      ...(noticesFallback && { warning: '고시정보 카테고리 오류로 고시정보 없이 등록되었습니다. Wing에서 직접 입력해 주세요.' }),
    });
  } catch (err) {
    console.error('[POST /api/listing/coupang/drafts/[id]/submit]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    // 쿠팡 API 오류(4xx)는 클라이언트 측 데이터 문제 → 400, 그 외는 서버 오류 → 500
    const isCoupangApiError = message.startsWith('쿠팡 API 오류');
    return Response.json(
      { success: false, error: message },
      { status: isCoupangApiError ? 400 : 500 },
    );
  }
}
