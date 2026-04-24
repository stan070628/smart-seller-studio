/**
 * 쿠팡 / 네이버 상품 등록 payload 조립 공통 유틸리티
 *
 * 기존 /api/listing/coupang/route.ts 와 /api/listing/naver/route.ts 에서
 * payload 조립 로직을 추출한 순수 함수 모음.
 * 로직 자체는 각 route.ts 와 동일하게 동작한다.
 */

import type { CoupangProductPayload } from '@/lib/listing/coupang-client';

// ─────────────────────────────────────────────────────────────
// 옵션(variants) 입력 타입 — ProductOptions 에서 필요한 필드만 추출
// ─────────────────────────────────────────────────────────────

/** payload mapper에 전달하는 단일 옵션 그룹 */
export interface OptionGroupInput {
  groupName: string;   // "색상", "사이즈"
  values: string[];    // 해당 그룹의 옵션값 목록 (표시 용도로만 사용)
}

/** payload mapper에 전달하는 단일 variant (SKU) */
export interface OptionVariantInput {
  optionValues: string[];              // ["블랙", "XL"] — group order 순
  sourceHash: string | null;
  costPrice: number;
  salePrices: { coupang: number; naver: number };
  stock: number;
  enabled: boolean;                    // false면 payload에서 제외
}

/** payload mapper에 전달하는 옵션 전체 묶음 */
export interface OptionsInput {
  groups: OptionGroupInput[];
  variants: OptionVariantInput[];
}

// ─────────────────────────────────────────────────────────────
// 공통 입력 타입
// ─────────────────────────────────────────────────────────────

export interface CommonProductInput {
  name: string;
  salePrice: number;
  originalPrice?: number;
  stock: number;
  thumbnailImages: string[];  // 상품 대표/추가 이미지 (최소 1개)
  detailImages: string[];     // 상세페이지 이미지 (0개 이상)
  description: string;
  deliveryCharge: number;
  deliveryChargeType: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
  returnCharge: number;
}

// ─────────────────────────────────────────────────────────────
// 쿠팡 전용 입력 타입
// ─────────────────────────────────────────────────────────────

export interface NoticeItem {
  noticeCategoryName: string;
  content: string;
}

export interface CoupangSpecificInput {
  displayCategoryCode: number;
  brand: string;
  maximumBuyCount?: number;
  maximumBuyForPerson?: number;
  outboundShippingPlaceCode: string;
  returnCenterCode: string;
  deliveryCompanyCode?: string;
  outboundShippingTimeDay?: number;
  adultOnly?: 'EVERYONE' | 'ADULTS_ONLY';
  taxType?: 'TAX' | 'TAX_FREE' | 'ZERO_TAX';
  overseasPurchased?: 'NOT_OVERSEAS_PURCHASED' | 'OVERSEAS_PURCHASED';
  parallelImported?: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED' | 'CONFIRMED_CARRIED_OUT';
  notices?: NoticeItem[];
}

// ─────────────────────────────────────────────────────────────
// 네이버 전용 입력 타입
// ─────────────────────────────────────────────────────────────

export interface NaverSpecificInput {
  leafCategoryId: string;
  tags?: string[];
  exchangeFee?: number;
  returnFee?: number;
}

// ─────────────────────────────────────────────────────────────
// 쿠팡 payload 조립
// ─────────────────────────────────────────────────────────────

/**
 * 쿠팡 상품 등록 payload를 조립한다.
 * outboundShippingPlaceCode / returnCenterCode 는 호출 전에 채워서 전달해야 한다.
 * options가 없거나 enabled variant가 없으면 기존 단일 item 로직으로 동작한다.
 */
export function buildCoupangPayload(
  common: CommonProductInput,
  specific: CoupangSpecificInput,
  vendorId: string,
  options?: OptionsInput,
  overrideNotices?: { noticeCategoryName: string; noticeCategoryDetailName: string; content: string }[],
): CoupangProductPayload {
  const maximumBuyCount = specific.maximumBuyCount ?? 999;
  const maximumBuyForPerson = specific.maximumBuyForPerson ?? 0;

  // 상세 내용 — TEXT(설명) + IMAGE(상세이미지) 분리
  // 쿠팡은 TEXT 타입에서 HTML을 렌더링하지 않으므로 이미지는 IMAGE 타입으로 전달
  const contents: { contentsType: 'TEXT' | 'IMAGE'; contentDetails: { content: string; detailType: 'TEXT' | 'IMAGE' }[] }[] = [
    {
      contentsType: 'TEXT',
      contentDetails: [{ content: common.description || common.name, detailType: 'TEXT' }],
    },
    ...common.detailImages.map((url) => ({
      contentsType: 'IMAGE' as const,
      contentDetails: [{ content: url, detailType: 'IMAGE' as const }],
    })),
  ];

  // overrideNotices: getCategoryMeta()가 자동 생성한 카테고리별 필수 고시정보. 있으면 우선 사용.
  // specific.notices: 사용자가 폼에서 직접 입력한 고시정보. overrideNotices 없을 때만 사용.
  const notices =
    overrideNotices ??
    (specific.notices?.map((n) => ({
      noticeCategoryName: n.noticeCategoryName,
      noticeCategoryDetailName: n.noticeCategoryName,
      content: n.content,
    })) ?? []);

  // 이미지 배열 — 썸네일 + 상세 이미지를 함께 포함
  // (쿠팡은 vendorPath에 외부 URL 허용, contents IMAGE는 거부함)
  const images = [
    ...common.thumbnailImages.map((url, i) => ({
      imageOrder: i,
      imageType: i === 0 ? 'REPRESENTATION' as const : 'DETAIL' as const,
      vendorPath: url,
    })),
    ...common.detailImages.map((url, i) => ({
      imageOrder: common.thumbnailImages.length + i,
      imageType: 'DETAIL' as const,
      vendorPath: url,
    })),
  ];

  // enabled variant가 1개 이상이면 variant별 item 생성, 없으면 단일 item
  const enabledVariants = options?.variants.filter((v) => v.enabled) ?? [];

  const items =
    enabledVariants.length > 0
      ? enabledVariants.map((variant) => {
          // 옵션값 조합명: "블랙/XL"
          const variantLabel = variant.optionValues.join('/');
          // group 순서에 따라 attributes 생성
          const attributes = options!.groups.map((group, idx) => ({
            attributeTypeName: group.groupName,
            attributeValueName: variant.optionValues[idx] ?? '',
          }));

          return {
            itemName: variantLabel,
            originalPrice: common.originalPrice ?? variant.salePrices.coupang,
            salePrice: variant.salePrices.coupang,
            maximumBuyCount,
            maximumBuyForPerson,
            maximumBuyForPersonPeriod: 1,
            outboundShippingTimeDay: specific.outboundShippingTimeDay ?? 3,
            unitCount: 1,
            adultOnly: specific.adultOnly ?? 'EVERYONE',
            taxType: specific.taxType ?? 'TAX',
            overseasPurchased: specific.overseasPurchased ?? 'NOT_OVERSEAS_PURCHASED',
            parallelImported: specific.parallelImported ?? 'NOT_PARALLEL_IMPORTED',
            images,
            attributes,
            contents,
            notices,
          };
        })
      : [
          // 옵션 없는 기존 단일 item
          {
            itemName: common.name,
            originalPrice: common.originalPrice ?? common.salePrice,
            salePrice: common.salePrice,
            maximumBuyCount,
            maximumBuyForPerson,
            maximumBuyForPersonPeriod: 1,
            outboundShippingTimeDay: specific.outboundShippingTimeDay ?? 3,
            unitCount: 1,
            adultOnly: specific.adultOnly ?? 'EVERYONE',
            taxType: specific.taxType ?? 'TAX',
            overseasPurchased: specific.overseasPurchased ?? 'NOT_OVERSEAS_PURCHASED',
            parallelImported: specific.parallelImported ?? 'NOT_PARALLEL_IMPORTED',
            images,
            attributes: [],
            contents,
            notices,
          },
        ];

  return {
    displayCategoryCode: specific.displayCategoryCode,
    sellerProductName: common.name,
    vendorId,
    saleStartedAt: '1970-01-01T00:00:00',
    saleEndedAt: '2999-01-01T00:00:00',
    brand: specific.brand,
    generalProductName: common.name,
    deliveryMethod: 'SEQUENCIAL',
    deliveryCompanyCode: specific.deliveryCompanyCode ?? 'LOTTE',
    deliveryChargeType: common.deliveryCharge === 0 ? 'FREE' : 'NOT_FREE',
    deliveryCharge: common.deliveryCharge,
    freeShipOverAmount: 0,
    deliveryChargeOnReturn: common.returnCharge,
    deliverySurcharge: 0,
    remoteAreaDeliverable: 'N',
    bundlePackingDelivery: 0,
    unionDeliveryType: 'NOT_UNION_DELIVERY',
    returnCenterCode: specific.returnCenterCode,
    outboundShippingPlaceCode: specific.outboundShippingPlaceCode,
    returnChargeName: process.env.COUPANG_RETURN_NAME ?? '',
    companyContactNumber: process.env.COUPANG_CONTACT_NUMBER ?? '',
    returnZipCode: process.env.COUPANG_RETURN_ZIPCODE ?? '',
    returnAddress: process.env.COUPANG_RETURN_ADDRESS ?? '',
    returnAddressDetail: process.env.COUPANG_RETURN_ADDRESS_DETAIL ?? '',
    returnCharge: common.returnCharge,
    vendorUserId: process.env.COUPANG_VENDOR_USER_ID ?? '',
    items,
  };
}

// ─────────────────────────────────────────────────────────────
// 네이버 payload 조립
// ─────────────────────────────────────────────────────────────

/**
 * 네이버 스마트스토어 상품 등록 payload를 조립한다.
 * options가 없거나 enabled variant가 없으면 기존 단일 상품 로직으로 동작한다.
 */
export function buildNaverPayload(
  common: CommonProductInput,
  specific: NaverSpecificInput,
  options?: OptionsInput,
): Record<string, unknown> {
  const exchangeFee = specific.exchangeFee ?? 8000;
  const returnFee = specific.returnFee ?? common.returnCharge;

  // enabled variant 목록
  const enabledVariants = options?.variants.filter((v) => v.enabled) ?? [];

  // 옵션 정보 조립 (enabled variant가 있을 때만)
  let optionInfo: Record<string, unknown> = { simpleOptionSortType: 'CREATE' };
  // 옵션 있을 때의 실효 기본 판매가: enabled variant 최저가를 salePrice로 사용
  // (네이버 정책: optionCombinations 중 추가금액=0인 항목이 1개 이상 필수)
  const naverBaseSalePrice =
    enabledVariants.length > 0
      ? Math.min(...enabledVariants.map((v) => v.salePrices.naver))
      : common.salePrice;

  if (enabledVariants.length > 0 && options) {
    // 그룹명 키: optionGroupName1 ~ optionGroupName4 (최대 4개)
    const groupNames: Record<string, string> = {};
    options.groups.slice(0, 4).forEach((group, idx) => {
      groupNames[`optionGroupName${idx + 1}`] = group.groupName;
    });

    // 조합 목록
    const optionCombinations = enabledVariants.map((variant) => {
      // 추가금액: variant 네이버 가격 - 최저 옵션가 (네이버: 최소 1개는 추가금액=0 필수)
      const additionalPrice = Math.max(0, variant.salePrices.naver - naverBaseSalePrice);

      // optionName1 ~ optionName4
      const nameFields: Record<string, string> = {};
      variant.optionValues.slice(0, 4).forEach((val, idx) => {
        nameFields[`optionName${idx + 1}`] = val;
      });

      return {
        ...nameFields,
        stockQuantity: variant.stock,
        price: additionalPrice,
        usable: true,
      };
    });

    optionInfo = {
      simpleOptionSortType: 'CREATE',
      optionCombinationGroupNames: groupNames,
      optionCombinations,
    };
  }

  const payload: Record<string, unknown> = {
    originProduct: {
      statusType: 'SUSPENSION',
      saleType: 'NEW',
      leafCategoryId: specific.leafCategoryId,
      name: common.name,
      images: {
        representativeImage: { url: common.thumbnailImages[0] },
        optionalImages: common.thumbnailImages.slice(1).map((url) => ({ url })),
      },
      detailAttribute: {
        naverShoppingSearchInfo: {
          manufacturerName: '상세페이지 참조',
        },
        afterServiceInfo: {
          afterServiceTelephoneNumber: process.env.NAVER_AS_PHONE ?? '010-0000-0000',
          afterServiceGuideContent: '판매자에게 문의해주세요.',
        },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: 'ETC',
          etc: {
            itemName: common.name,
            modelName: '상세페이지 참조',
            manufacturer: '상세페이지 참조',
            afterServiceDirector: process.env.NAVER_AS_PHONE ?? '010-0000-0000',
            returnCostReason: '전자상거래법에 의한 반품 시 반품배송비 부담',
            noRefundReason: '상세페이지 참조',
            qualityAssuranceStandard: '소비자분쟁해결기준에 따름',
            compensationProcedure: '소비자분쟁해결기준에 따름',
            troubleShootingContents: '판매자 문의',
          },
        },
        productCertificationInfos: [],
        originAreaInfo: {
          originAreaCode: '00',
          content: '상세페이지 참조',
        },
        sellerCodeInfo: {},
        optionInfo,
        minorPurchasable: true,
        seoInfo: {},
      },
      customerBenefit: {},
      // 옵션 있을 때는 최저 옵션가를 기본 판매가로 설정 (추가금액=0 조건 충족)
      salePrice: naverBaseSalePrice,
      stockQuantity: common.stock,
      deliveryInfo: {
        deliveryType: 'DELIVERY',
        deliveryAttributeType: 'NORMAL',
        deliveryCompany: 'CJGLS',
        deliveryFee: {
          deliveryFeeType: common.deliveryCharge === 0 ? 'FREE' : 'PAID',
          baseFee: common.deliveryCharge,
        },
        claimDeliveryInfo: {
          returnDeliveryFee: returnFee,
          exchangeDeliveryFee: exchangeFee,
        },
      },
      // detailImages가 있으면 detailContent 끝에 이미지 태그를 추가한다
      detailContent: `<div>${common.description}${
        common.detailImages.length > 0
          ? common.detailImages
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
  if (specific.tags && specific.tags.length > 0) {
    (
      (payload.originProduct as Record<string, unknown>)
        .detailAttribute as Record<string, unknown>
    ).sellerTags = specific.tags.map((text) => ({ text }));
  }

  return payload;
}
