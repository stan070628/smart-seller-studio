/**
 * 쿠팡 / 네이버 상품 등록 payload 조립 공통 유틸리티
 *
 * 기존 /api/listing/coupang/route.ts 와 /api/listing/naver/route.ts 에서
 * payload 조립 로직을 추출한 순수 함수 모음.
 * 로직 자체는 각 route.ts 와 동일하게 동작한다.
 */

import type { CoupangProductPayload } from '@/lib/listing/coupang-client';

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

export interface CoupangSpecificInput {
  displayCategoryCode: number;
  brand: string;
  maximumBuyCount?: number;
  maximumBuyForPerson?: number;
  outboundShippingPlaceCode: string;
  returnCenterCode: string;
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
 */
export function buildCoupangPayload(
  common: CommonProductInput,
  specific: CoupangSpecificInput,
  vendorId: string,
): CoupangProductPayload {
  const maximumBuyCount = specific.maximumBuyCount ?? 999;
  const maximumBuyForPerson = specific.maximumBuyForPerson ?? 0;

  return {
    displayCategoryCode: specific.displayCategoryCode,
    sellerProductName: common.name,
    vendorId,
    saleStartedAt: new Date().toISOString().slice(0, 19),
    saleEndedAt: '2099-12-31T23:59:59',
    brand: specific.brand,
    generalProductName: common.name,
    deliveryInfo: {
      deliveryType: 'NORMAL',
      deliveryAttributeType: 'NORMAL',
      deliveryCompanyCode: 'CJGLS',
      deliveryChargeType: common.deliveryChargeType,
      deliveryCharge: common.deliveryCharge,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: common.returnCharge,
      returnCenterCode: specific.returnCenterCode,
      outboundShippingPlaceCode: specific.outboundShippingPlaceCode,
    },
    returnCharge: common.returnCharge,
    items: [
      {
        itemName: common.name,
        originalPrice: common.originalPrice ?? common.salePrice,
        salePrice: common.salePrice,
        maximumBuyCount,
        maximumBuyForPerson,
        unitCount: 1,
        images: common.thumbnailImages.map((url, i) => ({
          imageOrder: i,
          imageType: i === 0 ? 'REPRESENTATIVE' : 'DETAIL',
          vendorPath: url,
        })),
        attributes: [],
        contents: [
          {
            contentsType: 'HTML',
            contentDetails: [
              {
                // detailImages가 있으면 description 끝에 이미지 태그를 추가한다
                content: common.description + (
                  common.detailImages.length > 0
                    ? common.detailImages
                        .map(url => `<img src="${url}" style="width:100%;display:block;" />`)
                        .join('')
                    : ''
                ),
                detailType: 'HTML',
              },
            ],
          },
        ],
        notices: [
          {
            noticeCategoryName: '기타 재화',
            noticeCategoryDetailName: '품명 및 모델명',
            content: common.name,
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
}

// ─────────────────────────────────────────────────────────────
// 네이버 payload 조립
// ─────────────────────────────────────────────────────────────

/**
 * 네이버 스마트스토어 상품 등록 payload를 조립한다.
 */
export function buildNaverPayload(
  common: CommonProductInput,
  specific: NaverSpecificInput,
): Record<string, unknown> {
  const exchangeFee = specific.exchangeFee ?? 8000;
  const returnFee = specific.returnFee ?? common.returnCharge;

  const payload: Record<string, unknown> = {
    originProduct: {
      statusType: 'SALE',
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
          afterServiceTelephoneNumber: '판매자 문의',
          afterServiceGuideContent: '판매자에게 문의해주세요.',
        },
        originAreaInfo: {
          originAreaCode: '00',
          content: '상세페이지 참조',
        },
        sellerCodeInfo: {},
        optionInfo: { simpleOptionSortType: 'CREATE' },
        minorPurchasable: true,
        seoInfo: {},
      },
      customerBenefit: {},
      salePrice: common.salePrice,
      stockQuantity: common.stock,
      deliveryInfo: {
        deliveryType: 'DELIVERY',
        deliveryAttributeType: 'NORMAL',
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
