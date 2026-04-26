/**
 * useListingStore-both.test.ts
 * useListingStore 의 sharedDraft / bothRegistration 상태 단위 테스트
 *
 * 실제 구현: src/store/useListingStore.ts
 * 전략: MSW server.use() 로 /api/listing/both 및 후속 요청을 오버라이드
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { useListingStore } from '@/store/useListingStore';

// ---------------------------------------------------------------------------
// 헬퍼: 공통 등록 요청 데이터
// ---------------------------------------------------------------------------

const VALID_REGISTER_DATA = {
  name: '테스트 상품',
  salePrice: 19900,
  thumbnailImages: ['https://example.com/img1.jpg'],
  detailImages: [],
  description: '상세 설명',
  coupang: {
    displayCategoryCode: 56137,
  },
  naver: {
    leafCategoryId: '50000803',
  },
};

// ---------------------------------------------------------------------------
// 스토어 상태 리셋 유틸
// ---------------------------------------------------------------------------

function resetStore() {
  useListingStore.setState({
    sharedDraft: {
      name: '',
      salePrice: '',
      originalPrice: '',
      stock: '999',
      thumbnailImages: [],
      detailImages: [],
      description: '',
      deliveryCharge: '0',
      deliveryChargeType: 'FREE',
      returnCharge: '5000',
      tags: [],
      naverPrice: '',
      coupangPrice: '',
      options: null,
      optionsLoading: false,
      optionsError: null,
      currentStep: 1,
      selectedPlatform: 'both',
      rawImageFiles: [],
      detailImageFiles: [],
      detailPageFullHtml: null,
      detailPageSnippet: null,
      detailPageStatus: 'idle',
      detailPageError: null,
      detailPageSkipped: false,
      costPrice: '',
      targetMarginRate: 20,
      coupangCategoryCode: '',
      coupangCategoryPath: '',
      naverCategoryId: '',
      naverCategoryPath: '',
      detailPageEditStatus: 'idle',
      detailPageEditError: null,
      pickedDetailImages: [],
      detailPageSnippetNaver: null,
      categoryHint: '',
    },
    bothRegistration: {
      coupang: { status: 'idle' },
      naver: { status: 'idle' },
    },
    coupangProducts: [],
    coupangNextToken: null,
    naverProducts: [],
    naverTotal: 0,
    naverPage: 1,
    isRegistering: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// MSW 핸들러 팩토리
// ---------------------------------------------------------------------------

/** POST /api/listing/both 응답을 오버라이드 */
function overrideBothHandler(responseBody: Record<string, unknown>, status = 200) {
  server.use(
    http.post('/api/listing/both', () =>
      HttpResponse.json(responseBody, { status }),
    ),
  );
}

/** 후속 목록 조회 요청을 모두 빈 성공으로 오버라이드 */
function overrideListHandlers() {
  server.use(
    http.get('/api/listing/coupang', () =>
      HttpResponse.json({ success: true, data: { items: [], nextToken: null } }),
    ),
    http.get('/api/listing/naver', () =>
      HttpResponse.json({ success: true, data: { items: [], total: 0 } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// sharedDraft 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — sharedDraft', () => {
  beforeEach(() => {
    resetStore();
  });

  it('초기값 확인: stock "999", deliveryChargeType "FREE", returnCharge "5000"', () => {
    const { result } = renderHook(() => useListingStore((s) => s.sharedDraft));

    expect(result.current.stock).toBe('999');
    expect(result.current.deliveryChargeType).toBe('FREE');
    expect(result.current.returnCharge).toBe('5000');
    expect(result.current.deliveryCharge).toBe('0');
    expect(result.current.thumbnailImages).toEqual([]);
    expect(result.current.detailImages).toEqual([]);
    expect(result.current.tags).toEqual([]);
  });

  it('초기값 확인: name, salePrice, originalPrice, description 은 빈 문자열이다', () => {
    const { result } = renderHook(() => useListingStore((s) => s.sharedDraft));

    expect(result.current.name).toBe('');
    expect(result.current.salePrice).toBe('');
    expect(result.current.originalPrice).toBe('');
    expect(result.current.description).toBe('');
  });

  it('updateSharedDraft 부분 업데이트: 지정한 필드만 변경되고 나머지는 유지된다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({ name: '새 상품명' });
    });

    expect(result.current.sharedDraft.name).toBe('새 상품명');
    // 나머지는 초기값 유지
    expect(result.current.sharedDraft.stock).toBe('999');
    expect(result.current.sharedDraft.deliveryChargeType).toBe('FREE');
    expect(result.current.sharedDraft.returnCharge).toBe('5000');
  });

  it('updateSharedDraft 복수 필드 동시 업데이트: 모두 정확히 반영된다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({
        name: '멀티 업데이트',
        salePrice: '29900',
        stock: '50',
      });
    });

    expect(result.current.sharedDraft.name).toBe('멀티 업데이트');
    expect(result.current.sharedDraft.salePrice).toBe('29900');
    expect(result.current.sharedDraft.stock).toBe('50');
    expect(result.current.sharedDraft.returnCharge).toBe('5000');
  });

  it('여러 번 updateSharedDraft 호출 시 누적 적용된다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({ name: '1차 업데이트' });
    });
    act(() => {
      result.current.updateSharedDraft({ salePrice: '15000' });
    });
    act(() => {
      result.current.updateSharedDraft({ description: '설명 추가' });
    });

    expect(result.current.sharedDraft.name).toBe('1차 업데이트');
    expect(result.current.sharedDraft.salePrice).toBe('15000');
    expect(result.current.sharedDraft.description).toBe('설명 추가');
    expect(result.current.sharedDraft.stock).toBe('999');
  });

  it('resetSharedDraft: 초기값으로 완전 복원된다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({
        name: '변경된 이름',
        salePrice: '99900',
        thumbnailImages: ['https://example.com/img.jpg'],
        deliveryChargeType: 'NOT_FREE',
        tags: ['태그1'],
      });
    });
    act(() => {
      result.current.resetSharedDraft();
    });

    expect(result.current.sharedDraft.name).toBe('');
    expect(result.current.sharedDraft.salePrice).toBe('');
    expect(result.current.sharedDraft.thumbnailImages).toEqual([]);
    expect(result.current.sharedDraft.detailImages).toEqual([]);
    expect(result.current.sharedDraft.stock).toBe('999');
    expect(result.current.sharedDraft.deliveryChargeType).toBe('FREE');
    expect(result.current.sharedDraft.tags).toEqual([]);
  });

  it('updateSharedDraft 에서 thumbnailImages 배열 교체가 정상 동작한다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({
        thumbnailImages: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      });
    });

    expect(result.current.sharedDraft.thumbnailImages).toHaveLength(2);
    expect(result.current.sharedDraft.thumbnailImages[0]).toBe('https://example.com/a.jpg');
  });
});

// ---------------------------------------------------------------------------
// bothRegistration 테스트
// ---------------------------------------------------------------------------

describe('useListingStore — bothRegistration', () => {
  beforeEach(() => {
    resetStore();
    // 후속 목록 조회 핸들러를 기본으로 등록
    overrideListHandlers();
  });

  afterEach(() => {
    // setup.ts 의 afterEach 에서 server.resetHandlers() 가 호출되지만
    // 명시적으로 ensure 한다
  });

  it('초기 상태: 쿠팡/네이버 모두 status "idle"이다', () => {
    const { result } = renderHook(() => useListingStore((s) => s.bothRegistration));

    expect(result.current.coupang.status).toBe('idle');
    expect(result.current.naver.status).toBe('idle');
  });

  it('registerBothProducts 호출 직후 즉시 loading 상태로 전환된다', async () => {
    // 응답을 절대 보내지 않는 핸들러 — loading 상태 관찰용
    let resolveResponse!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveResponse = resolve;
    });

    server.use(
      http.post('/api/listing/both', async () => {
        await pendingPromise;
        return HttpResponse.json({
          success: true,
          data: {
            coupang: { success: true, sellerProductId: 1 },
            naver: { success: true, originProductNo: 2, channelProductNo: 3 },
            summary: { totalSucceeded: 2, totalFailed: 0 },
          },
        });
      }),
    );

    const { result } = renderHook(() => useListingStore((s) => s));

    let registerPromise!: Promise<{ coupangSuccess: boolean; naverSuccess: boolean }>;
    act(() => {
      registerPromise = result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    // 즉시 loading 확인
    expect(result.current.bothRegistration.coupang.status).toBe('loading');
    expect(result.current.bothRegistration.naver.status).toBe('loading');

    // 정리: 응답 resolve 후 promise 완료
    resolveResponse();
    await act(async () => { await registerPromise; });
  });

  it('성공 응답: 쿠팡/네이버 모두 status "success"로 전환되고 ID 가 저장된다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 100 },
        naver: { success: true, originProductNo: 200, channelProductNo: 300 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.bothRegistration.coupang.status).toBe('success');
    expect(result.current.bothRegistration.coupang.sellerProductId).toBe(100);
    expect(result.current.bothRegistration.naver.status).toBe('success');
    expect(result.current.bothRegistration.naver.originProductNo).toBe(200);
    expect(result.current.bothRegistration.naver.channelProductNo).toBe(300);
  });

  it('성공 응답: 반환값 { coupangSuccess: true, naverSuccess: true }', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 1 },
        naver: { success: true, originProductNo: 2, channelProductNo: 3 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));
    let returnValue: { coupangSuccess: boolean; naverSuccess: boolean } | undefined;

    await act(async () => {
      returnValue = await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(returnValue).toEqual({ coupangSuccess: true, naverSuccess: true });
  });

  it('부분 성공 (쿠팡만 성공): 쿠팡은 "success", 네이버는 "error"로 전환된다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 100 },
        naver: { success: false, error: '네이버 API 오류' },
        summary: { totalSucceeded: 1, totalFailed: 1 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.bothRegistration.coupang.status).toBe('success');
    expect(result.current.bothRegistration.naver.status).toBe('error');
    expect(result.current.bothRegistration.naver.error).toBe('네이버 API 오류');
  });

  it('부분 성공 (네이버만 성공): 네이버는 "success", 쿠팡은 "error"로 전환된다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: false, error: '쿠팡 카테고리 오류' },
        naver: { success: true, originProductNo: 500, channelProductNo: 600 },
        summary: { totalSucceeded: 1, totalFailed: 1 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.bothRegistration.coupang.status).toBe('error');
    expect(result.current.bothRegistration.coupang.error).toBe('쿠팡 카테고리 오류');
    expect(result.current.bothRegistration.naver.status).toBe('success');
    expect(result.current.bothRegistration.naver.originProductNo).toBe(500);
  });

  it('부분 성공 반환값: { coupangSuccess: true, naverSuccess: false }', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 1 },
        naver: { success: false, error: '실패' },
        summary: { totalSucceeded: 1, totalFailed: 1 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));
    let returnValue: { coupangSuccess: boolean; naverSuccess: boolean } | undefined;

    await act(async () => {
      returnValue = await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(returnValue).toEqual({ coupangSuccess: true, naverSuccess: false });
  });

  it('HTTP 에러 응답 (ok: false): 쿠팡/네이버 모두 "error" 처리된다', async () => {
    overrideBothHandler(
      { success: false, error: '서버 내부 오류' },
      500,
    );

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.bothRegistration.coupang.status).toBe('error');
    expect(result.current.bothRegistration.naver.status).toBe('error');
    // 스토어는 json.error ?? '요청 실패' 를 사용
    expect(result.current.bothRegistration.coupang.error).toBe('서버 내부 오류');
  });

  it('네트워크 오류 시뮬레이션: 쿠팡/네이버 모두 "error"로 전환된다', async () => {
    // MSW 에서 네트워크 에러 시뮬레이션
    server.use(
      http.post('/api/listing/both', () => {
        return HttpResponse.error();
      }),
    );

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.bothRegistration.coupang.status).toBe('error');
    expect(result.current.bothRegistration.naver.status).toBe('error');
    // 네트워크 오류는 catch 블록으로 가서 err.message 가 저장됨
    expect(result.current.bothRegistration.coupang.error).toBeDefined();
  });

  it('네트워크 오류 반환값: { coupangSuccess: false, naverSuccess: false }', async () => {
    server.use(
      http.post('/api/listing/both', () => HttpResponse.error()),
    );

    const { result } = renderHook(() => useListingStore((s) => s));
    let returnValue: { coupangSuccess: boolean; naverSuccess: boolean } | undefined;

    await act(async () => {
      returnValue = await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(returnValue).toEqual({ coupangSuccess: false, naverSuccess: false });
  });

  it('resetBothRegistration: 성공 이후 idle 로 완전 복원된다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 1 },
        naver: { success: true, originProductNo: 2, channelProductNo: 3 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    // 성공 상태 확인
    expect(result.current.bothRegistration.coupang.status).toBe('success');

    // 리셋
    act(() => {
      result.current.resetBothRegistration();
    });

    expect(result.current.bothRegistration.coupang.status).toBe('idle');
    expect(result.current.bothRegistration.naver.status).toBe('idle');
    expect(result.current.bothRegistration.coupang.sellerProductId).toBeUndefined();
    expect(result.current.bothRegistration.naver.originProductNo).toBeUndefined();
  });

  it('기존 isRegistering 상태는 registerBothProducts 에 영향받지 않는다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 1 },
        naver: { success: true, originProductNo: 2, channelProductNo: 3 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    expect(result.current.isRegistering).toBe(false);

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    // registerBothProducts 는 isRegistering 을 건드리지 않음
    expect(result.current.isRegistering).toBe(false);
  });

  it('registerCoupangProduct, registerNaverProduct 액션이 여전히 존재한다', () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    expect(typeof result.current.registerCoupangProduct).toBe('function');
    expect(typeof result.current.registerNaverProduct).toBe('function');
  });

  it('bothRegistration 성공 후 sharedDraft 는 변경되지 않는다', async () => {
    const { result } = renderHook(() => useListingStore((s) => s));

    act(() => {
      result.current.updateSharedDraft({ name: '유지되어야 함' });
    });

    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 1 },
        naver: { success: true, originProductNo: 2, channelProductNo: 3 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });

    expect(result.current.sharedDraft.name).toBe('유지되어야 함');
  });

  it('resetBothRegistration 후 다시 등록하면 loading → success 로 정상 전환된다', async () => {
    overrideBothHandler({
      success: true,
      data: {
        coupang: { success: true, sellerProductId: 99 },
        naver: { success: true, originProductNo: 88, channelProductNo: 77 },
        summary: { totalSucceeded: 2, totalFailed: 0 },
      },
    });

    const { result } = renderHook(() => useListingStore((s) => s));

    // 첫 번째 등록
    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });
    expect(result.current.bothRegistration.coupang.status).toBe('success');

    // 리셋
    act(() => { result.current.resetBothRegistration(); });
    expect(result.current.bothRegistration.coupang.status).toBe('idle');

    // 두 번째 등록
    await act(async () => {
      await result.current.registerBothProducts(VALID_REGISTER_DATA);
    });
    expect(result.current.bothRegistration.coupang.status).toBe('success');
    expect(result.current.bothRegistration.coupang.sellerProductId).toBe(99);
  });
});
