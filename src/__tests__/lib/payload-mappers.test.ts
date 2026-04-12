/**
 * payload-mappers.test.ts
 * buildCoupangPayload / buildNaverPayload 순수 함수 단위 테스트
 *
 * 실제 구현: src/lib/listing/payload-mappers.ts
 * 외부 의존성 없음 — 모킹 불필요
 */

import { describe, it, expect } from 'vitest';
import {
  buildCoupangPayload,
  buildNaverPayload,
  type CommonProductInput,
  type CoupangSpecificInput,
  type NaverSpecificInput,
} from '@/lib/listing/payload-mappers';

// ---------------------------------------------------------------------------
// 픽스처 팩토리
// ---------------------------------------------------------------------------

function makeCommon(overrides?: Partial<CommonProductInput>): CommonProductInput {
  return {
    name: '테스트 상품명',
    salePrice: 19900,
    stock: 100,
    thumbnailImages: [
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
      'https://example.com/img3.jpg',
    ],
    detailImages: [],
    description: '<p>상세 설명입니다.</p>',
    deliveryCharge: 0,
    deliveryChargeType: 'FREE',
    returnCharge: 5000,
    ...overrides,
  };
}

function makeCoupangSpecific(overrides?: Partial<CoupangSpecificInput>): CoupangSpecificInput {
  return {
    displayCategoryCode: 56137,
    brand: '테스트브랜드',
    maximumBuyCount: 999,
    maximumBuyForPerson: 0,
    outboundShippingPlaceCode: 'OUTBOUND-001',
    returnCenterCode: 'RETURN-001',
    ...overrides,
  };
}

function makeNaverSpecific(overrides?: Partial<NaverSpecificInput>): NaverSpecificInput {
  return {
    leafCategoryId: '50000803',
    tags: ['태그1', '태그2'],
    exchangeFee: 8000,
    returnFee: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCoupangPayload 테스트
// ---------------------------------------------------------------------------

describe('buildCoupangPayload', () => {
  it('기본 입력 → sellerProductName, salePrice, images 가 올바르게 변환된다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'A0000012345');

    expect(payload.sellerProductName).toBe('테스트 상품명');
    expect(payload.vendorId).toBe('A0000012345');
    expect(payload.items[0].salePrice).toBe(19900);
    expect(payload.items[0].images).toHaveLength(3);
  });

  it('deliveryChargeType: "FREE" 입력 → deliveryInfo.deliveryChargeType 이 "FREE"로 매핑된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ deliveryChargeType: 'FREE' }),
      makeCoupangSpecific(),
      'A0000012345',
    );

    expect(payload.deliveryInfo.deliveryChargeType).toBe('FREE');
  });

  it('deliveryChargeType: "NOT_FREE" 입력 → deliveryInfo.deliveryChargeType 이 "NOT_FREE"로 매핑된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ deliveryChargeType: 'NOT_FREE', deliveryCharge: 3000 }),
      makeCoupangSpecific(),
      'A0000012345',
    );

    expect(payload.deliveryInfo.deliveryChargeType).toBe('NOT_FREE');
    expect(payload.deliveryInfo.deliveryCharge).toBe(3000);
  });

  it('이미지 첫 번째 → imageType "REPRESENTATIVE", 나머지 → "DETAIL"로 설정된다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');
    const images = payload.items[0].images;

    expect(images[0].imageType).toBe('REPRESENTATIVE');
    expect(images[0].imageOrder).toBe(0);
    expect(images[1].imageType).toBe('DETAIL');
    expect(images[2].imageType).toBe('DETAIL');
  });

  it('이미지 URL이 vendorPath에 그대로 저장된다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');
    const images = payload.items[0].images;

    expect(images[0].vendorPath).toBe('https://example.com/img1.jpg');
    expect(images[1].vendorPath).toBe('https://example.com/img2.jpg');
  });

  it('originalPrice 미지정 시 → salePrice 값으로 fallback된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ originalPrice: undefined }),
      makeCoupangSpecific(),
      'vendor',
    );

    expect(payload.items[0].originalPrice).toBe(19900);
  });

  it('originalPrice 명시 시 → originalPrice 값이 그대로 사용된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ originalPrice: 29900 }),
      makeCoupangSpecific(),
      'vendor',
    );

    expect(payload.items[0].originalPrice).toBe(29900);
  });

  it('이미지 1개만 있을 때 → REPRESENTATIVE 1개만 존재하고 오류 없이 처리된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ thumbnailImages: ['https://example.com/single.jpg'] }),
      makeCoupangSpecific(),
      'vendor',
    );
    const images = payload.items[0].images;

    expect(images).toHaveLength(1);
    expect(images[0].imageType).toBe('REPRESENTATIVE');
  });

  it('maximumBuyCount / maximumBuyForPerson 미지정 시 기본값 999 / 0 이 적용된다', () => {
    const payload = buildCoupangPayload(
      makeCommon(),
      makeCoupangSpecific({ maximumBuyCount: undefined, maximumBuyForPerson: undefined }),
      'vendor',
    );

    expect(payload.items[0].maximumBuyCount).toBe(999);
    expect(payload.items[0].maximumBuyForPerson).toBe(0);
  });

  it('outboundShippingPlaceCode / returnCenterCode 가 deliveryInfo에 반영된다', () => {
    const payload = buildCoupangPayload(
      makeCommon(),
      makeCoupangSpecific({
        outboundShippingPlaceCode: 'OUT-XYZ',
        returnCenterCode: 'RET-ABC',
      }),
      'vendor',
    );

    expect(payload.deliveryInfo.outboundShippingPlaceCode).toBe('OUT-XYZ');
    expect(payload.deliveryInfo.returnCenterCode).toBe('RET-ABC');
  });

  it('returnCharge 가 deliveryInfo.deliveryChargeOnReturn 과 최상위 returnCharge 양쪽에 반영된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ returnCharge: 7000 }),
      makeCoupangSpecific(),
      'vendor',
    );

    expect(payload.deliveryInfo.deliveryChargeOnReturn).toBe(7000);
    expect(payload.returnCharge).toBe(7000);
  });

  it('saleEndedAt 은 항상 "2099-12-31T23:59:59" 이다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');

    expect(payload.saleEndedAt).toBe('2099-12-31T23:59:59');
  });

  it('notices 배열에 4개의 필수 고지 항목이 포함된다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');

    expect(payload.items[0].notices).toHaveLength(4);
  });

  it('description 이 HTML contentDetails에 그대로 삽입된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ description: '<p>핵심 설명</p>' }),
      makeCoupangSpecific(),
      'vendor',
    );

    const detail = payload.items[0].contents[0].contentDetails[0];
    expect(detail.content).toBe('<p>핵심 설명</p>');
    expect(detail.detailType).toBe('HTML');
  });
});

// ---------------------------------------------------------------------------
// buildNaverPayload 테스트
// ---------------------------------------------------------------------------

describe('buildNaverPayload', () => {
  it('기본 입력 → originProduct.name, originProduct.salePrice 가 올바르게 변환된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;

    expect(origin.name).toBe('테스트 상품명');
    expect(origin.salePrice).toBe(19900);
  });

  it('leafCategoryId 가 originProduct.leafCategoryId 에 반영된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ leafCategoryId: '99999' }));
    const origin = payload.originProduct as Record<string, unknown>;

    expect(origin.leafCategoryId).toBe('99999');
  });

  it('deliveryCharge === 0 → deliveryFeeType 이 "FREE"로 설정된다', () => {
    const payload = buildNaverPayload(makeCommon({ deliveryCharge: 0 }), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;
    const deliveryFee = (origin.deliveryInfo as Record<string, unknown>).deliveryFee as Record<string, unknown>;

    expect(deliveryFee.deliveryFeeType).toBe('FREE');
    expect(deliveryFee.baseFee).toBe(0);
  });

  it('deliveryCharge > 0 → deliveryFeeType 이 "PAID"로 설정된다', () => {
    const payload = buildNaverPayload(
      makeCommon({ deliveryCharge: 3000, deliveryChargeType: 'NOT_FREE' }),
      makeNaverSpecific(),
    );
    const origin = payload.originProduct as Record<string, unknown>;
    const deliveryFee = (origin.deliveryInfo as Record<string, unknown>).deliveryFee as Record<string, unknown>;

    expect(deliveryFee.deliveryFeeType).toBe('PAID');
    expect(deliveryFee.baseFee).toBe(3000);
  });

  it('returnFee 명시 시 → claimDeliveryInfo.returnDeliveryFee 에 returnFee 가 사용된다', () => {
    const payload = buildNaverPayload(makeCommon({ returnCharge: 5000 }), makeNaverSpecific({ returnFee: 3000 }));
    const origin = payload.originProduct as Record<string, unknown>;
    const claimInfo = (origin.deliveryInfo as Record<string, unknown>).claimDeliveryInfo as Record<string, unknown>;

    expect(claimInfo.returnDeliveryFee).toBe(3000);
  });

  it('returnFee 미지정 시 → common.returnCharge 가 claimDeliveryInfo.returnDeliveryFee 에 사용된다', () => {
    const payload = buildNaverPayload(makeCommon({ returnCharge: 5000 }), makeNaverSpecific({ returnFee: undefined }));
    const origin = payload.originProduct as Record<string, unknown>;
    const claimInfo = (origin.deliveryInfo as Record<string, unknown>).claimDeliveryInfo as Record<string, unknown>;

    expect(claimInfo.returnDeliveryFee).toBe(5000);
  });

  it('exchangeFee 미지정 시 기본값 8000 이 claimDeliveryInfo.exchangeDeliveryFee 에 사용된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ exchangeFee: undefined }));
    const origin = payload.originProduct as Record<string, unknown>;
    const claimInfo = (origin.deliveryInfo as Record<string, unknown>).claimDeliveryInfo as Record<string, unknown>;

    expect(claimInfo.exchangeDeliveryFee).toBe(8000);
  });

  it('태그 있을 때 → detailAttribute.sellerTags 가 { text } 형식 배열로 생성된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: ['여름', '가벼운'] }));
    const origin = payload.originProduct as Record<string, unknown>;
    const detailAttr = origin.detailAttribute as Record<string, unknown>;

    expect(detailAttr.sellerTags).toEqual([{ text: '여름' }, { text: '가벼운' }]);
  });

  it('태그 없을 때(빈 배열) → detailAttribute.sellerTags 가 설정되지 않는다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: [] }));
    const origin = payload.originProduct as Record<string, unknown>;
    const detailAttr = origin.detailAttribute as Record<string, unknown>;

    expect(detailAttr.sellerTags).toBeUndefined();
  });

  it('태그 undefined 일 때 → detailAttribute.sellerTags 가 설정되지 않는다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: undefined }));
    const origin = payload.originProduct as Record<string, unknown>;
    const detailAttr = origin.detailAttribute as Record<string, unknown>;

    expect(detailAttr.sellerTags).toBeUndefined();
  });

  it('상세설명이 <div>...</div> 로 래핑된다', () => {
    const payload = buildNaverPayload(makeCommon({ description: '본문 내용' }), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;

    expect(origin.detailContent).toBe('<div>본문 내용</div>');
  });

  it('첫 번째 이미지 → representativeImage.url, 나머지 → optionalImages 배열로 분리된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;
    const images = origin.images as Record<string, unknown>;

    expect((images.representativeImage as Record<string, unknown>).url).toBe('https://example.com/img1.jpg');
    expect(images.optionalImages).toHaveLength(2);
    expect((images.optionalImages as { url: string }[])[0].url).toBe('https://example.com/img2.jpg');
  });

  it('이미지 1개일 때 → representativeImage 만 존재하고 optionalImages 는 빈 배열이다', () => {
    const payload = buildNaverPayload(
      makeCommon({ thumbnailImages: ['https://example.com/only.jpg'] }),
      makeNaverSpecific(),
    );
    const origin = payload.originProduct as Record<string, unknown>;
    const images = origin.images as Record<string, unknown>;

    expect((images.representativeImage as Record<string, unknown>).url).toBe('https://example.com/only.jpg');
    expect(images.optionalImages).toHaveLength(0);
  });

  it('stock 값이 originProduct.stockQuantity 에 반영된다', () => {
    const payload = buildNaverPayload(makeCommon({ stock: 50 }), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;

    expect(origin.stockQuantity).toBe(50);
  });

  it('smartstoreChannelProduct 가 항상 포함된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific());

    expect(payload.smartstoreChannelProduct).toBeDefined();
    expect((payload.smartstoreChannelProduct as Record<string, unknown>).naverShoppingRegistration).toBe(true);
  });
});
