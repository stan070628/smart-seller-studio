/**
 * useCompetitorStore.ts
 * 경쟁 상품 추적 + 전일 판매 스냅샷 Zustand 스토어
 *
 * useNicheStore와 분리하여 단일 책임 유지
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  NicheCompetitorProduct,
  NicheCompetitorSummary,
} from '@/types/niche';

interface CompetitorStore {
  // ── 데이터 ──────────────────────────────────────────────────────────────────
  competitors: NicheCompetitorProduct[];
  summary: NicheCompetitorSummary[];
  marketSummary: {
    trackedProducts: number;
    totalDailySales: number;
    avgPrice: number;
    rocketCount: number;
    rocketRatio: number;
  } | null;

  // ── UI 상태 ──────────────────────────────────────────────────────────────────
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // ── 액션 ─────────────────────────────────────────────────────────────────────
  fetchCompetitors: (keyword: string) => Promise<void>;
  addCompetitor: (data: {
    keyword: string;
    productName: string;
    platform?: string;
    productUrl?: string;
    sellerName?: string;
    isRocket?: boolean;
    isAd?: boolean;
    rankPosition?: number;
    memo?: string;
  }) => Promise<boolean>;
  removeCompetitor: (id: string) => Promise<void>;
  toggleTracking: (id: string, isTracking: boolean) => Promise<void>;
  fetchSummary: (keyword: string) => Promise<void>;
  saveSnapshot: (data: {
    competitorId: string;
    keyword: string;
    platform: string;
    price?: number;
    reviewCount?: number;
    rating?: number;
    salesCount?: number;
    rankPosition?: number;
    memo?: string;
  }) => Promise<boolean>;
  clearError: () => void;
}

export const useCompetitorStore = create<CompetitorStore>()(
  devtools(
    (set, get) => ({
      // ── 초기값 ─────────────────────────────────────────────────────────────
      competitors: [],
      summary: [],
      marketSummary: null,
      isLoading: false,
      isSaving: false,
      error: null,

      // ── fetchCompetitors ───────────────────────────────────────────────────
      fetchCompetitors: async (keyword: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(
            `/api/niche/competitors?keyword=${encodeURIComponent(keyword)}`,
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `로드 실패 (${res.status})`);
          }
          const json = await res.json();
          set({ competitors: json.data?.items ?? [] });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '경쟁 상품 로드 실패' });
        } finally {
          set({ isLoading: false });
        }
      },

      // ── addCompetitor ──────────────────────────────────────────────────────
      addCompetitor: async (data) => {
        set({ isSaving: true, error: null });
        try {
          const res = await fetch('/api/niche/competitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `등록 실패 (${res.status})`);
          }
          // 목록 갱신
          await get().fetchCompetitors(data.keyword);
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '경쟁 상품 등록 실패' });
          return false;
        } finally {
          set({ isSaving: false });
        }
      },

      // ── removeCompetitor ───────────────────────────────────────────────────
      removeCompetitor: async (id: string) => {
        // 낙관적 업데이트
        const prev = get().competitors;
        set({ competitors: prev.filter((c) => c.id !== id) });

        try {
          const res = await fetch(`/api/niche/competitors/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            set({ competitors: prev }); // 롤백
            throw new Error(body?.error ?? '삭제 실패');
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '삭제 실패' });
        }
      },

      // ── toggleTracking ─────────────────────────────────────────────────────
      toggleTracking: async (id: string, isTracking: boolean) => {
        // 낙관적 업데이트
        set((s) => ({
          competitors: s.competitors.map((c) =>
            c.id === id ? { ...c, isTracking } : c,
          ),
        }));

        try {
          const res = await fetch(`/api/niche/competitors/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isTracking }),
          });
          if (!res.ok) {
            // 롤백
            set((s) => ({
              competitors: s.competitors.map((c) =>
                c.id === id ? { ...c, isTracking: !isTracking } : c,
              ),
            }));
          }
        } catch {
          // 롤백
          set((s) => ({
            competitors: s.competitors.map((c) =>
              c.id === id ? { ...c, isTracking: !isTracking } : c,
            ),
          }));
        }
      },

      // ── fetchSummary ───────────────────────────────────────────────────────
      fetchSummary: async (keyword: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(
            `/api/niche/competitors/summary?keyword=${encodeURIComponent(keyword)}`,
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `요약 로드 실패 (${res.status})`);
          }
          const json = await res.json();
          set({
            summary: json.data?.items ?? [],
            marketSummary: json.data?.summary ?? null,
          });
        } catch (err) {
          console.warn('[CompetitorStore] fetchSummary 실패:', err);
          set({ summary: [], marketSummary: null });
        } finally {
          set({ isLoading: false });
        }
      },

      // ── saveSnapshot ───────────────────────────────────────────────────────
      saveSnapshot: async (data) => {
        set({ isSaving: true, error: null });
        try {
          const res = await fetch('/api/niche/sales-snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `저장 실패 (${res.status})`);
          }
          // 요약 갱신
          await get().fetchSummary(data.keyword);
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '스냅샷 저장 실패' });
          return false;
        } finally {
          set({ isSaving: false });
        }
      },

      // ── clearError ─────────────────────────────────────────────────────────
      clearError: () => set({ error: null }),
    }),
    { name: 'CompetitorStore' },
  ),
);
