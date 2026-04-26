/**
 * listing-both.test.ts
 * POST /api/listing/both Route Handler 통합 테스트
 *
 * 실제 구현: src/app/api/listing/both/route.ts
 * 의존성:
 *   - @/lib/listing/coupang-client → getCoupangClient 를 vi.mock
 *   - @/lib/listing/naver-commerce-client → getNaverCommerceClient 를 vi.mock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// 쿠팡 클라이언트 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/listing/coupang-client', () => {
  const mockRegisterProduct = vi.fn();
  const mockGetOutboundShippingPlaces = vi.fn();
  const mockGetReturnShippingCenters = vi.fn();
  const mockGetOutboundShippingPlaceCode = vi.fn().mockReturnValue('DEFAULT-OUT');
  const mockGetReturnCenterCode = vi.fn().mockReturnValue('DEFAULT-RET');
  const mockGetCategoryMeta = vi.fn().mockResolvedValue({ noticeCategories: [] });

  return {
    getCoupangClient: vi.fn(() => ({
      vendor: 'A0000012345',
      registerProduct: mockRegisterProduct,
      getOutboundShippingPlaces: mockGetOutboundShippingPlaces,
      getReturnShippingCenters: mockGetReturnShippingCenters,
      getOutboundShippingPlaceCode: mockGetOutboundShippingPlaceCode,
      getReturnCenterCode: mockGetReturnCenterCode,
      getCategoryMeta: mockGetCategoryMeta,
    })),
    // 클래스 자체도 export 되어 있으므로 빈 클래스로 대체
    CoupangClient: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// 네이버 클라이언트 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/listing/naver-commerce-client', () => {
  const mockRegisterProduct = vi.fn();
  const mockUploadImagesFromUrls = vi.fn().mockResolvedValue(['https://img.naver.com/uploaded.jpg']);

  return {
    getNaverCommerceClient: vi.fn(() => ({
      registerProduct: mockRegisterProduct,
      uploadImagesFromUrls: mockUploadImagesFromUrls,
    })),
    NaverCommerceClient: vi.fn(),
  };
});

import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { POST } from '@/app/api/listing/both/route';

// ---------------------------------------------------------------------------
// 픽스처 헬퍼
// ---------------------------------------------------------------------------

/** 유효한 최소 payload */
const VALID_PAYLOAD = {
  name: '자동 등록 테스트 상품',
  salePrice: 19900,
  thumbnailImages: ['https://example.com/img1.jpg'],
  description: '<p>상세 설명입니다.</p>',
  coupang: {
    displayCategoryCode: 56137,
    outboundShippingPlaceCode: 'OUT-001',
    returnCenterCode: 'RET-001',
  },
  naver: {
    leafCategoryId: '50000803',
  },
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/listing/both', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 클라이언트 mock accessor 헬퍼
// ---------------------------------------------------------------------------

function getCoupangMocks() {
  const client = (getCoupangClient as ReturnType<typeof vi.fn>)();
  return {
    registerProduct: client.registerProduct as ReturnType<typeof vi.fn>,
    getOutboundShippingPlaces: client.getOutboundShippingPlaces as ReturnType<typeof vi.fn>,
    getReturnShippingCenters: client.getReturnShippingCenters as ReturnType<typeof vi.fn>,
    getOutboundShippingPlaceCode: client.getOutboundShippingPlaceCode as ReturnType<typeof vi.fn>,
    getReturnCenterCode: client.getReturnCenterCode as ReturnType<typeof vi.fn>,
    getCategoryMeta: client.getCategoryMeta as ReturnType<typeof vi.fn>,
  };
}

function getNaverMocks() {
  const client = (getNaverCommerceClient as ReturnType<typeof vi.fn>)();
  return {
    registerProduct: client.registerProduct as ReturnType<typeof vi.fn>,
    uploadImagesFromUrls: client.uploadImagesFromUrls as ReturnType<typeof vi.fn>,
  };
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/listing/both', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 출고지/반품지 기본 응답 (대부분 테스트에서 outbound/return 코드를 직접 지정하므로
    // 자동 조회 경로는 빈 배열 반환으로 충분)
    const { getOutboundShippingPlaces, getReturnShippingCenters } = getCoupangMocks();
    getOutboundShippingPlaces.mockResolvedValue([]);
    getReturnShippingCenters.mockResolvedValue([]);
  });

  // ─── 양쪽 성공 ───────────────────────────────────────────────────────────

  it('쿠팡+네이버 모두 성공 → HTTP 200, summary.totalSucceeded === 2', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockResolvedValueOnce({ sellerProductId: 111 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 222, smartstoreChannelProductNo: 333 });

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.summary.totalSucceeded).toBe(2);
    expect(json.data.summary.totalFailed).toBe(0);
    expect(json.data.coupang.success).toBe(true);
    expect(json.data.coupang.sellerProductId).toBe(111);
    expect(json.data.naver.success).toBe(true);
    expect(json.data.naver.originProductNo).toBe(222);
    expect(json.data.naver.channelProductNo).toBe(333);
  });

  // ─── 부분 성공: 쿠팡만 성공 ───────────────────────────────────────────────

  it('쿠팡 성공, 네이버 API 실패 → HTTP 200, summary.totalSucceeded === 1, naver.success === false', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockResolvedValueOnce({ sellerProductId: 111 });
    naverRegister.mockRejectedValueOnce(new Error('네이버 상품 등록 실패'));

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(1);
    expect(json.data.summary.totalFailed).toBe(1);
    expect(json.data.coupang.success).toBe(true);
    expect(json.data.naver.success).toBe(false);
    expect(json.data.naver.error).toBe('네이버 상품 등록 실패');
  });

  // ─── 부분 성공: 네이버만 성공 ────────────────────────────────────────────

  it('네이버 성공, 쿠팡 API 실패 → HTTP 200, summary.totalSucceeded === 1, coupang.success === false', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockRejectedValueOnce(new Error('쿠팡 카테고리 코드 오류'));
    naverRegister.mockResolvedValueOnce({ originProductNo: 999, smartstoreChannelProductNo: 888 });

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(1);
    expect(json.data.coupang.success).toBe(false);
    expect(json.data.coupang.error).toBe('쿠팡 카테고리 코드 오류');
    expect(json.data.naver.success).toBe(true);
    expect(json.data.naver.originProductNo).toBe(999);
  });

  // ─── 양쪽 실패 ───────────────────────────────────────────────────────────

  it('쿠팡+네이버 모두 실패 → HTTP 200, summary.totalSucceeded === 0', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockRejectedValueOnce(new Error('쿠팡 서버 오류'));
    naverRegister.mockRejectedValueOnce(new Error('네이버 서버 오류'));

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(0);
    expect(json.data.summary.totalFailed).toBe(2);
    expect(json.data.coupang.success).toBe(false);
    expect(json.data.naver.success).toBe(false);
  });

  it('양쪽 실패 시 에러 메시지가 각 플랫폼 result 에 포함된다', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockRejectedValueOnce(new Error('[쿠팡] 500: Internal Server Error'));
    naverRegister.mockRejectedValueOnce(new Error('[네이버] 400: 카테고리 불일치'));

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(json.data.coupang.error).toBe('[쿠팡] 500: Internal Server Error');
    expect(json.data.naver.error).toBe('[네이버] 400: 카테고리 불일치');
  });

  // ─── Zod 검증 실패 ───────────────────────────────────────────────────────

  it('name 필드 누락 → HTTP 400, details.name 에 오류 정보 포함', async () => {
    const { name: _name, ...withoutName } = VALID_PAYLOAD;
    const res = await POST(makeRequest(withoutName));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('검증 실패');
    expect(json.details).toBeDefined();
  });

  it('salePrice 누락 → HTTP 400', async () => {
    const { salePrice: _sp, ...withoutPrice } = VALID_PAYLOAD;
    const res = await POST(makeRequest(withoutPrice));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('thumbnailImages 필드 누락 → HTTP 400', async () => {
    const { thumbnailImages: _img, ...withoutImages } = VALID_PAYLOAD;
    const res = await POST(makeRequest(withoutImages));
    const json = await res.json();

    expect(res.status).toBe(400);
  });

  it('naver.leafCategoryId 누락 → HTTP 400', async () => {
    const body = {
      ...VALID_PAYLOAD,
      naver: {},
    };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details?.naver).toBeDefined();
  });

  it('coupang 객체 누락 → 네이버만 등록, 쿠팡 skipped (HTTP 200)', async () => {
    const { registerProduct: naverRegister } = getNaverMocks();
    naverRegister.mockResolvedValueOnce({ originProductNo: 222, smartstoreChannelProductNo: 333 });

    const { coupang: _c, ...withoutCoupang } = VALID_PAYLOAD;
    const res = await POST(makeRequest(withoutCoupang));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.naver.success).toBe(true);
    expect(json.data.coupang.success).toBe(false);
    expect(json.data.coupang.skipped).toBe(true);
  });

  // ─── 경계값: 이미지 URL 개수 ─────────────────────────────────────────────

  it('이미지 URL 10개 → 검증 통과 (경계값)', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();
    coupangRegister.mockResolvedValueOnce({ sellerProductId: 1 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 2, smartstoreChannelProductNo: 3 });

    const body = {
      ...VALID_PAYLOAD,
      thumbnailImages: Array.from({ length: 10 }, (_, i) => `https://example.com/img${i + 1}.jpg`),
    };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(2);
  });

  it('이미지 URL 11개 초과 → HTTP 400', async () => {
    const body = {
      ...VALID_PAYLOAD,
      thumbnailImages: Array.from({ length: 11 }, (_, i) => `https://example.com/img${i + 1}.jpg`),
    };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('이미지 URL 0개 (빈 배열) → HTTP 400 (min 1)', async () => {
    const body = { ...VALID_PAYLOAD, thumbnailImages: [] };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
  });

  // ─── 경계값: 판매가 ───────────────────────────────────────────────────────

  it('salePrice 100 (최솟값) → 검증 통과', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();
    coupangRegister.mockResolvedValueOnce({ sellerProductId: 1 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 2, smartstoreChannelProductNo: 3 });

    const body = { ...VALID_PAYLOAD, salePrice: 100 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(2);
  });

  it('salePrice 99 (최솟값 미만) → HTTP 400', async () => {
    const body = { ...VALID_PAYLOAD, salePrice: 99 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('salePrice 0 → HTTP 400', async () => {
    const body = { ...VALID_PAYLOAD, salePrice: 0 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
  });

  it('salePrice 음수 → HTTP 400', async () => {
    const body = { ...VALID_PAYLOAD, salePrice: -1000 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
  });

  // ─── 유효하지 않은 JSON ───────────────────────────────────────────────────

  it('유효하지 않은 JSON 바디 → HTTP 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/listing/both', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {{{',
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('JSON');
  });

  // ─── 출고지/반품지 자동 조회 ─────────────────────────────────────────────

  it('outboundShippingPlaceCode 미지정 시 getOutboundShippingPlaceCode 가 사용된다', async () => {
    const { registerProduct: coupangRegister, getOutboundShippingPlaceCode, getReturnCenterCode } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    coupangRegister.mockResolvedValueOnce({ sellerProductId: 777 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 888, smartstoreChannelProductNo: 999 });

    // outboundShippingPlaceCode / returnCenterCode 를 제거한 payload
    const body = {
      ...VALID_PAYLOAD,
      coupang: {
        displayCategoryCode: 56137,
        // outboundShippingPlaceCode, returnCenterCode 없음 → 클라이언트 메서드로 조회
      },
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(2);
    expect(getOutboundShippingPlaceCode).toHaveBeenCalledTimes(1);
    expect(getReturnCenterCode).toHaveBeenCalledTimes(1);
  });

  // ─── 선택 필드 기본값 ────────────────────────────────────────────────────

  it('stock / deliveryCharge / returnCharge / deliveryChargeType 미지정 시 스키마 기본값이 적용된다', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();
    coupangRegister.mockResolvedValueOnce({ sellerProductId: 1 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 2, smartstoreChannelProductNo: 3 });

    // stock, deliveryCharge, returnCharge 미지정
    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // 핸들러가 200을 반환하면 Zod 기본값이 정상 적용된 것
  });

  // ─── Error 가 아닌 값이 reject 될 때 ─────────────────────────────────────

  it('클라이언트가 Error 객체가 아닌 값으로 reject 하면 "알 수 없는 오류" 메시지가 반환된다', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();

    // eslint-disable-next-line prefer-promise-reject-errors
    coupangRegister.mockReturnValueOnce(Promise.reject('문자열 오류'));
    naverRegister.mockResolvedValueOnce({ originProductNo: 2, smartstoreChannelProductNo: 3 });

    const res = await POST(makeRequest(VALID_PAYLOAD));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.coupang.success).toBe(false);
    expect(json.data.coupang.error).toBe('알 수 없는 오류');
  });

  // ─── originalPrice 선택 필드 ─────────────────────────────────────────────

  it('originalPrice 지정 시 정상 처리된다', async () => {
    const { registerProduct: coupangRegister } = getCoupangMocks();
    const { registerProduct: naverRegister } = getNaverMocks();
    coupangRegister.mockResolvedValueOnce({ sellerProductId: 1 });
    naverRegister.mockResolvedValueOnce({ originProductNo: 2, smartstoreChannelProductNo: 3 });

    const body = { ...VALID_PAYLOAD, originalPrice: 29900 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalSucceeded).toBe(2);
  });

  it('originalPrice 가 100 미만이면 → HTTP 400', async () => {
    const body = { ...VALID_PAYLOAD, originalPrice: 50 };
    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
  });
});
