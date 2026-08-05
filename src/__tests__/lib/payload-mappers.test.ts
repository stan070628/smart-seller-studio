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

  it('deliveryCharge=0 → deliveryChargeType 이 "FREE"로 매핑된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ deliveryCharge: 0 }),
      makeCoupangSpecific(),
      'A0000012345',
    );

    expect(payload.deliveryChargeType).toBe('FREE');
  });

  it('deliveryCharge>0 → deliveryChargeType 이 "NOT_FREE"로 매핑된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ deliveryCharge: 3000 }),
      makeCoupangSpecific(),
      'A0000012345',
    );

    expect(payload.deliveryChargeType).toBe('NOT_FREE');
    expect(payload.deliveryCharge).toBe(3000);
  });

  it('이미지 첫 번째 → imageType "REPRESENTATION", 나머지 → "DETAIL"로 설정된다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');
    const images = payload.items[0].images;

    expect(images[0].imageType).toBe('REPRESENTATION');
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

  it('이미지 1개만 있을 때 → REPRESENTATION 1개만 존재하고 오류 없이 처리된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ thumbnailImages: ['https://example.com/single.jpg'] }),
      makeCoupangSpecific(),
      'vendor',
    );
    const images = payload.items[0].images;

    expect(images).toHaveLength(1);
    expect(images[0].imageType).toBe('REPRESENTATION');
  });

  // 쿠팡에는 별도 재고 필드가 없고 maximumBuyCount 가 판매 가능 수량 역할을 한다.
  // 999 로 하드코딩하면 재고 2개짜리가 999개 주문 가능 상태로 등록된다.
  it('maximumBuyCount 미지정 시 common.stock 이 판매 가능 수량으로 쓰인다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ stock: 2 }),
      makeCoupangSpecific({ maximumBuyCount: undefined, maximumBuyForPerson: undefined }),
      'vendor',
    );

    expect(payload.items[0].maximumBuyCount).toBe(2);
    expect(payload.items[0].maximumBuyForPerson).toBe(0);
  });

  it('maximumBuyCount 를 명시하면 stock 보다 우선한다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ stock: 2 }),
      makeCoupangSpecific({ maximumBuyCount: 5 }),
      'vendor',
    );

    expect(payload.items[0].maximumBuyCount).toBe(5);
  });

  it('outboundShippingPlaceCode / returnCenterCode 가 최상위 필드에 반영된다', () => {
    const payload = buildCoupangPayload(
      makeCommon(),
      makeCoupangSpecific({
        outboundShippingPlaceCode: 'OUT-XYZ',
        returnCenterCode: 'RET-ABC',
      }),
      'vendor',
    );

    expect(payload.outboundShippingPlaceCode).toBe('OUT-XYZ');
    expect(payload.returnCenterCode).toBe('RET-ABC');
  });

  it('returnCharge 가 최상위 returnCharge 및 deliveryChargeOnReturn 양쪽에 반영된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ returnCharge: 7000 }),
      makeCoupangSpecific(),
      'vendor',
    );

    expect(payload.deliveryChargeOnReturn).toBe(7000);
    expect(payload.returnCharge).toBe(7000);
  });

  it('saleEndedAt 은 항상 "2999-01-01T00:00:00" 이다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');

    expect(payload.saleEndedAt).toBe('2999-01-01T00:00:00');
  });

  it('notices 미지정 시 빈 배열이다', () => {
    const payload = buildCoupangPayload(makeCommon(), makeCoupangSpecific(), 'vendor');

    expect(payload.items[0].notices).toHaveLength(0);
  });

  it('description 이 TEXT contentDetails에 그대로 삽입된다', () => {
    const payload = buildCoupangPayload(
      makeCommon({ description: '<p>핵심 설명</p>' }),
      makeCoupangSpecific(),
      'vendor',
    );

    const detail = payload.items[0].contents[0].contentDetails[0];
    expect(detail.content).toBe('<p>핵심 설명</p>');
    expect(detail.detailType).toBe('TEXT');
  });
});

// ---------------------------------------------------------------------------
// buildNaverPayload 테스트
// ---------------------------------------------------------------------------

/** payload → originProduct.detailAttribute */
function naverDetailAttribute(payload: Record<string, unknown>): Record<string, unknown> {
  const origin = payload.originProduct as Record<string, unknown>;
  return origin.detailAttribute as Record<string, unknown>;
}

/** payload → originProduct.detailAttribute.seoInfo */
function naverSeoInfo(payload: Record<string, unknown>): Record<string, unknown> {
  return naverDetailAttribute(payload).seoInfo as Record<string, unknown>;
}

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

  // 네이버는 sellerTags 를 detailAttribute.seoInfo 아래에서만 읽는다.
  // originProduct 직속에 넣으면 400 없이 조용히 무시되어 태그가 통째로 유실된다.
  it('태그 있을 때 → detailAttribute.seoInfo.sellerTags 가 { text } 형식 배열로 생성된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: ['여름', '가벼운'] }));
    const seoInfo = naverSeoInfo(payload);

    expect(seoInfo.sellerTags).toEqual([{ text: '여름' }, { text: '가벼운' }]);
  });

  it('태그를 originProduct 직속에 넣지 않는다 (네이버가 무시하는 위치)', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: ['여름'] }));
    const origin = payload.originProduct as Record<string, unknown>;

    expect(origin.sellerTags).toBeUndefined();
  });

  it('태그 없을 때(빈 배열) → sellerTags 가 설정되지 않는다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: [] }));

    expect(naverSeoInfo(payload).sellerTags).toBeUndefined();
  });

  it('태그 undefined 일 때 → sellerTags 가 설정되지 않는다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ tags: undefined }));

    expect(naverSeoInfo(payload).sellerTags).toBeUndefined();
  });

  // ── 원산지 ────────────────────────────────────────────────
  // 기본값을 '00'(국산)으로 두면 수입품이 국산으로 등록된다 — 표시사항 오기재.
  it('원산지 미지정 시 → 국산("00")이 아니라 "03"(상세설명에 표시)으로 설정된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ originAreaCode: undefined }));
    const originArea = naverDetailAttribute(payload).originAreaInfo as Record<string, unknown>;

    expect(originArea.originAreaCode).toBe('03');
    expect(originArea.originAreaCode).not.toBe('00');
  });

  it('originAreaCode 와 importer 지정 시 → originAreaInfo 에 그대로 반영된다', () => {
    const payload = buildNaverPayload(
      makeCommon(),
      makeNaverSpecific({ originAreaCode: '0205004', importer: '(주)코스트코코리아', countryOfOrigin: '니카라과산' }),
    );
    const originArea = naverDetailAttribute(payload).originAreaInfo as Record<string, unknown>;

    expect(originArea.originAreaCode).toBe('0205004');
    expect(originArea.importer).toBe('(주)코스트코코리아');
    expect(originArea.content).toBe('니카라과산');
  });

  it('원산지가 국내가 아닐 때(02 계열) importer 가 없으면 importer 키를 넣지 않는다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific({ originAreaCode: '0205004' }));
    const originArea = naverDetailAttribute(payload).originAreaInfo as Record<string, unknown>;

    expect('importer' in originArea).toBe(false);
  });

  // ── 출고지/반품지 주소록 ──────────────────────────────────
  it('주소록 ID 지정 시 → claimDeliveryInfo 에 shippingAddressId / returnAddressId 가 포함된다', () => {
    const payload = buildNaverPayload(
      makeCommon(),
      makeNaverSpecific({ shippingAddressId: 200320013, returnAddressId: 200320012 }),
    );
    const origin = payload.originProduct as Record<string, unknown>;
    const claimInfo = (origin.deliveryInfo as Record<string, unknown>).claimDeliveryInfo as Record<string, unknown>;

    expect(claimInfo.shippingAddressId).toBe(200320013);
    expect(claimInfo.returnAddressId).toBe(200320012);
  });

  it('주소록 ID 미지정 시 → 해당 키가 아예 없다 (null 을 보내면 400)', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific());
    const origin = payload.originProduct as Record<string, unknown>;
    const claimInfo = (origin.deliveryInfo as Record<string, unknown>).claimDeliveryInfo as Record<string, unknown>;

    expect('shippingAddressId' in claimInfo).toBe(false);
    expect('returnAddressId' in claimInfo).toBe(false);
  });

  // ── 상품정보제공고시 ──────────────────────────────────────
  it('noticeType 미지정 시 → 기존과 동일하게 ETC 로 생성된다', () => {
    const payload = buildNaverPayload(makeCommon(), makeNaverSpecific());
    const notice = naverDetailAttribute(payload).productInfoProvidedNotice as Record<string, unknown>;

    expect(notice.productInfoProvidedNoticeType).toBe('ETC');
    expect(notice.etc).toBeDefined();
  });

  it('noticeType "WEAR" 지정 시 → wear 키에 고시 항목이 담긴다', () => {
    const payload = buildNaverPayload(
      makeCommon(),
      makeNaverSpecific({
        noticeType: 'WEAR',
        noticeFields: { material: '면 100%', color: '화이트, 블루', size: 'L / XL' },
      }),
    );
    const notice = naverDetailAttribute(payload).productInfoProvidedNotice as Record<string, unknown>;
    const wear = notice.wear as Record<string, unknown>;

    expect(notice.productInfoProvidedNoticeType).toBe('WEAR');
    expect(notice.etc).toBeUndefined();
    expect(wear.material).toBe('면 100%');
    expect(wear.color).toBe('화이트, 블루');
    expect(wear.size).toBe('L / XL');
    // 공통 필수 항목은 기본값으로 채워진다
    expect(wear.afterServiceDirector).toBeTruthy();
    expect(wear.qualityAssuranceStandard).toBeTruthy();
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
