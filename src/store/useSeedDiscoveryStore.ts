/**
 * useSeedDiscoveryStore.ts
 * 시드 발굴 탭 전역 상태 관리 (Zustand + devtools)
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { SeedKeyword } from '@/types/sourcing';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface SessionSummary {
  id: string;
  categories: string[];
  status: string;
  createdAt: string;
  winnerCount: number;
  step: number;
}

interface SeedDiscoveryStore {
  // ── 세션 ──────────────────────────────────────────────────────────────────
  sessionId: string | null;
  sessions: SessionSummary[];
  currentStep: Step;

  // ── 선택된 카테고리 ────────────────────────────────────────────────────────
  selectedCategories: string[];

  // ── 키워드 목록 ────────────────────────────────────────────────────────────
  keywords: SeedKeyword[];

  // ── 로딩 ──────────────────────────────────────────────────────────────────
  isAnalyzing: boolean;
  isConfirming: boolean;
  error: string | null;

  // ── 액션 ──────────────────────────────────────────────────────────────────
  setSelectedCategories: (cats: string[]) => void;
  startAnalysis: () => Promise<void>;
  setTopReviewCount: (keyword: string, count: number) => void;
  setKiprisStatus: (keyword: string, status: SeedKeyword['kiprisStatus']) => void;
  toggleKeywordSelect: (keyword: string) => void;
  calcAllScores: () => void;
  confirmSelection: () => Promise<{ saved: number } | null>;
  loadSessions: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  sessions: [],
  currentStep: 1 as Step,
  selectedCategories: [],
  keywords: [],
  isAnalyzing: false,
  isConfirming: false,
  error: null,
};

export const useSeedDiscoveryStore = create<SeedDiscoveryStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setSelectedCategories: (cats) => set({ selectedCategories: cats }),

      startAnalysis: async () => {
        const { selectedCategories, sessionId } = get();
        if (selectedCategories.length === 0) return;
        set({ isAnalyzing: true, error: null, currentStep: 2 });
        try {
          const res = await fetch('/api/sourcing/seed-discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: selectedCategories, ...(sessionId ? { sessionId } : {}) }),
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error);
          set({
            sessionId: json.data.sessionId,
            keywords: json.data.keywords,
            currentStep: 3,
            isAnalyzing: false,
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '분석 실패', isAnalyzing: false, currentStep: 1 });
        }
      },

      setTopReviewCount: (keyword, count) => {
        set((s) => ({
          keywords: s.keywords.map((k) =>
            k.keyword === keyword
              ? {
                  ...k,
                  topReviewCount: count,
                  isBlocked: count >= 50,
                  blockedReason: count >= 50 ? '상위 리뷰 50개 이상 (경쟁 진입 어려움)' : null,
                }
              : k,
          ),
        }));
      },

      setKiprisStatus: (keyword, status) => {
        set((s) => ({
          keywords: s.keywords.map((k) =>
            k.keyword === keyword ? { ...k, kiprisStatus: status } : k,
          ),
        }));
      },

      toggleKeywordSelect: (keyword) => {
        set((s) => ({
          keywords: s.keywords.map((k) =>
            k.keyword === keyword && !k.isBlocked ? { ...k, isSelected: !k.isSelected } : k,
          ),
        }));
      },

      calcAllScores: () => {
        set((s) => ({
          keywords: s.keywords.map((k) => {
            if (k.topReviewCount === null || k.isBlocked) return k;
            const marginRate = k.marginRate ?? 30; // 마진 미확인 시 최솟값으로 계산
            const result = calcSeedScore({
              competitorCount: k.competitorCount,
              searchVolume: k.searchVolume,
              topReviewCount: k.topReviewCount,
              marginRate,
              compIdx: k.compIdx,
              avgCtr: k.avgCtr,
            });
            return { ...k, seedScore: result.total, seedGrade: getSeedGrade(result.total) };
          }),
          currentStep: 6,
        }));
      },

      confirmSelection: async () => {
        const { sessionId, keywords } = get();
        if (!sessionId) return null;
        const selected = keywords.filter(
          (k) => k.isSelected && !k.isBlocked && k.domItemNo !== null && k.seedScore !== null,
        );
        // domItemNo가 없는 경우 itemNo 0으로 폴백 (실제로는 Step 4에서 도매꾹 매칭 후 설정)
        const items = selected.map((k) => ({
          itemNo: k.domItemNo ?? 0,
          keyword: k.keyword,
          score: k.seedScore!,
        })).filter((i) => i.itemNo > 0);

        if (items.length === 0) return null;
        set({ isConfirming: true });
        try {
          const res = await fetch('/api/sourcing/seed-discover/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, items }),
          });
          const json = await res.json();
          if (!json.success) throw new Error(json.error);
          set({ isConfirming: false, currentStep: 7 });
          return { saved: json.data.saved };
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '확정 실패', isConfirming: false });
          return null;
        }
      },

      loadSessions: async () => {
        try {
          const res = await fetch('/api/sourcing/seed-discover/sessions');
          const json = await res.json();
          if (json.success) set({ sessions: json.data });
        } catch { /* 무시 */ }
      },

      loadSession: async (sid) => {
        try {
          const res = await fetch(`/api/sourcing/seed-discover/sessions/${sid}`);
          const json = await res.json();
          if (json.success) {
            set({
              sessionId: sid,
              selectedCategories: json.data.categories,
              keywords: json.data.stateJson?.keywords ?? [],
              currentStep: (Math.min(json.data.step ?? 1, 7)) as Step,
            });
          }
        } catch { /* 무시 */ }
      },

      reset: () => set(initialState),
    }),
    { name: 'SeedDiscovery' },
  ),
);
