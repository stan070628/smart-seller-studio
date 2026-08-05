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
  /** 항목명. 카테고리 메타의 noticeCategoryDetailName과 일치시켜야 값이 반영된다. */
  noticeCategoryDetailName?: string;
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
  /**
   * 카테고리 필수속성(MANDATORY). 비우면 쿠팡이 등록을 거부할 수 있다.
   * 예: 데이크림(56163)은 수량·개당 중량·개당 용량이 필수다.
   */
  attributes?: { attributeTypeName: string; attributeValueName: string }[];
  /** 검색어 태그(최대 20개). 비우면 검색 노출이 상품명에만 의존한다. */
  searchTags?: string[];
}

// ─────────────────────────────────────────────────────────────
// 네이버 전용 입력 타입
// ─────────────────────────────────────────────────────────────

/**
 * 상품정보제공고시 유형. 카테고리마다 요구 유형이 다르다 — 의류는 WEAR.
 * 전체 목록은 네이버 커머스API 문서 참조. 여기에는 이 앱이 실제로 쓰는 것만 둔다.
 */
export type NaverNoticeType = 'ETC' | 'WEAR' | 'SHOES' | 'BAG' | 'FASHION_ITEMS';

export interface NaverSpecificInput {
  leafCategoryId: string;
  tags?: string[];
  exchangeFee?: number;
  returnFee?: number;
  manufacturerName?: string;  // 제조사/브랜드
  countryOfOrigin?: string;   // 원산지 표기 문구 (예: 니카라과산((주)코스트코코리아))

  /**
   * 원산지 코드. 미지정 시 '03'(상세설명에 표시).
   * '00'(국산)을 기본값으로 두면 수입품이 국산으로 등록되어 표시사항이 틀어진다.
   * 코드 목록: GET /external/v1/product-origin-areas
   */
  originAreaCode?: string;
  /** 수입사. originAreaCode 가 '02' 계열(수입산)이면 네이버가 필수로 요구한다 */
  importer?: string;

  /** 출고지 주소록 번호. 미지정 시 스토어 기본 출고지가 적용된다 */
  shippingAddressId?: number;
  /** 반품교환지 주소록 번호 */
  returnAddressId?: number;

  /** 상품정보제공고시 유형. 미지정 시 'ETC' */
  noticeType?: NaverNoticeType;
  /** 고시 항목값. 유형에 맞는 키를 넣으면 기본값 위에 덮어쓴다 */
  noticeFields?: Record<string, string>;
}

// 고시 유형 → payload 상의 본문 키 ('WEAR' → 'wear', 'FASHION_ITEMS' → 'fashionItems')
function noticeBodyKey(type: NaverNoticeType): string {
  return type
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// 유형과 무관하게 모든 고시에 들어가는 공통 항목
const NOTICE_COMMON_DEFAULTS: Record<string, string> = {
  returnCostReason: '전자상거래법에 의한 반품 시 반품배송비 부담',
  noRefundReason: '상세페이지 참조',
  qualityAssuranceStandard: '소비자분쟁해결기준에 따름',
  compensationProcedure: '소비자분쟁해결기준에 따름',
  troubleShootingContents: '판매자 문의',
};

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
  // 쿠팡에는 별도 재고 필드가 없고 maximumBuyCount가 판매 가능 수량 역할을 한다.
  // common.stock을 반영하지 않으면 실재고보다 많은 주문을 받아 품절 사고가 난다.
  // (네이버는 stockQuantity로 stock을 이미 반영하고 있어 두 채널이 어긋나 있었다.)
  const maximumBuyCount = specific.maximumBuyCount ?? common.stock ?? 999;
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

  // overrideNotices: getCategoryMeta()가 자동 생성한 카테고리별 필수 항목 골격.
  //   content가 '상세페이지 참조' 같은 기본값이므로 그대로 쓰면 실제 정보가 등록되지 않는다.
  // specific.notices: 사용자가 입력한 실제 값.
  // → 골격을 유지한 채 항목명이 일치하는 것만 실제 값으로 채운다.
  //   화장품 전성분처럼 법정 표시 의무가 있는 항목이 기본값으로 등록되는 것을 막는다.
  const userNotices = specific.notices ?? [];
  const findUserContent = (detailName: string, categoryName: string) =>
    userNotices.find(
      (n) => (n.noticeCategoryDetailName ?? n.noticeCategoryName) === detailName,
    )?.content ??
    userNotices.find((n) => n.noticeCategoryName === categoryName && !n.noticeCategoryDetailName)
      ?.content;

  const notices = overrideNotices
    ? overrideNotices.map((o) => {
        const content = findUserContent(o.noticeCategoryDetailName, o.noticeCategoryName);
        return content ? { ...o, content } : o;
      })
    : userNotices.map((n) => ({
        noticeCategoryName: n.noticeCategoryName,
        noticeCategoryDetailName: n.noticeCategoryDetailName ?? n.noticeCategoryName,
        content: n.content,
      }));

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
          const attributes = [
            ...options!.groups.map((group, idx) => ({
              attributeTypeName: group.groupName,
              attributeValueName: variant.optionValues[idx] ?? '',
            })),
            ...(specific.attributes ?? []),
          ];

          return {
            itemName: variantLabel,
            originalPrice: common.originalPrice ?? variant.salePrices.coupang,
            salePrice: variant.salePrices.coupang,
            // variant마다 재고가 다르므로 공통값이 아니라 variant.stock을 쓴다.
            maximumBuyCount: specific.maximumBuyCount ?? variant.stock,
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
            attributes: specific.attributes ?? [],
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
    // 'LOTTE'는 쿠팡이 인정하지 않는 코드다("유효하지 않은 택배사 코드"로 등록 전체가 실패한다).
    // 환경변수로 지정하되, 없으면 검증된 CJGLS(CJ대한통운)를 쓴다.
    deliveryCompanyCode:
      specific.deliveryCompanyCode ?? process.env.COUPANG_DELIVERY_COMPANY_CODE ?? 'CJGLS',
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
    // 쿠팡 상한 20개. 비우면 검색 유입이 상품명 토큰에만 의존한다.
    searchTags: (specific.searchTags ?? []).slice(0, 20),
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
  const asPhone = process.env.NAVER_AS_PHONE ?? '010-0000-0000';
  const noticeType: NaverNoticeType = specific.noticeType ?? 'ETC';
  // '00'(국산)을 기본값으로 두면 수입품이 국산으로 등록된다 → '03'(상세설명에 표시)
  const originAreaCode = specific.originAreaCode ?? '03';

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
          manufacturerName: specific.manufacturerName || '상세페이지 참조',
        },
        afterServiceInfo: {
          afterServiceTelephoneNumber: process.env.NAVER_AS_PHONE ?? '010-0000-0000',
          afterServiceGuideContent: '판매자에게 문의해주세요.',
        },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: noticeType,
          [noticeBodyKey(noticeType)]: {
            ...NOTICE_COMMON_DEFAULTS,
            afterServiceDirector: asPhone,
            // ETC 는 품명·모델명·제조사를 요구한다. 다른 유형의 필수 항목은
            // 유형마다 달라 추측하지 않고 noticeFields 로 받는다.
            ...(noticeType === 'ETC'
              ? {
                  itemName: common.name,
                  modelName: '상세페이지 참조',
                  manufacturer: specific.manufacturerName || '상세페이지 참조',
                }
              : {}),
            ...specific.noticeFields,
          },
        },
        productCertificationInfos: [],
        originAreaInfo: {
          originAreaCode,
          content: specific.countryOfOrigin || '상세페이지 참조',
          // 수입산 코드인데 importer 가 비면 네이버가 400 을 낸다. 값이 없으면
          // 키 자체를 빼서 지어낸 수입사가 표시사항에 실리지 않게 한다.
          ...(specific.importer ? { importer: specific.importer } : {}),
        },
        sellerCodeInfo: {},
        optionInfo,
        minorPurchasable: true,
        // 네이버는 sellerTags 를 seoInfo 아래에서만 읽는다. originProduct 직속에
        // 넣으면 오류 없이 조용히 무시되어 태그가 통째로 유실된다.
        seoInfo: {
          ...(specific.tags && specific.tags.length > 0
            ? { sellerTags: specific.tags.map((text) => ({ text })) }
            : {}),
        },
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
          // 주소록 번호는 조회 API(GET /external/v1/seller/addressbooks-for-page)로
          // 얻는다. 값이 없으면 키를 빼야 한다 — null 을 보내면 400.
          ...(specific.shippingAddressId ? { shippingAddressId: specific.shippingAddressId } : {}),
          ...(specific.returnAddressId ? { returnAddressId: specific.returnAddressId } : {}),
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

  return payload;
}
