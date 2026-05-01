/**
 * useProductDiscoveryStore.ts
 * 상품 발굴 탭 전역 상태 (3단계: 입력 → 검증 → 결과)
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ProductInfo, ValidatedKeyword } from '@/types/sourcing';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

type Step = 1 | 2 | 3;

interface ProductDiscoveryStore {
  currentStep: Step;
  productInfo: ProductInfo | null;
  aiSuggestedKeywords: string[];
  selectedKeywords: string[];        // 사용자 확정 키워드 셋 (Step 1 끝에 결정)
  validated: ValidatedKeyword[];     // Step 2 검증 결과
  isExtractingAI: boolean;
  isValidating: boolean;
  isParsingUrl: boolean;
  isConfirming: boolean;
  error: string | null;

  setProductInfo: (info: ProductInfo | null) => void;
  parseUrl: (url: string) => Promise<void>;
  extractAIKeywords: () => Promise<void>;
  toggleKeyword: (kw: string) => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  setSelectedKeywords: (kws: string[]) => void;

  startValidation: () => Promise<void>;
  setReviewCount: (kw: string, count: number) => void;
  goToResult: () => void;          // Step 2 → 3 이동 (DB 저장은 Step 3 버튼에서)
  toggleResultSelect: (kw: string) => void;

  confirmAndGetDraftId: () => Promise<string | null>;
  reset: () => void;
}

const initialState = {
  currentStep: 1 as Step,
  productInfo: null,
  aiSuggestedKeywords: [],
  selectedKeywords: [],
  validated: [],
  isExtractingAI: false,
  isValidating: false,
  isParsingUrl: false,
  isConfirming: false,
  error: null,
};

export const useProductDiscoveryStore = create<ProductDiscoveryStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setProductInfo: (info) => set({ productInfo: info }),

      parseUrl: async (url) => {
        set({ isParsingUrl: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/parse-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? 'URL 파싱 실패', isParsingUrl: false });
            return;
          }
          set({ productInfo: json.data, isParsingUrl: false });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'URL 파싱 실패', isParsingUrl: false });
        }
      },

      extractAIKeywords: async () => {
        const { productInfo } = get();
        if (!productInfo?.title) return;
        set({ isExtractingAI: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/extract-keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productTitle: productInfo.title }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? 'AI 추출 실패', isExtractingAI: false });
            return;
          }
          set({
            aiSuggestedKeywords: json.data.keywords,
            selectedKeywords: json.data.keywords, // default: 모두 선택
            isExtractingAI: false,
          });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'AI 추출 실패', isExtractingAI: false });
        }
      },

      toggleKeyword: (kw) => set((s) => ({
        selectedKeywords: s.selectedKeywords.includes(kw)
          ? s.selectedKeywords.filter((k) => k !== kw)
          : [...s.selectedKeywords, kw],
      })),

      addKeyword: (kw) => {
        const t = kw.trim();
        if (!t) return;
        set((s) => s.selectedKeywords.includes(t) ? s : { selectedKeywords: [...s.selectedKeywords, t] });
      },

      removeKeyword: (kw) => set((s) => ({
        selectedKeywords: s.selectedKeywords.filter((k) => k !== kw),
      })),

      setSelectedKeywords: (kws) => set({ selectedKeywords: kws }),

      startValidation: async () => {
        const { selectedKeywords } = get();
        if (selectedKeywords.length === 0) return;
        set({ isValidating: true, error: null, currentStep: 2 });
        try {
          const res = await fetch('/api/sourcing/product-discover/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: selectedKeywords }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? '검증 실패', isValidating: false, currentStep: 1 });
            return;
          }
          const validated: ValidatedKeyword[] = json.data.results.map((r: {
            keyword: string;
            searchVolume: number | null;
            competitorCount: number | null;
            compIdx: '낮음' | '중간' | '높음' | null;
            avgCtr: number | null;
          }) => ({
            keyword: r.keyword,
            searchVolume: r.searchVolume,
            competitorCount: r.competitorCount,
            compIdx: r.compIdx,
            avgCtr: r.avgCtr,
            topReviewCount: null,
            seedScore: null,
            seedGrade: null,
            isSelected: true,
            isBlocked: false,
            blockedReason: null,
          }));
          set({ validated, isValidating: false });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '검증 실패', isValidating: false, currentStep: 1 });
        }
      },

      setReviewCount: (kw, count) => set((s) => ({
        validated: s.validated.map((v) => {
          if (v.keyword !== kw) return v;
          const blocked = count >= 50;
          let scored: { score: number | null; grade: ValidatedKeyword['seedGrade'] } = { score: null, grade: null };
          if (!blocked && v.searchVolume !== null && v.competitorCount !== null) {
            const r = calcSeedScore({
              searchVolume: v.searchVolume,
              competitorCount: v.competitorCount,
              topReviewCount: count,
              marginRate: 30, // 마진은 별도 탭이라 default 30(=경계값) → 마진 점수 0
              compIdx: v.compIdx,
              avgCtr: v.avgCtr,
            });
            scored = { score: r.total, grade: getSeedGrade(r.total) };
          }
          return {
            ...v,
            topReviewCount: count,
            isBlocked: blocked,
            blockedReason: blocked ? '쿠팡 상위 리뷰 50개 이상' : null,
            seedScore: scored.score,
            seedGrade: scored.grade,
            isSelected: !blocked && v.isSelected,
          };
        }),
      })),

      goToResult: () => set({ currentStep: 3 }),

      toggleResultSelect: (kw) => set((s) => ({
        validated: s.validated.map((v) =>
          v.keyword === kw && !v.isBlocked ? { ...v, isSelected: !v.isSelected } : v,
        ),
      })),

      confirmAndGetDraftId: async () => {
        const { productInfo, validated } = get();
        if (!productInfo) return null;

        const passed = validated.filter((v) => !v.isBlocked && v.isSelected);
        if (passed.length === 0) {
          set({ error: '선택된 통과 키워드가 없습니다' });
          return null;
        }

        set({ isConfirming: true, error: null });
        try {
          const res = await fetch('/api/sourcing/product-discover/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productInfo, keywords: passed }),
          });
          const json = await res.json();
          if (!json.success) {
            set({ error: json.error ?? '저장 실패', isConfirming: false });
            return null;
          }
          set({ isConfirming: false });
          return json.data.draftId as string;
        } catch (e) {
          set({ error: e instanceof Error ? e.message : '저장 실패', isConfirming: false });
          return null;
        }
      },

      reset: () => set(initialState),
    }),
    { name: 'ProductDiscovery' },
  ),
);
