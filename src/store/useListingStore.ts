/**
 * useListingStore.ts
 * 오픈마켓 상품 자동등록 전역 상태 관리 (Zustand + devtools)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PlatformId, ProductListing } from '@/types/listing';

// ─── SharedDraft 타입 ────────────────────────────────────────────────────────
// 탭 이동 시에도 입력값이 유지되도록 공통 필드를 스토어에서 관리
interface SharedDraft {
  name: string;
  salePrice: string;         // 공통 판매가 — 채널별 가격 미입력 시 fallback
  naverPrice: string;        // 네이버 전용 판매가 (선택, 입력 시 salePrice 대신 사용)
  coupangPrice: string;      // 쿠팡 전용 판매가 (선택, 입력 시 salePrice 대신 사용)
  originalPrice: string;
  stock: string;
  thumbnailImages: string[]; // 상품 목록/상단 이미지 (최소 1개 필요)
  detailImages: string[];    // 상세페이지 이미지 (선택사항)
  description: string;
  deliveryCharge: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
  returnCharge: string;
  tags: string[];            // 공통 태그 (네이버에서 주로 사용)
}

const SHARED_DRAFT_INITIAL: SharedDraft = {
  name: '',
  salePrice: '',
  naverPrice: '',
  coupangPrice: '',
  originalPrice: '',
  stock: '999',
  thumbnailImages: [],
  detailImages: [],
  description: '',
  deliveryCharge: '0',
  deliveryChargeType: 'FREE',
  returnCharge: '5000',
  tags: [],
};

// ─── BothRegistration 타입 ───────────────────────────────────────────────────
// 동시 등록 진행 상태
type PlatformStatus = 'idle' | 'loading' | 'success' | 'error';

interface BothRegistrationState {
  coupang: {
    status: PlatformStatus;
    sellerProductId?: number;
    error?: string;
  };
  naver: {
    status: PlatformStatus;
    originProductNo?: number;
    channelProductNo?: number;
    error?: string;
  };
}

const BOTH_REGISTRATION_INITIAL: BothRegistrationState = {
  coupang: { status: 'idle' },
  naver: { status: 'idle' },
};

interface CoupangProduct {
  sellerProductId: number;
  sellerProductName: string;
  displayCategoryCode: number;
  productId: number;
  vendorId: string;
  brand: string;
  statusName: string;
  createdAt: string;
  saleStartedAt: string;
  saleEndedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoupangProductDetail = Record<string, any>;

interface NaverProduct {
  originProductNo: number;
  channelProductNo: number;
  name: string;
  statusType: string;
  salePrice: number;
  stockQuantity: number;
  categoryName: string;
  categoryId: string;
  imageUrl: string | null;
  deliveryFee: number;
  returnFee: number;
  exchangeFee: number;
  tags: string[];
  regDate: string;
  modifiedDate: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NaverProductDetail = Record<string, any>;

interface ListingStore {
  // ─── 상태 ─────────────────────────────────────────────────────────────────
  activePlatform: PlatformId;
  listings: ProductListing[];
  coupangProducts: CoupangProduct[];
  coupangNextToken: string | null;
  editingProduct: CoupangProductDetail | null;
  naverProducts: NaverProduct[];
  naverTotal: number;
  naverPage: number;
  editingNaverProduct: NaverProductDetail | null;
  isLoading: boolean;
  isRegistering: boolean;
  error: string | null;

  // ─── 액션 ─────────────────────────────────────────────────────────────────
  setActivePlatform: (p: PlatformId) => void;
  fetchListings: () => Promise<void>;
  fetchCoupangProducts: (reset?: boolean) => Promise<void>;
  fetchCoupangProductDetail: (sellerProductId: number) => Promise<CoupangProductDetail | null>;
  registerCoupangProduct: (data: {
    displayCategoryCode: number;
    sellerProductName: string;
    brand?: string;
    salePrice: number;
    originalPrice?: number;
    stock?: number;
    thumbnailImages: string[];
    detailImages?: string[];
    description: string;
    deliveryChargeType?: string;
    deliveryCharge?: number;
    returnCharge?: number;
  }) => Promise<{ sellerProductId: number } | null>;
  updateCoupangProduct: (sellerProductId: number, data: Record<string, unknown>) => Promise<boolean>;
  setEditingProduct: (product: CoupangProductDetail | null) => void;
  // 네이버
  fetchNaverProducts: (page?: number) => Promise<void>;
  fetchNaverProductDetail: (originProductNo: number) => Promise<NaverProductDetail | null>;
  registerNaverProduct: (data: Record<string, unknown>) => Promise<{ originProductNo: number } | null>;
  updateNaverProduct: (originProductNo: number, data: Record<string, unknown>) => Promise<boolean>;
  setEditingNaverProduct: (product: NaverProductDetail | null) => void;
  clearError: () => void;

  // ─── SharedDraft 액션 ───────────────────────────────────────────────────────
  sharedDraft: SharedDraft;
  updateSharedDraft: (patch: Partial<SharedDraft>) => void;
  resetSharedDraft: () => void;

  // ─── BothRegistration 액션 ──────────────────────────────────────────────────
  bothRegistration: BothRegistrationState;
  registerBothProducts: (data: {
    name: string;
    salePrice: number;
    naverPrice?: number;    // 네이버 전용 판매가 (미입력 시 salePrice 사용)
    coupangPrice?: number;  // 쿠팡 전용 판매가 (미입력 시 salePrice 사용)
    originalPrice?: number;
    stock?: number;
    thumbnailImages: string[];
    detailImages?: string[];
    description: string;
    deliveryCharge?: number;
    deliveryChargeType?: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
    returnCharge?: number;
    coupang: {
      displayCategoryCode: number;
      brand?: string;
      maximumBuyCount?: number;
      maximumBuyForPerson?: number;
    };
    naver: {
      leafCategoryId: string;
      tags?: string[];
      exchangeFee?: number;
    };
  }) => Promise<{ coupangSuccess: boolean; naverSuccess: boolean }>;
  resetBothRegistration: () => void;
}

export const useListingStore = create<ListingStore>()(
  devtools(
    (set, get) => ({
      // ─── 초기값 ────────────────────────────────────────────────────────────
      activePlatform: 'coupang',
      listings: [],
      coupangProducts: [],
      coupangNextToken: null,
      editingProduct: null,
      naverProducts: [],
      naverTotal: 0,
      naverPage: 1,
      editingNaverProduct: null,
      isLoading: false,
      isRegistering: false,
      error: null,

      // ─── 활성 플랫폼 변경 ──────────────────────────────────────────────────
      setActivePlatform: (p) => set({ activePlatform: p }, false, 'listing/setActivePlatform'),

      // ─── 등록 목록 조회 ────────────────────────────────────────────────────
      fetchListings: async () => {
        set({ isLoading: true, error: null }, false, 'listing/fetchListings/start');
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          set({ listings: [], isLoading: false }, false, 'listing/fetchListings/success');
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
          set({ error: message, isLoading: false }, false, 'listing/fetchListings/error');
        }
      },

      // ─── 쿠팡 상품 상세 조회 ──────────────────────────────────────────────
      fetchCoupangProductDetail: async (sellerProductId: number) => {
        set({ isLoading: true, error: null }, false, 'listing/fetchCoupangDetail/start');
        try {
          const res = await fetch(`/api/listing/coupang/${sellerProductId}`);
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `조회 실패 (${res.status})`);
          }
          const detail = json.data as CoupangProductDetail;
          set({ editingProduct: detail, isLoading: false }, false, 'listing/fetchCoupangDetail/success');
          return detail;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : '상품 조회 실패',
            isLoading: false,
          }, false, 'listing/fetchCoupangDetail/error');
          return null;
        }
      },

      // ─── 쿠팡 상품 수정 ────────────────────────────────────────────────────
      updateCoupangProduct: async (sellerProductId, data) => {
        set({ isRegistering: true, error: null }, false, 'listing/updateCoupang/start');
        try {
          const res = await fetch(`/api/listing/coupang/${sellerProductId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `수정 실패 (${res.status})`);
          }
          set({ isRegistering: false, editingProduct: null }, false, 'listing/updateCoupang/success');
          await get().fetchCoupangProducts(true);
          return true;
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : '상품 수정 실패',
            isRegistering: false,
          }, false, 'listing/updateCoupang/error');
          return false;
        }
      },

      // ─── 편집 상태 설정 ────────────────────────────────────────────────────
      setEditingProduct: (product) => set({ editingProduct: product }, false, 'listing/setEditingProduct'),

      // ─── 쿠팡 상품 목록 조회 ───────────────────────────────────────────────
      fetchCoupangProducts: async (reset = false) => {
        const state = get();
        if (state.isLoading) return;

        const nextToken = reset ? '' : (state.coupangNextToken ?? '');
        set({ isLoading: true, error: null }, false, 'listing/fetchCoupang/start');

        try {
          const res = await fetch(
            `/api/listing/coupang?status=APPROVED&maxPerPage=20&nextToken=${encodeURIComponent(nextToken)}`,
          );
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `조회 실패 (${res.status})`);
          }

          const items = json.data?.items ?? [];
          set({
            coupangProducts: reset ? items : [...state.coupangProducts, ...items],
            coupangNextToken: json.data?.nextToken ?? null,
            isLoading: false,
          }, false, 'listing/fetchCoupang/success');
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : '쿠팡 상품 로드 실패',
            isLoading: false,
          }, false, 'listing/fetchCoupang/error');
        }
      },

      // ─── 쿠팡 상품 등록 ───────────────────────────────────────────────────
      registerCoupangProduct: async (data) => {
        set({ isRegistering: true, error: null }, false, 'listing/registerCoupang/start');

        try {
          const res = await fetch('/api/listing/coupang', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `등록 실패 (${res.status})`);
          }

          set({ isRegistering: false }, false, 'listing/registerCoupang/success');

          // 목록 갱신
          await get().fetchCoupangProducts(true);

          return json.data;
        } catch (err) {
          const message = err instanceof Error ? err.message : '상품 등록 실패';
          set({ error: message, isRegistering: false }, false, 'listing/registerCoupang/error');
          return null;
        }
      },

      // ─── 네이버 상품 목록 조회 ─────────────────────────────────────────────
      fetchNaverProducts: async (page = 1) => {
        set({ isLoading: true, error: null }, false, 'listing/fetchNaver/start');
        try {
          const res = await fetch(`/api/listing/naver?page=${page}&size=20`);
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error ?? `조회 실패 (${res.status})`);
          set({
            naverProducts: json.data?.items ?? [],
            naverTotal: json.data?.total ?? 0,
            naverPage: page,
            isLoading: false,
          }, false, 'listing/fetchNaver/success');
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '네이버 상품 로드 실패', isLoading: false }, false, 'listing/fetchNaver/error');
        }
      },

      // ─── 네이버 상품 상세 조회 ─────────────────────────────────────────────
      fetchNaverProductDetail: async (originProductNo) => {
        set({ isLoading: true, error: null }, false, 'listing/fetchNaverDetail/start');
        try {
          const res = await fetch(`/api/listing/naver/${originProductNo}`);
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error ?? `조회 실패 (${res.status})`);
          const detail = json.data as NaverProductDetail;
          set({ editingNaverProduct: detail, isLoading: false }, false, 'listing/fetchNaverDetail/success');
          return detail;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '상품 조회 실패', isLoading: false }, false, 'listing/fetchNaverDetail/error');
          return null;
        }
      },

      // ─── 네이버 상품 등록 ──────────────────────────────────────────────────
      registerNaverProduct: async (data) => {
        set({ isRegistering: true, error: null }, false, 'listing/registerNaver/start');
        try {
          const res = await fetch('/api/listing/naver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error ?? `등록 실패 (${res.status})`);
          set({ isRegistering: false }, false, 'listing/registerNaver/success');
          await get().fetchNaverProducts(1);
          return json.data;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '상품 등록 실패', isRegistering: false }, false, 'listing/registerNaver/error');
          return null;
        }
      },

      // ─── 네이버 상품 수정 ──────────────────────────────────────────────────
      updateNaverProduct: async (originProductNo, data) => {
        set({ isRegistering: true, error: null }, false, 'listing/updateNaver/start');
        try {
          const res = await fetch(`/api/listing/naver/${originProductNo}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.error ?? `수정 실패 (${res.status})`);
          set({ isRegistering: false, editingNaverProduct: null }, false, 'listing/updateNaver/success');
          await get().fetchNaverProducts(get().naverPage);
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '상품 수정 실패', isRegistering: false }, false, 'listing/updateNaver/error');
          return false;
        }
      },

      setEditingNaverProduct: (product) => set({ editingNaverProduct: product }, false, 'listing/setEditingNaverProduct'),

      // ─── 에러 초기화 ───────────────────────────────────────────────────────
      clearError: () => set({ error: null }, false, 'listing/clearError'),

      // ─── SharedDraft 초기값 및 액션 ────────────────────────────────────────
      sharedDraft: SHARED_DRAFT_INITIAL,

      updateSharedDraft: (patch) =>
        set(
          (s) => ({ sharedDraft: { ...s.sharedDraft, ...patch } }),
          false,
          'listing/updateSharedDraft',
        ),

      resetSharedDraft: () =>
        set({ sharedDraft: SHARED_DRAFT_INITIAL }, false, 'listing/resetSharedDraft'),

      // ─── BothRegistration 초기값 및 액션 ───────────────────────────────────
      bothRegistration: BOTH_REGISTRATION_INITIAL,

      registerBothProducts: async (data) => {
        // 양쪽 loading으로 설정
        set(
          () => ({
            bothRegistration: {
              coupang: { status: 'loading' },
              naver: { status: 'loading' },
            },
          }),
          false,
          'listing/registerBoth/start',
        );

        try {
          const res = await fetch('/api/listing/both', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            set(
              () => ({
                bothRegistration: {
                  coupang: { status: 'error', error: json.error ?? '요청 실패' },
                  naver: { status: 'error', error: json.error ?? '요청 실패' },
                },
              }),
              false,
              'listing/registerBoth/error',
            );
            return { coupangSuccess: false, naverSuccess: false };
          }

          const { coupang, naver } = json.data;
          set(
            () => ({
              bothRegistration: {
                coupang: coupang.success
                  ? { status: 'success', sellerProductId: coupang.sellerProductId }
                  : { status: 'error', error: coupang.error },
                naver: naver.success
                  ? { status: 'success', originProductNo: naver.originProductNo, channelProductNo: naver.channelProductNo }
                  : { status: 'error', error: naver.error },
              },
            }),
            false,
            'listing/registerBoth/done',
          );

          // 성공한 플랫폼 목록 갱신
          const state = get();
          if (coupang.success) await state.fetchCoupangProducts(true);
          if (naver.success) await state.fetchNaverProducts(1);

          return { coupangSuccess: coupang.success, naverSuccess: naver.success };
        } catch (err) {
          const message = err instanceof Error ? err.message : '동시 등록 오류';
          set(
            () => ({
              bothRegistration: {
                coupang: { status: 'error', error: message },
                naver: { status: 'error', error: message },
              },
            }),
            false,
            'listing/registerBoth/catch',
          );
          return { coupangSuccess: false, naverSuccess: false };
        }
      },

      resetBothRegistration: () =>
        set(
          () => ({ bothRegistration: BOTH_REGISTRATION_INITIAL }),
          false,
          'listing/resetBothRegistration',
        ),
    }),
    { name: 'ListingStore' },
  ),
);
