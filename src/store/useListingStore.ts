/**
 * useListingStore.ts
 * 오픈마켓 상품 자동등록 전역 상태 관리 (Zustand + devtools)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PlatformId, ProductListing } from '@/types/listing';
import type { ProductOptions } from '@/types/product-option';
import { parseSpecText } from '@/lib/utils/parseSpecText';
import { normalizeSalesUnitSpecs } from '@/lib/listing/sales-unit';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import { contentToSections } from '@/lib/detail-page/section-parser';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import type { CategoryKey, QuestionAnswer } from '@/lib/conversational-detail/types';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

// ─── SourcingEntry 타입 ─────────────────────────────────────────────────────
export type SourcingEntry = {
  type: 'online' | 'offline';
  value: string;
  costcoStockStatus?: 'inStock' | 'outOfStock' | 'lowStock' | null;
  costcoStockCheckedAt?: string | null;
};

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
  pickedDetailImages: string[]; // 사용자가 선택/정렬한 최종 이미지 URL 목록 (비어있으면 전체 사용)
  sourceUrl?: string | null;   // parse-url에서 추출한 원본 상품 URL
  description: string;
  deliveryCharge: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
  returnCharge: string;
  tags: string[];            // 공통 태그 (네이버에서 주로 사용)
  // 도매꾹 옵션 상태
  options: ProductOptions | null;
  optionsLoading: boolean;
  optionsError: string | null;

  // ─── 워크플로우 메타 ────────────────────────────────────────────────────────
  currentStep: 1 | 2 | 3;
  selectedPlatform: 'coupang' | 'naver' | 'both';

  // ─── AI 상세페이지 관련 ─────────────────────────────────────────────────────
  rawImageFiles: File[];
  detailImageFiles: File[];   // 상세이미지 File 배열 (Step2 AI 생성 시 rawImageFiles와 합산)
  detailPageFullHtml: string | null;
  detailPageSnippet: string | null;
  detailPageSnippetNaver: string | null;
  detailPageStatus: 'idle' | 'studio_editing' | 'analyzing' | 'generating' | 'done' | 'error';
  detailPageError: string | null;
  detailPageSkipped: boolean;

  // ─── 마진 계산기 ────────────────────────────────────────────────────────────
  costPrice: string;
  targetMarginRate: number;

  // ─── 카테고리 ───────────────────────────────────────────────────────────────
  categoryHint: string;        // parse-url에서 추출한 소스 카테고리 힌트 (자동 검색용)
  coupangCategoryCode: string;
  coupangCategoryPath: string;
  naverCategoryId: string;
  naverCategoryPath: string;

  // ─── AI 상세페이지 수정 ─────────────────────────────────────────────────────
  detailPageEditStatus: 'idle' | 'editing' | 'done' | 'error';
  detailPageEditError: string | null;

  // ─── 상세페이지 섹션 편집 ──────────────────────────────────────────────────
  detailPageSections: DetailSection[];
  detailPageTheme: DetailPageTheme;
  aiDetailContent: DetailPageContent | null;

  // ─── 제조사 / 원산지 ─────────────────────────────────────────────────────────
  manufacturer?: string;   // 제조사/브랜드 (parse-url에서 추출, 네이버 등록에 사용)
  countryOfOrigin?: string; // 원산지 (예: 국산, 미국산, 중국산)

  // ─── KC 인증 ────────────────────────────────────────────────────────────────
  certification?: string; // KC 인증번호 (parse-url에서 추출)

  // ─── 상품 스펙 텍스트 ────────────────────────────────────────────────────────
  productSpecText?: string; // 구조화된 상품 스펙 텍스트 (고시정보 AI용) — detailHtml과 별개

  // ─── 쿠팡 임시저장 ID ────────────────────────────────────────────────────────
  coupangDraftId?: string; // 임시저장 후 또는 draft 불러오기 시 세팅 → 제출 활성화에 사용
  naverDraftId?: string; // 네이버 임시저장 ID
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
  pickedDetailImages: [],
  sourceUrl: null,
  description: '',
  deliveryCharge: '0',
  deliveryChargeType: 'FREE',
  returnCharge: '5000',
  tags: [],
  options: null,
  optionsLoading: false,
  optionsError: null,
  // 워크플로우 메타
  currentStep: 1,
  selectedPlatform: 'both',
  // AI 상세페이지 관련
  rawImageFiles: [],
  detailImageFiles: [],
  detailPageFullHtml: null,
  detailPageSnippet: null,
  detailPageSnippetNaver: null,
  detailPageStatus: 'idle',
  detailPageError: null,
  detailPageSkipped: false,
  // 마진 계산기
  costPrice: '',
  targetMarginRate: 20,
  // 카테고리
  categoryHint: '',
  coupangCategoryCode: '',
  coupangCategoryPath: '',
  naverCategoryId: '',
  naverCategoryPath: '',
  // AI 상세페이지 수정
  detailPageEditStatus: 'idle',
  detailPageEditError: null,
  // 상세페이지 섹션 편집
  detailPageSections: [],
  detailPageTheme: DEFAULT_THEME,
  aiDetailContent: null,
  // 제조사 / 원산지
  manufacturer: undefined,
  countryOfOrigin: undefined,
  // 상품 스펙 텍스트
  productSpecText: undefined,
  // 네이버 임시저장 ID
  naverDraftId: undefined,
};

// ─── BothRegistration 타입 ───────────────────────────────────────────────────
// 동시 등록 진행 상태
type PlatformStatus = 'idle' | 'loading' | 'success' | 'error' | 'draft';

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
    draftId?: string;
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

// ─── CropItem 타입 ────────────────────────────────────────────────────────────
// Gemini Scene Composite Pipeline — 씬별 크롭 결과물
export interface CropItem {
  id: string;
  originalImageUrl: string;
  cropBox?: { x: number; y: number; width: number; height: number }; // 정규화 0~1
  sectionType: 'hero' | 'lifestyle' | 'detail' | 'feature';
  croppedImageUrl: string;
}

// ─── AssetsDraft 타입 ─────────────────────────────────────────────────────────
// 썸네일·상세만 만들기 탭의 임시 작업 상태
interface AssetsDraft {
  mode: 'url' | 'upload';
  url: string;
  // 업로드 모드: 썸네일용 / 상세페이지용 이미지를 분리해서 보관
  // 상세용 이미지는 자산 생성 시 AI 편집을 거쳐 상세페이지에 사용된다.
  thumbnailFiles: string[];
  detailFiles: string[];
  generatedThumbnails: string[];
  generatedDetailHtml: string;
  isGenerating: boolean;
  /** 사람이 읽는 진행 메시지 ("상세 이미지 AI 편집 중 (2/5)..." 등) */
  generatingMessage: string | null;
  lastError: string | null;
  // 상세페이지 섹션 편집 (DetailPageEditor용)
  detailPageSections: DetailSection[];
  detailPageTheme: DetailPageTheme;
  // ─── 대화식 상세페이지 생성 ────────────────────────────────────────────────
  // 자산 탭의 "대화로 만들기" 진입점에서 사용. 폼 모드에서는 무관.
  /** 사용자가 선택한 카테고리. 대화 모달 진입 조건 + 카테고리별 보충 질문 결정에 사용. */
  category: CategoryKey | null;
  /** 마지막 대화에서 수집한 답변. 결과 디버깅·재현용으로 보관. */
  conversationAnswers: QuestionAnswer[];
  includeAiImages: boolean;
  aiImageSlots: AiImageSlot[];
  aiDetailContent: import('@/lib/ai/prompts/detail-page').DetailPageContent | null;
  // ─── Gemini Scene Composite Pipeline ──────────────────────────────────────
  /** 씬 분석 대기 중인 크롭 목록. 사용자 확인 전 임시 보관. */
  pendingCrops: CropItem[] | null;
  /** 사용자가 확인·확정한 크롭 목록. 이미지 생성에 실제로 사용. */
  confirmedCrops: CropItem[] | null;
  /** Gemini 씬 분석 / 이미지 생성 진행 중 여부 */
  isAnalyzing: boolean;
}

const ASSETS_DRAFT_INITIAL: AssetsDraft = {
  mode: 'url',
  url: '',
  thumbnailFiles: [],
  detailFiles: [],
  generatedThumbnails: [],
  generatedDetailHtml: '',
  isGenerating: false,
  generatingMessage: null,
  lastError: null,
  detailPageSections: [],
  detailPageTheme: DEFAULT_THEME,
  category: null,
  conversationAnswers: [],
  includeAiImages: true,
  aiImageSlots: [],
  aiDetailContent: null,
  // Gemini Scene Composite Pipeline
  pendingCrops: null,
  confirmedCrops: null,
  isAnalyzing: false,
};

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

  // ─── Browse 모드 ─────────────────────────────────────────────────────────
  listingMode: 'register' | 'browse' | 'assets' | 'drafts';
  setListingMode: (mode: 'register' | 'browse' | 'assets' | 'drafts') => void;
  browsePlatform: 'coupang' | 'naver';
  setBrowsePlatform: (p: 'coupang' | 'naver') => void;
  browseFilters: {
    coupangStatus: string;
    naverStatus: string;
    keyword: string;
  };
  updateBrowseFilters: (patch: Partial<{ coupangStatus: string; naverStatus: string; keyword: string }>) => void;

  // ─── AssetsDraft 슬라이스 ─────────────────────────────────────────────────
  assetsDraft: AssetsDraft;
  updateAssetsDraft: (patch: Partial<AssetsDraft>) => void;
  resetAssetsDraft: () => void;

  // ─── 소싱탭 → 대량등록 연결 ─────────────────────────────────────────────
  pendingBulkItems: string[];
  addPendingBulkItems: (itemNos: string[]) => number;
  clearPendingBulkItems: () => void;

  // ─── 액션 ─────────────────────────────────────────────────────────────────
  setActivePlatform: (p: PlatformId) => void;
  fetchListings: () => Promise<void>;
  fetchCoupangProducts: (reset?: boolean, statusFilter?: string) => Promise<void>;
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

  // ─── 소싱 출처 ──────────────────────────────────────────────────────────────
  sourcingMap: Record<string, SourcingEntry | null>;
  fetchSourcing: (platform: 'coupang' | 'naver', ids: string[]) => Promise<void>;
  saveSourcing: (
    platform: 'coupang' | 'naver',
    productId: string,
    type: 'online' | 'offline',
    value: string,
    productName?: string,
  ) => Promise<boolean>;
  deleteSourcing: (platform: 'coupang' | 'naver', productId: string) => Promise<boolean>;
  checkCostcoStock: (
    platform: 'coupang' | 'naver',
    productId: string,
    sourcingUrl: string,
  ) => Promise<'inStock' | 'outOfStock' | 'lowStock' | null>;

  // ─── SharedDraft 액션 ───────────────────────────────────────────────────────
  sharedDraft: SharedDraft;
  updateSharedDraft: (patch: Partial<SharedDraft>) => void;
  resetSharedDraft: () => void;
  loadFromDiscoveryDraft: (draftId: string) => Promise<void>;
  // 도매꾹 옵션 액션
  fetchOptions: (itemNo: number) => Promise<void>;
  updateVariantPrice: (variantId: string, platform: 'coupang' | 'naver', price: number) => void;
  toggleVariant: (variantId: string) => void;
  toggleAllVariants: (enabled: boolean) => void;

  // ─── 워크플로우 액션 ────────────────────────────────────────────────────────
  goNextStep: () => void;
  goPrevStep: () => void;
  setCurrentStep: (step: 1 | 2 | 3) => void;
  skipDetailPage: () => void;
  generateDetailPage: () => Promise<void>;
  generateDetailPageFromPicked: () => Promise<void>;
  editDetailPage: (instruction: string) => Promise<void>;
  saveImagesToStorage: () => Promise<Array<{ url: string; error: string }>>;
  resetWorkflow: () => void;

  // ─── 상세페이지 섹션 편집 액션 ──────────────────────────────────────────────
  setDetailPageSections: (sections: DetailSection[]) => void;
  setDetailPageTheme: (theme: DetailPageTheme) => void;
  updateDetailPageSection: (id: string, patch: Partial<Omit<DetailSection, 'id'>>) => void;
  removeDetailPageSection: (id: string) => void;
  reorderDetailPageSections: (orderedIds: string[]) => void;

  // ─── BothRegistration 액션 ──────────────────────────────────────────────────
  bothRegistration: BothRegistrationState;
  registerBothProducts: (data: {
    platform?: 'both' | 'coupang' | 'naver';
    name: string;
    salePrice: number;
    naverPrice?: number;
    coupangPrice?: number;
    originalPrice?: number;
    stock?: number;
    thumbnailImages: string[];
    detailImages?: string[];
    description: string;
    deliveryCharge?: number;
    deliveryChargeType?: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
    returnCharge?: number;
    coupang?: {
      displayCategoryCode: number;
      brand?: string;
      maximumBuyCount?: number;
      maximumBuyForPerson?: number;
    };
    naver?: {
      leafCategoryId: string;
      tags?: string[];
      exchangeFee?: number;
    };
    options?: ProductOptions | null;
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

      // ─── Browse 모드 초기값 ────────────────────────────────────────────────
      listingMode: 'register',
      browsePlatform: 'coupang',
      browseFilters: { coupangStatus: '', naverStatus: '', keyword: '' },
      sourcingMap: {},
      pendingBulkItems: [],

      // ─── AssetsDraft 초기값 및 액션 ────────────────────────────────────────
      assetsDraft: ASSETS_DRAFT_INITIAL,
      updateAssetsDraft: (patch) =>
        set(
          (s) => ({ assetsDraft: { ...s.assetsDraft, ...patch } }),
          false,
          'listing/updateAssetsDraft',
        ),
      resetAssetsDraft: () =>
        set({ assetsDraft: ASSETS_DRAFT_INITIAL }, false, 'listing/resetAssetsDraft'),

      // ─── Browse 모드 액션 ─────────────────────────────────────────────────
      setListingMode: (mode) => set({ listingMode: mode }, false, 'listing/setListingMode'),
      setBrowsePlatform: (p) => set({ browsePlatform: p }, false, 'listing/setBrowsePlatform'),
      updateBrowseFilters: (patch) => set((s) => ({ browseFilters: { ...s.browseFilters, ...patch } }), false, 'listing/updateBrowseFilters'),

      addPendingBulkItems: (itemNos) => {
        const existing = new Set(get().pendingBulkItems);
        const toAdd = [...new Set(itemNos)].filter((n) => !existing.has(n));
        if (toAdd.length > 0) {
          set(
            (s) => ({ pendingBulkItems: [...s.pendingBulkItems, ...toAdd] }),
            false,
            'listing/addPendingBulkItems',
          );
        }
        return toAdd.length;
      },
      clearPendingBulkItems: () =>
        set({ pendingBulkItems: [] }, false, 'listing/clearPendingBulkItems'),

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
      fetchCoupangProducts: async (reset = false, statusFilter?: string) => {
        const state = get();
        if (state.isLoading) return;

        const nextToken = reset ? '' : (state.coupangNextToken ?? '');
        const status = statusFilter ?? 'APPROVED';
        set({ isLoading: true, error: null }, false, 'listing/fetchCoupang/start');

        try {
          const res = await fetch(
            `/api/listing/coupang?status=${encodeURIComponent(status)}&maxPerPage=20&nextToken=${encodeURIComponent(nextToken)}`,
          );
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `조회 실패 (${res.status})`);
          }

          const items = json.data?.items ?? [];
          set((s) => ({
            coupangProducts: reset ? items : [...state.coupangProducts, ...items],
            coupangNextToken: json.data?.nextToken ?? null,
            isLoading: false,
            ...(reset ? {
              sourcingMap: Object.fromEntries(
                Object.entries(s.sourcingMap).filter(([k]) => !k.startsWith('coupang:'))
              ),
            } : {}),
          }), false, 'listing/fetchCoupang/success');
          // 소싱 출처 배치 조회
          const newIds = items.map((p: CoupangProduct) => String(p.sellerProductId));
          if (newIds.length > 0) get().fetchSourcing('coupang', newIds);
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
          set((state) => ({
            naverProducts: json.data?.items ?? [],
            naverTotal: json.data?.total ?? 0,
            naverPage: page,
            isLoading: false,
            ...(page === 1 ? {
              sourcingMap: Object.fromEntries(
                Object.entries(state.sourcingMap).filter(([k]) => !k.startsWith('naver:'))
              ),
            } : {}),
          }), false, 'listing/fetchNaver/success');
          // 소싱 출처 배치 조회
          const newIds = (json.data?.items ?? []).map((p: NaverProduct) => String(p.originProductNo));
          if (newIds.length > 0) get().fetchSourcing('naver', newIds);
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

      // ─── 소싱 출처 액션 ─────────────────────────────────────────────────────
      fetchSourcing: async (platform, ids) => {
        if (ids.length === 0) return;
        try {
          const res = await fetch(
            `/api/listing/sourcing?platform=${platform}&ids=${ids.join(',')}`,
          );
          const json = await res.json();
          if (!res.ok) return;
          set((s) => ({
            sourcingMap: { ...s.sourcingMap, ...Object.fromEntries(
              Object.entries((json.sourcing ?? {}) as Record<string, { type: 'online' | 'offline'; value: string; costcoStockStatus?: string | null; costcoStockCheckedAt?: string | null }>).map(
                ([id, val]) => [`${platform}:${id}`, {
                  type: val.type,
                  value: val.value,
                  costcoStockStatus: (val.costcoStockStatus as SourcingEntry['costcoStockStatus']) ?? null,
                  costcoStockCheckedAt: val.costcoStockCheckedAt ?? null,
                } satisfies SourcingEntry],
              ),
            )},
          }), false, 'listing/fetchSourcing');
        } catch {
          // 소싱 조회 실패는 조용히 무시
        }
      },

      saveSourcing: async (platform, productId, type, value, productName) => {
        const key = `${platform}:${productId}`;
        const prevMap = get().sourcingMap;
        const hadKey = key in prevMap;
        const prevVal = prevMap[key] ?? null;
        set((s) => ({
          sourcingMap: {
            ...s.sourcingMap,
            [key]: { ...(s.sourcingMap[key] ?? {}), type, value },
          },
        }), false, 'listing/saveSourcing/optimistic');
        try {
          const res = await fetch('/api/listing/sourcing', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, productId, type, value, productName }),
          });
          if (!res.ok) throw new Error('저장 실패');
          return true;
        } catch {
          set((s) => {
            // 낙관적 업데이트 이후 다른 쓰기가 이미 반영됐으면 롤백하지 않음
            const optimistic = s.sourcingMap[key];
            if (optimistic?.type !== type || optimistic?.value !== value) return {};
            const next = { ...s.sourcingMap };
            if (hadKey) { next[key] = prevVal; } else { delete next[key]; }
            return { sourcingMap: next };
          }, false, 'listing/saveSourcing/rollback');
          return false;
        }
      },

      deleteSourcing: async (platform, productId) => {
        const key = `${platform}:${productId}`;
        const prevMap = get().sourcingMap;
        const hadKey = key in prevMap;
        const prevVal = prevMap[key] ?? null;
        set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: null } }), false, 'listing/deleteSourcing/optimistic');
        try {
          const res = await fetch('/api/listing/sourcing', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, productId }),
          });
          if (!res.ok) throw new Error('삭제 실패');
          return true;
        } catch {
          set((s) => {
            // 낙관적 삭제(null) 이후 다른 쓰기가 이미 반영됐으면 롤백하지 않음
            if (s.sourcingMap[key] !== null) return {};
            const next = { ...s.sourcingMap };
            if (hadKey) { next[key] = prevVal; } else { delete next[key]; }
            return { sourcingMap: next };
          }, false, 'listing/deleteSourcing/rollback');
          return false;
        }
      },

      checkCostcoStock: async (platform, productId, sourcingUrl) => {
        const key = `${platform}:${productId}`;
        try {
          const res = await fetch('/api/listing/sourcing/check-costco-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform, productId, sourcingUrl }),
          });
          if (!res.ok) return null;
          const json = await res.json() as { status: 'inStock' | 'outOfStock' | 'lowStock'; checkedAt: string };
          set((s) => {
            const existing = s.sourcingMap[key];
            // entry가 없으면(fetchSourcing 미완료 또는 삭제 상태) 상태 변경 없이 skip.
            // DB는 이미 업데이트됐으므로 다음 fetchSourcing 시 반영됨.
            if (!existing) return {};
            return {
              sourcingMap: {
                ...s.sourcingMap,
                [key]: { ...existing, costcoStockStatus: json.status, costcoStockCheckedAt: json.checkedAt },
              },
            };
          }, false, 'listing/checkCostcoStock');
          return json.status;
        } catch {
          return null;
        }
      },

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

      loadFromDiscoveryDraft: async (draftId: string) => {
        try {
          const res = await fetch(`/api/sourcing/product-discover/draft/${draftId}`);
          const json = await res.json();
          if (!json.success) {
            console.warn('[loadFromDiscoveryDraft] 실패:', json.error);
            return;
          }
          const { productInfo, keywords } = json.data as {
            productInfo: { title: string; image?: string | null; price?: number | null; url?: string | null };
            keywords: Array<{ keyword: string }>;
          };

          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                name: productInfo.title || s.sharedDraft.name,
                ...(productInfo.image
                  ? { thumbnailImages: [productInfo.image, ...s.sharedDraft.thumbnailImages] }
                  : {}),
                ...(productInfo.price ? { salePrice: String(productInfo.price) } : {}),
                ...(productInfo.url ? { sourceUrl: productInfo.url } : {}),
                tags: Array.from(new Set([...s.sharedDraft.tags, ...keywords.map((k) => k.keyword)])).slice(0, 10),
              },
            }),
            false,
            'listing/loadFromDiscoveryDraft',
          );
        } catch (e) {
          console.warn('[loadFromDiscoveryDraft] 에러:', e);
        }
      },

      // ─── 도매꾹 옵션 액션 ──────────────────────────────────────────────────

      fetchOptions: async (itemNo: number) => {
        set(
          (s) => ({ sharedDraft: { ...s.sharedDraft, optionsLoading: true, optionsError: null } }),
          false,
          'listing/fetchOptions/start',
        );
        try {
          const res = await fetch('/api/sourcing/prepare-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemNo }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? `옵션 조회 실패 (${res.status})`);
          }
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                options: json.data as ProductOptions,
                optionsLoading: false,
                optionsError: null,
              },
            }),
            false,
            'listing/fetchOptions/success',
          );
        } catch (err) {
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                optionsLoading: false,
                optionsError: err instanceof Error ? err.message : '옵션 조회 오류',
              },
            }),
            false,
            'listing/fetchOptions/error',
          );
        }
      },

      updateVariantPrice: (variantId, platform, price) =>
        set(
          (s) => {
            const opts = s.sharedDraft.options;
            if (!opts) return {};
            return {
              sharedDraft: {
                ...s.sharedDraft,
                options: {
                  ...opts,
                  variants: opts.variants.map((v) =>
                    v.variantId === variantId
                      ? {
                          ...v,
                          salePrices: {
                            ...v.salePrices,
                            [platform]: price,
                          },
                        }
                      : v,
                  ),
                },
              },
            };
          },
          false,
          'listing/updateVariantPrice',
        ),

      toggleVariant: (variantId) =>
        set(
          (s) => {
            const opts = s.sharedDraft.options;
            if (!opts) return {};
            return {
              sharedDraft: {
                ...s.sharedDraft,
                options: {
                  ...opts,
                  variants: opts.variants.map((v) =>
                    v.variantId === variantId ? { ...v, enabled: !v.enabled } : v,
                  ),
                },
              },
            };
          },
          false,
          'listing/toggleVariant',
        ),

      toggleAllVariants: (enabled) =>
        set(
          (s) => {
            const opts = s.sharedDraft.options;
            if (!opts) return {};
            return {
              sharedDraft: {
                ...s.sharedDraft,
                options: {
                  ...opts,
                  // 품절(soldOut) 행은 강제 비활성 유지
                  variants: opts.variants.map((v) =>
                    v.soldOut ? v : { ...v, enabled },
                  ),
                },
              },
            };
          },
          false,
          'listing/toggleAllVariants',
        ),

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
                  : naver.draft
                    ? { status: 'draft', draftId: naver.draftId, error: naver.error }
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

      // ─── 워크플로우 액션 ────────────────────────────────────────────────────
      goNextStep: () =>
        set(
          (s) => {
            const cur = s.sharedDraft.currentStep;
            if (cur < 3) {
              return { sharedDraft: { ...s.sharedDraft, currentStep: (cur + 1) as 1 | 2 | 3 } };
            }
            return {};
          },
          false,
          'listing/goNextStep',
        ),

      goPrevStep: () =>
        set(
          (s) => {
            const cur = s.sharedDraft.currentStep;
            if (cur > 1) {
              return { sharedDraft: { ...s.sharedDraft, currentStep: (cur - 1) as 1 | 2 | 3 } };
            }
            return {};
          },
          false,
          'listing/goPrevStep',
        ),

      setCurrentStep: (step) =>
        set(
          (s) => ({ sharedDraft: { ...s.sharedDraft, currentStep: step } }),
          false,
          'listing/setCurrentStep',
        ),

      skipDetailPage: () =>
        set(
          (s) => ({
            sharedDraft: {
              ...s.sharedDraft,
              detailPageSkipped: true,
              currentStep: 3,
            },
          }),
          false,
          'listing/skipDetailPage',
        ),

      generateDetailPage: async () => {
        // 브라우저 환경이 아니면 실행하지 않음
        if (typeof window === 'undefined') return;

        const { sharedDraft } = get();
        if (sharedDraft.rawImageFiles.length === 0 && sharedDraft.detailImageFiles.length === 0) return;

        // 이미지 base64 변환 유틸
        const readFileAsDataURL = (file: File): Promise<string> =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });

        const compressImage = (dataUrl: string, maxDimension = 1280, quality = 0.8): Promise<string> =>
          new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              let { width, height } = img;
              if (width > maxDimension || height > maxDimension) {
                if (width >= height) {
                  height = Math.round((height * maxDimension) / width);
                  width = maxDimension;
                } else {
                  width = Math.round((width * maxDimension) / height);
                  height = maxDimension;
                }
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = dataUrl;
          });

        // ─── Phase 1: 스튜디오 AI 편집 ────────────────────────────────────────
        set(
          (s) => ({
            sharedDraft: {
              ...s.sharedDraft,
              detailPageStatus: 'studio_editing',
              detailPageError: null,
            },
          }),
          false,
          'listing/generateDetailPage/studio_editing',
        );

        const STUDIO_EDIT_PROMPT =
          'Remove the background and replace with pure white (#FFFFFF). ' +
          'Apply bright, uniform studio lighting. ' +
          'Create a professional e-commerce product photo.';

        try {
          // rawImageFiles 우선, 남은 자리에 detailImageFiles 추가 (총 5장 상한)
          const allFiles = [
            ...sharedDraft.rawImageFiles,
            ...sharedDraft.detailImageFiles,
          ].slice(0, 5);

          // 각 이미지 data URL 변환 → 압축 → edit-thumbnail 병렬 호출 (25초 타임아웃)
          const studioResults = await Promise.allSettled(
            allFiles.map(async (file) => {
              const rawDataUrl = await readFileAsDataURL(file);
              // 원본이 고해상도 사진이면 10MB+가 될 수 있어 API가 실패함.
              // edit-thumbnail에 보내기 전에 반드시 압축한다.
              const compressedDataUrl = await compressImage(rawDataUrl);
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 25_000);
              try {
                const editRes = await fetch('/api/ai/edit-thumbnail', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageUrl: compressedDataUrl, prompt: STUDIO_EDIT_PROMPT }),
                  signal: controller.signal,
                });
                clearTimeout(timer);
                const editJson = await editRes.json();
                if (editRes.ok && editJson.success && editJson.data?.editedUrl) {
                  return { type: 'url' as const, value: editJson.data.editedUrl as string };
                }
              } catch {
                clearTimeout(timer);
              }
              // 편집 실패 시 이미 압축된 base64 폴백 (재압축 불필요)
              return { type: 'base64' as const, value: compressedDataUrl };
            }),
          );

          // ─── Phase 2: 이미지 분석 ──────────────────────────────────────────
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageStatus: 'analyzing',
              },
            }),
            false,
            'listing/generateDetailPage/analyzing',
          );

          // 편집 성공 → Supabase URL / 실패 → base64 분리
          const imageUrls: string[] = [];
          const fallbackImages: Array<{ imageBase64: string; mimeType: 'image/jpeg' }> = [];
          for (const result of studioResults) {
            if (result.status === 'fulfilled') {
              if (result.value.type === 'url') {
                imageUrls.push(result.value.value);
              } else {
                fallbackImages.push({ imageBase64: result.value.value, mimeType: 'image/jpeg' });
              }
            }
          }

          // ─── Phase 3: HTML 생성 ─────────────────────────────────────────────
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageStatus: 'generating',
              },
            }),
            false,
            'listing/generateDetailPage/generating',
          );

          const currentDraft = get().sharedDraft;
          const requestBody: Record<string, unknown> = {
            productName: currentDraft.name || undefined,
            studioMode: true,
          };
          if (imageUrls.length > 0) requestBody.imageUrls = imageUrls;
          if (fallbackImages.length > 0) requestBody.images = fallbackImages;
          const parsedSpecsA = parseSpecText(currentDraft.productSpecText);
          if (parsedSpecsA) requestBody.productSpecs = normalizeSalesUnitSpecs(parsedSpecsA);

          const res = await fetch('/api/ai/generate-detail-html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await res.json();

          if (!res.ok || !data.html) {
            throw new Error(data.error ?? '생성에 실패했습니다.');
          }

          // 성공: done 상태, description 자동 매핑
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageFullHtml: data.html,
                detailPageSnippet: data.snippet ?? null,
                detailPageSnippetNaver: data.naverSnippet ?? null,
                detailPageStatus: 'done',
                description: data.snippet ?? s.sharedDraft.description,
              },
            }),
            false,
            'listing/generateDetailPage/done',
          );

          // content가 있으면 섹션 편집기 초기화 (DetailPageEditor 활성화)
          if (data.content) {
            try {
              const sections = contentToSections(data.content as DetailPageContent);
              set(
                (s) => ({
                  sharedDraft: {
                    ...s.sharedDraft,
                    detailPageSections: sections,
                  },
                }),
                false,
                'listing/generateDetailPage/setSections',
              );
            } catch {
              // 파싱 실패 시 silent fallback — 기존 HTML 모드로 표시
            }
          }
        } catch (err) {
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageStatus: 'error',
                detailPageError: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
              },
            }),
            false,
            'listing/generateDetailPage/error',
          );
        }
      },

      generateDetailPageFromPicked: async () => {
        const { sharedDraft } = get();
        const { pickedDetailImages, detailImages, thumbnailImages, name, detailPageSections, aiDetailContent } = sharedDraft;

        // 우선순위: 사용자 선택 → detailImages → thumbnailImages(최후 수단)
        // detailImages는 Step2에서 이미지 삭제 시 함께 업데이트되므로 삭제된 이미지 미포함.
        const allImageUrls = pickedDetailImages.length > 0
          ? pickedDetailImages
          : detailImages.length > 0
            ? detailImages
            : thumbnailImages;

        if (allImageUrls.length === 0) return;

        set(
          (s) => ({ sharedDraft: { ...s.sharedDraft, detailPageStatus: 'analyzing', detailPageError: null } }),
          false,
          'listing/generateDetailPageFromPicked/analyzing',
        );

        try {
          // 기존 "AI와 함께 만들기" content가 있으면 HTML 재생성 없이 씬 이미지만 생성
          if (detailPageSections.length > 0 && aiDetailContent) {
            set(
              (s) => ({ sharedDraft: { ...s.sharedDraft, detailPageStatus: 'generating' } }),
              false,
              'listing/generateDetailPageFromPicked/generatingSceneOnly',
            );

            const referenceUrl = allImageUrls.find((u) => !u.startsWith('data:')) ?? allImageUrls[0];
            const sectionTypes: Array<'hero' | 'lifestyle' | 'detail' | 'feature'> = ['hero', 'lifestyle', 'detail', 'feature'];
            const results = await Promise.allSettled(
              sectionTypes.map(async (sectionType) => {
                const sceneRes = await fetch('/api/ai/generate-scene-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sectionType,
                    productImageUrl: referenceUrl.startsWith('data:') ? undefined : referenceUrl,
                    productInfo: {
                      headline: aiDetailContent.headline,
                      subheadline: aiDetailContent.subheadline,
                      sellingPoints: aiDetailContent.sellingPoints.map((sp) => ({ title: sp.title, description: sp.description })),
                      features: aiDetailContent.features.map((f) => ({ title: f.title })),
                    },
                  }),
                });
                const sceneData = (await sceneRes.json()) as { success: boolean; data?: { imageBase64: string; mimeType: string; prompt: string }; error?: string };
                if (!sceneRes.ok || !sceneData.success || !sceneData.data) throw new Error(sceneData.error ?? '씬 이미지 생성 실패');

                const uploadRes = await fetch('/api/image/upload-ai', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ imageBase64: sceneData.data.imageBase64, mimeType: sceneData.data.mimeType, role: sectionType }),
                });
                const uploadData = (await uploadRes.json()) as { success: boolean; url?: string };
                if (!uploadData.success || !uploadData.url) throw new Error('이미지 업로드 실패');

                return { role: sectionType, url: uploadData.url, prompt: sceneData.data.prompt, isReplaced: false } as AiImageSlot;
              }),
            );

            const aiSlots = results
              .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
              .map((r) => r.value);

            set(
              (s) => ({
                sharedDraft: { ...s.sharedDraft, detailPageStatus: 'done' },
                assetsDraft: { ...s.assetsDraft, aiImageSlots: aiSlots },
              }),
              false,
              'listing/generateDetailPageFromPicked/sceneOnlyDone',
            );
            return;
          }

          // 기존 content 없음 — 전체 새로 생성
          const externalUrls: string[] = [];
          const base64Images: Array<{ imageBase64: string; mimeType: 'image/jpeg' }> = [];

          for (const url of allImageUrls.slice(0, 5)) {
            if (url.startsWith('data:')) {
              base64Images.push({ imageBase64: url, mimeType: 'image/jpeg' });
            } else {
              externalUrls.push(url);
            }
          }

          const requestBody: Record<string, unknown> = {
            productName: name || undefined,
            studioMode: true,
          };

          if (externalUrls.length > 0) requestBody.imageUrls = externalUrls;
          if (base64Images.length > 0) requestBody.images = base64Images;
          const parsedSpecsB = parseSpecText(get().sharedDraft.productSpecText);
          if (parsedSpecsB) requestBody.productSpecs = normalizeSalesUnitSpecs(parsedSpecsB);

          set(
            (s) => ({ sharedDraft: { ...s.sharedDraft, detailPageStatus: 'generating' } }),
            false,
            'listing/generateDetailPageFromPicked/generating',
          );

          const res = await fetch('/api/ai/generate-detail-html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await res.json();
          if (!res.ok || !data.html) {
            throw new Error(data.error ?? '생성에 실패했습니다.');
          }

          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageFullHtml: data.html,
                detailPageSnippet: data.snippet ?? null,
                detailPageSnippetNaver: data.naverSnippet ?? null,
                detailPageStatus: 'done',
                description: data.snippet ?? s.sharedDraft.description,
              },
            }),
            false,
            'listing/generateDetailPageFromPicked/done',
          );

          // content가 있으면 섹션 편집기 초기화 + aiDetailContent 저장
          if (data.content) {
            try {
              const sections = contentToSections(data.content as DetailPageContent);
              set(
                (s) => ({
                  sharedDraft: {
                    ...s.sharedDraft,
                    detailPageSections: sections,
                    aiDetailContent: data.content as DetailPageContent,
                  },
                }),
                false,
                'listing/generateDetailPageFromPicked/setSections',
              );
            } catch {
              // 파싱 실패 시 silent fallback
            }
          }
        } catch (err) {
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageStatus: 'error',
                detailPageError: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
              },
            }),
            false,
            'listing/generateDetailPageFromPicked/error',
          );
        }
      },

      editDetailPage: async (instruction: string) => {
        const { sharedDraft } = get();
        // editing 상태로 전환
        set(
          (s) => ({
            sharedDraft: {
              ...s.sharedDraft,
              detailPageEditStatus: 'editing',
              detailPageEditError: null,
            },
          }),
          false,
          'listing/editDetailPage/start',
        );
        try {
          const res = await fetch('/api/ai/edit-detail-html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentHtml: sharedDraft.detailPageFullHtml,
              currentSnippet: sharedDraft.detailPageSnippet,
              instruction,
              productName: sharedDraft.name,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.html) {
            throw new Error(data.error ?? '수정에 실패했습니다.');
          }
          // 성공: HTML + snippet + description 업데이트
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageFullHtml: data.html,
                detailPageSnippet: data.snippet ?? s.sharedDraft.detailPageSnippet,
                detailPageSnippetNaver: data.naverSnippet ?? s.sharedDraft.detailPageSnippetNaver,
                description: data.snippet ?? s.sharedDraft.description,
                detailPageEditStatus: 'done',
                detailPageEditError: null,
              },
            }),
            false,
            'listing/editDetailPage/done',
          );
        } catch (err) {
          set(
            (s) => ({
              sharedDraft: {
                ...s.sharedDraft,
                detailPageEditStatus: 'error',
                detailPageEditError: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
              },
            }),
            false,
            'listing/editDetailPage/error',
          );
        }
      },

      saveImagesToStorage: async () => {
        const { sharedDraft } = get();
        const { thumbnailImages, detailImages, pickedDetailImages } = sharedDraft;

        // 저장이 필요한 URL = Supabase 영구 URL이 아닌 것
        const isSaved = (url: string) =>
          url.includes('supabase.co/storage') || url.includes('supabase.in/storage');

        const allUrls = [...new Set([
          ...thumbnailImages,
          ...detailImages,
          ...pickedDetailImages,
        ])].filter((url) => !isSaved(url));

        if (allUrls.length === 0) return [];

        const res = await fetch('/api/storage/save-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrls: allUrls, folder: 'listing-images' }),
        });
        const data = await res.json() as {
          success: boolean;
          results: Array<{ originalUrl: string; savedUrl: string }>;
          errors: Array<{ url: string; error: string }>;
        };
        if (!res.ok) throw new Error((data as { error?: string }).error ?? '이미지 저장에 실패했습니다.');

        // 원본 → 영구 URL 매핑
        const urlMap = new Map<string, string>(
          data.results.map((r) => [r.originalUrl, r.savedUrl]),
        );

        const remap = (urls: string[]) => urls.map((u) => urlMap.get(u) ?? u);

        set(
          (s) => ({
            sharedDraft: {
              ...s.sharedDraft,
              thumbnailImages: remap(s.sharedDraft.thumbnailImages),
              detailImages: remap(s.sharedDraft.detailImages),
              pickedDetailImages: remap(s.sharedDraft.pickedDetailImages),
            },
          }),
          false,
          'listing/saveImagesToStorage/done',
        );

        return data.errors;
      },

      resetWorkflow: () =>
        set(
          { sharedDraft: SHARED_DRAFT_INITIAL },
          false,
          'listing/resetWorkflow',
        ),

      // ─── 상세페이지 섹션 편집 액션 ────────────────────────────────────────────

      setDetailPageSections: (sections) =>
        set(
          (state) => ({ sharedDraft: { ...state.sharedDraft, detailPageSections: sections } }),
          false,
          'listing/setDetailPageSections'
        ),

      setDetailPageTheme: (theme) =>
        set(
          (state) => ({ sharedDraft: { ...state.sharedDraft, detailPageTheme: theme } }),
          false,
          'listing/setDetailPageTheme'
        ),

      updateDetailPageSection: (id, patch) =>
        set(
          (state) => ({
            sharedDraft: {
              ...state.sharedDraft,
              detailPageSections: state.sharedDraft.detailPageSections.map((s) =>
                s.id === id ? { ...s, ...patch } : s
              ),
            },
          }),
          false,
          'listing/updateDetailPageSection'
        ),

      removeDetailPageSection: (id) =>
        set(
          (state) => ({
            sharedDraft: {
              ...state.sharedDraft,
              detailPageSections: state.sharedDraft.detailPageSections.filter((s) => s.id !== id),
            },
          }),
          false,
          'listing/removeDetailPageSection'
        ),

      reorderDetailPageSections: (orderedIds) =>
        set(
          (state) => {
            const sectionMap = new Map(
              state.sharedDraft.detailPageSections.map((s) => [s.id, s])
            );
            const reordered = orderedIds
              .map((id, index) => {
                const s = sectionMap.get(id);
                return s ? { ...s, order: index } : null;
              })
              .filter((s): s is DetailSection & { order: number } => s !== null);
            return {
              sharedDraft: { ...state.sharedDraft, detailPageSections: reordered },
            };
          },
          false,
          'listing/reorderDetailPageSections'
        ),
    }),
    { name: 'ListingStore' },
  ),
);
