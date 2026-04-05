/**
 * useListingStore.ts
 * 오픈마켓 상품 자동등록 전역 상태 관리 (Zustand + devtools)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PlatformId, ProductListing } from '@/types/listing';

interface ListingStore {
  // ─── 상태 ─────────────────────────────────────────────────────────────────
  activePlatform: PlatformId;
  listings: ProductListing[];
  isLoading: boolean;
  error: string | null;

  // ─── 액션 ─────────────────────────────────────────────────────────────────
  setActivePlatform: (p: PlatformId) => void;
  fetchListings: () => Promise<void>;
  clearError: () => void;
}

export const useListingStore = create<ListingStore>()(
  devtools(
    (set) => ({
      // ─── 초기값 ────────────────────────────────────────────────────────────
      activePlatform: 'elevenst',
      listings: [],
      isLoading: false,
      error: null,

      // ─── 활성 플랫폼 변경 ──────────────────────────────────────────────────
      setActivePlatform: (p) => set({ activePlatform: p }, false, 'listing/setActivePlatform'),

      // ─── 등록 목록 조회 (Phase 1: API 미구현, 빈 배열 반환) ─────────────────
      fetchListings: async () => {
        set({ isLoading: true, error: null }, false, 'listing/fetchListings/start');
        try {
          // TODO: Phase 2에서 실제 API 호출로 교체
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          set({ listings: [], isLoading: false }, false, 'listing/fetchListings/success');
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
          set({ error: message, isLoading: false }, false, 'listing/fetchListings/error');
        }
      },

      // ─── 에러 초기화 ───────────────────────────────────────────────────────
      clearError: () => set({ error: null }, false, 'listing/clearError'),
    }),
    { name: 'ListingStore' }
  )
);
