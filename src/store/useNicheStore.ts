/**
 * useNicheStore.ts
 * 니치소싱 탭 Zustand 스토어
 *
 * 관리 대상: 키워드 목록, 분석 결과, 관심 목록, UI 상태, 필터
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  NicheKeyword,
  NicheWatchlistItem,
  NicheScoreResult,
  NicheAlert,
  NicheScoreSnapshot,
} from '@/types/niche';

// 현재 분석 결과 타입 (원시 수치 포함)
export type CurrentAnalysis = NicheScoreResult & {
  rawTotalProducts: number;
  rawAvgPrice: number;
};

interface NicheStore {
  // ── 데이터 ──────────────────────────────────────────────────────────────────
  keywords: NicheKeyword[];
  keywordsTotal: number;
  unreadAlertCount: number;
  currentAnalysis: CurrentAnalysis | null;
  watchlist: NicheWatchlistItem[];
  history: NicheScoreSnapshot[];
  isHistoryLoading: boolean;

  // ── UI 상태 ──────────────────────────────────────────────────────────────────
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  selectedKeyword: string | null;
  activeView: 'grid' | 'detail';

  // ── 필터 ─────────────────────────────────────────────────────────────────────
  gradeFilter: string[];
  categoryFilter: string | null;
  sortField: 'totalScore' | 'analyzedAt';
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  page: number;
  pageSize: number;

  // ── 액션 ─────────────────────────────────────────────────────────────────────
  fetchKeywords: () => Promise<void>;
  analyzeKeyword: (keyword: string) => Promise<void>;
  addToWatchlist: (keyword: string) => Promise<void>;
  removeFromWatchlist: (id: string) => Promise<void>;
  fetchWatchlist: () => Promise<void>;
  fetchHistory: (keyword: string) => Promise<void>;
  selectKeyword: (kw: string | null) => void;
  setGradeFilter: (grades: string[]) => void;
  setCategoryFilter: (cat: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSortField: (field: 'totalScore' | 'analyzedAt') => void;
  setPage: (p: number) => void;
  clearError: () => void;
}

export const useNicheStore = create<NicheStore>()(
  devtools(
    (set, get) => ({
      // ── 초기 데이터 ────────────────────────────────────────────────────────
      keywords: [],
      keywordsTotal: 0,
      unreadAlertCount: 0,
      currentAnalysis: null,
      watchlist: [],
      history: [],
      isHistoryLoading: false,

      // ── 초기 UI 상태 ───────────────────────────────────────────────────────
      isLoading: false,
      isAnalyzing: false,
      error: null,
      selectedKeyword: null,
      activeView: 'grid',

      // ── 초기 필터 ──────────────────────────────────────────────────────────
      gradeFilter: [],
      categoryFilter: null,
      sortField: 'analyzedAt',
      sortOrder: 'desc',
      searchQuery: '',
      page: 1,
      pageSize: 20,

      // ── fetchKeywords ──────────────────────────────────────────────────────
      fetchKeywords: async () => {
        const { gradeFilter, categoryFilter, sortField, sortOrder, page, pageSize, searchQuery } =
          get();

        set({ isLoading: true, error: null });

        try {
          const params = new URLSearchParams({
            sortField,
            sortOrder,
            page: String(page),
            pageSize: String(pageSize),
          });

          if (gradeFilter.length > 0) {
            params.set('grades', gradeFilter.join(','));
          }
          if (categoryFilter) {
            params.set('category', categoryFilter);
          }
          if (searchQuery.trim()) {
            params.set('search', searchQuery.trim());
          }

          const res = await fetch(`/api/niche/keywords?${params.toString()}`);

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `서버 오류 (${res.status})`);
          }

          const data = await res.json();
          set({ keywords: data.keywords ?? [], keywordsTotal: data.total ?? 0 });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '키워드 목록 로드 실패' });
        } finally {
          set({ isLoading: false });
        }
      },

      // ── analyzeKeyword ─────────────────────────────────────────────────────
      analyzeKeyword: async (keyword: string) => {
        if (!keyword.trim()) return;

        set({ isAnalyzing: true, error: null });

        try {
          const res = await fetch('/api/niche/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: keyword.trim() }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `분석 실패 (${res.status})`);
          }

          const data = await res.json();

          // 분석 완료 후 결과 저장 + 상세 뷰 전환
          set({
            currentAnalysis: data as CurrentAnalysis,
            selectedKeyword: keyword.trim(),
            activeView: 'detail',
          });

          // 키워드 목록도 갱신 (새 분석 결과가 목록에 반영되도록)
          get().fetchKeywords();
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '키워드 분석 실패' });
        } finally {
          set({ isAnalyzing: false });
        }
      },

      // ── addToWatchlist ─────────────────────────────────────────────────────
      addToWatchlist: async (keyword: string) => {
        try {
          const res = await fetch('/api/niche/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? '관심 등록 실패');
          }

          // 관심 목록 갱신
          await get().fetchWatchlist();
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '관심 등록 실패' });
        }
      },

      // ── removeFromWatchlist ────────────────────────────────────────────────
      removeFromWatchlist: async (id: string) => {
        try {
          const res = await fetch(`/api/niche/watchlist/${id}`, {
            method: 'DELETE',
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? '관심 해제 실패');
          }

          // 낙관적 업데이트: 로컬에서 즉시 제거
          set((state) => ({
            watchlist: state.watchlist.filter((item) => item.id !== id),
          }));
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '관심 해제 실패' });
        }
      },

      // ── fetchWatchlist ─────────────────────────────────────────────────────
      fetchWatchlist: async () => {
        try {
          const res = await fetch('/api/niche/watchlist');

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? '관심 목록 로드 실패');
          }

          const data = await res.json();
          set({ watchlist: data.items ?? [] });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '관심 목록 로드 실패' });
        }
      },

      // ── fetchHistory ───────────────────────────────────────────────────────
      fetchHistory: async (keyword: string) => {
        if (!keyword.trim()) return;

        set({ isHistoryLoading: true, history: [] });

        try {
          const res = await fetch(
            `/api/niche/history/${encodeURIComponent(keyword.trim())}?days=30`,
          );

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? `이력 조회 실패 (${res.status})`);
          }

          const data = await res.json();
          set({ history: data.history ?? [] });
        } catch (err) {
          // 이력 조회 실패는 전체 에러 상태에는 반영하지 않음 (비핵심 기능)
          console.warn('[NicheStore] fetchHistory 실패:', err);
          set({ history: [] });
        } finally {
          set({ isHistoryLoading: false });
        }
      },

      // ── selectKeyword ──────────────────────────────────────────────────────
      selectKeyword: (kw: string | null) => {
        set({ selectedKeyword: kw });
      },

      // ── setGradeFilter ─────────────────────────────────────────────────────
      setGradeFilter: (grades: string[]) => {
        set({ gradeFilter: grades, page: 1 });
      },

      // ── setCategoryFilter ──────────────────────────────────────────────────
      setCategoryFilter: (cat: string | null) => {
        set({ categoryFilter: cat, page: 1 });
      },

      // ── setSearchQuery ─────────────────────────────────────────────────────
      setSearchQuery: (q: string) => {
        set({ searchQuery: q, page: 1 });
      },

      // ── setSortField ───────────────────────────────────────────────────────
      setSortField: (field: 'totalScore' | 'analyzedAt') => {
        const { sortField, sortOrder } = get();
        if (sortField === field) {
          // 동일 필드 클릭 → 정렬 방향 토글
          set({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' });
        } else {
          set({ sortField: field, sortOrder: 'desc' });
        }
      },

      // ── setPage ────────────────────────────────────────────────────────────
      setPage: (p: number) => {
        set({ page: p });
      },

      // ── clearError ─────────────────────────────────────────────────────────
      clearError: () => {
        set({ error: null });
      },
    }),
    { name: 'NicheStore' },
  ),
);
