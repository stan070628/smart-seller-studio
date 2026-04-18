/**
 * useSourcingStore.ts
 * 소싱 대시보드 전역 상태 관리 (Zustand + devtools)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { SalesAnalysisItem } from '@/types/sourcing';

export interface CollectingProgress {
  phase: 'fetch' | 'snapshot' | 'market_price';
  label: string;
  current: number;
  total: number;
}

interface SourcingStore {
  // ─── 데이터 ───────────────────────────────────────────────────────────────
  items: SalesAnalysisItem[];
  totalCount: number;
  lastCollectedAt: string | null;
  categories: string[];

  // ─── UI 상태 ──────────────────────────────────────────────────────────────
  isLoading: boolean;
  isCollecting: boolean;
  collectingStep: string | null; // 하위 호환 (기존 UI가 참조)
  collectingProgress: CollectingProgress | null;
  error: string | null;

  // ─── 필터 / 정렬 / 페이지네이션 ───────────────────────────────────────────
  sortField: string;           // 기본값: 'sales_7d'
  sortOrder: 'asc' | 'desc';  // 기본값: 'desc'
  categoryFilter: string | null;
  searchQuery: string;
  moqFilter: number | null;    // null=전체, 10=10개 이하, 50=50개 이하
  freeDeliOnly: boolean;       // true=무료배송만 표시
  minSales1d: number | null;
  minSales7d: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minMargin: number | null;
  legalFilter: string | null;  // safe | warning | blocked
  ipRiskFilter: string | null; // low | medium | high
  seasonOnly: boolean;
  page: number;
  pageSize: number;            // 고정값: 20

  // ─── 액션 ─────────────────────────────────────────────────────────────────
  fetchAnalysis: () => Promise<void>;
  triggerCollection: () => Promise<void>;
  setSortField: (field: string) => void;
  toggleSortOrder: () => void;
  setCategoryFilter: (cat: string | null) => void;
  setSearchQuery: (q: string) => void;
  setMoqFilter: (moq: number | null) => void;
  setFreeDeliOnly: (v: boolean) => void;
  setMinSales1d: (v: number | null) => void;
  setMinSales7d: (v: number | null) => void;
  setMinPrice: (v: number | null) => void;
  setMaxPrice: (v: number | null) => void;
  setMinMargin: (v: number | null) => void;
  setLegalFilter: (v: string | null) => void;
  setIpRiskFilter: (v: string | null) => void;
  setSeasonOnly: (v: boolean) => void;
  setPage: (p: number) => void;
  clearError: () => void;
  triggerLegalCheck: () => Promise<void>;
  isLegalChecking: boolean;
  // 단일 키워드 즉시 수집
  collectKeyword: (keyword: string) => Promise<void>;
  isKeywordCollecting: boolean;
  // IP 리스크 검증 — 개별 상품 단위
  verifyIp: (itemId: string, keyword: string) => Promise<void>;
  ipVerifyingId: string | null; // 현재 검증 중인 항목 ID
}

export const useSourcingStore = create<SourcingStore>()(
  devtools(
    (set, get) => ({
      // ─── 초기값 ─────────────────────────────────────────────────────────
      items: [],
      totalCount: 0,
      lastCollectedAt: null,
      categories: [],
      isLoading: false,
      isCollecting: false,
      collectingStep: null,
      collectingProgress: null,
      error: null,
      sortField: 'moq',
      sortOrder: 'asc',
      categoryFilter: null,
      searchQuery: '',
      moqFilter: null,
      freeDeliOnly: false,
      minSales1d: null,
      minSales7d: null,
      minPrice: null,
      maxPrice: null,
      minMargin: null,
      legalFilter: null,
      ipRiskFilter: null,
      seasonOnly: false,
      page: 1,
      pageSize: 20,
      isLegalChecking: false,
      isKeywordCollecting: false,
      ipVerifyingId: null,

      // ─── fetchAnalysis ───────────────────────────────────────────────────
      fetchAnalysis: async () => {
        const {
          sortField, sortOrder, categoryFilter, searchQuery, moqFilter, freeDeliOnly,
          minSales1d, minSales7d, minPrice, maxPrice, minMargin, legalFilter, ipRiskFilter,
          seasonOnly, page, pageSize,
        } = get();

        set({ isLoading: true, error: null }, false, 'sourcing/fetchAnalysis/start');

        try {
          const offset = (page - 1) * pageSize;
          const params = new URLSearchParams({
            sort: sortField,
            order: sortOrder,
            limit: String(pageSize),
            offset: String(offset),
          });
          if (categoryFilter) params.set('category', categoryFilter);
          if (searchQuery.trim()) params.set('search', searchQuery.trim());
          if (moqFilter != null) params.set('moq', String(moqFilter));
          if (freeDeliOnly) params.set('freeDeliOnly', '1');
          if (minSales1d != null) params.set('minSales1d', String(minSales1d));
          if (minSales7d != null) params.set('minSales7d', String(minSales7d));
          if (minPrice != null) params.set('minPrice', String(minPrice));
          if (maxPrice != null) params.set('maxPrice', String(maxPrice));
          if (minMargin != null) params.set('minMargin', String(minMargin));
          if (legalFilter) params.set('legal', legalFilter);
          if (ipRiskFilter) params.set('ipRisk', ipRiskFilter);
          if (seasonOnly) params.set('seasonOnly', '1');

          const res = await fetch(`/api/sourcing/analyze?${params.toString()}`);
          const json = await res.json();

          if (!res.ok || !json.success) {
            throw new Error(json.error ?? '분석 데이터를 불러오지 못했습니다.');
          }

          set(
            {
              items: json.data.items as SalesAnalysisItem[],
              totalCount: json.data.total as number,
              lastCollectedAt: (json.data.lastCollectedAt as string | null) ?? null,
              categories: (json.data.categories as string[]) ?? [],
              isLoading: false,
            },
            false,
            'sourcing/fetchAnalysis/success',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류';
          set({ isLoading: false, error: message }, false, 'sourcing/fetchAnalysis/error');
        }
      },

      // ─── triggerCollection ───────────────────────────────────────────────
      triggerCollection: async () => {
        if (get().isCollecting) return;

        // 당일 이미 수집 완료했으면 중복 수집 방지
        const lastAt = get().lastCollectedAt;
        if (lastAt) {
          const lastDate = new Date(lastAt).toISOString().slice(0, 10);
          const today = new Date().toISOString().slice(0, 10);
          if (lastDate === today) {
            const confirmed = window.confirm(
              '오늘 이미 수집을 완료했습니다. 다시 수집하시겠습니까?',
            );
            if (!confirmed) return;
          }
        }

        const keywords = [
          '생활용품', '주방용품', '뷰티', '화장품',
          '건강', '디지털', '가전', '유아', '아동',
          '반려동물', '패션잡화', '식품',
          '스포츠', '수영', '레저', '캠핑',
        ];

        set(
          {
            isCollecting: true,
            error: null,
            collectingStep: '상품 목록 수집 중...',
            collectingProgress: { phase: 'fetch', label: keywords[0], current: 0, total: keywords.length },
          },
          false,
          'sourcing/triggerCollection/start',
        );

        try {
          // 1단계: fetch-items — 키워드별 개별 호출로 진행률 표시
          let totalFetched = 0;
          for (let i = 0; i < keywords.length; i++) {
            const kw = keywords[i];
            set(
              {
                collectingStep: `수집 중: ${kw} (${i + 1}/${keywords.length})`,
                collectingProgress: { phase: 'fetch', label: kw, current: i + 1, total: keywords.length },
              },
              false,
              'sourcing/triggerCollection/fetch-progress',
            );

            const fetchRes = await fetch('/api/sourcing/fetch-items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keywords: [kw], maxPages: 6 }),
            });
            const fetchJson = await fetchRes.json();
            if (!fetchRes.ok || !fetchJson.success) {
              console.warn(`[fetch-items] "${kw}" 실패:`, fetchJson.error);
              continue; // 개별 키워드 실패 시 스킵
            }
            totalFetched += fetchJson.data?.totalFetched ?? 0;
          }

          if (totalFetched === 0) {
            throw new Error('수집된 상품이 없습니다. 도매꾹 API 연결을 확인하세요.');
          }

          // 2단계: snapshot — 재고 스냅샷 저장
          set(
            {
              collectingStep: '재고 스냅샷 저장 중...',
              collectingProgress: { phase: 'snapshot', label: '상세 정보 조회', current: 0, total: 1 },
            },
            false,
            'sourcing/triggerCollection/snapshot',
          );

          const snapshotRes = await fetch('/api/sourcing/snapshot', { method: 'POST' });
          const snapshotJson = await snapshotRes.json();
          if (!snapshotRes.ok || !snapshotJson.success) {
            throw new Error(snapshotJson.error ?? '재고 스냅샷 저장에 실패했습니다.');
          }

          set(
            {
              collectingProgress: {
                phase: 'snapshot',
                label: '완료',
                current: snapshotJson.data?.successCount ?? 1,
                total: snapshotJson.data?.totalProcessed ?? 1,
              },
            },
            false,
            'sourcing/triggerCollection/snapshot-done',
          );

          // 3단계: 시장가 조회 (네이버 쇼핑 API) — 단가격차 계산에 필요
          set(
            {
              collectingStep: '네이버 시장가 조회 중...',
              collectingProgress: { phase: 'market_price', label: '시장가 수집', current: 0, total: 1 },
            },
            false,
            'sourcing/triggerCollection/market-price-start',
          );

          // 50건씩 최대 3회 반복 (최대 150건) — Vercel 타임아웃 대비
          let marketUpdated = 0;
          for (let round = 0; round < 3; round++) {
            const mpRes = await fetch('/api/sourcing/naver-prices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ limit: 50 }),
            });
            if (!mpRes.ok) break;
            const mpJson = await mpRes.json();
            if (!mpJson.success) break;
            marketUpdated += mpJson.updated ?? 0;
            set(
              {
                collectingProgress: {
                  phase: 'market_price',
                  label: `시장가 수집 (${marketUpdated}건 완료)`,
                  current: round + 1,
                  total: 3,
                },
              },
              false,
              'sourcing/triggerCollection/market-price-progress',
            );
            // 업데이트된 건이 없으면 (= 남은 미수집 상품 없음) 조기 종료
            if ((mpJson.updated ?? 0) === 0) break;
          }

          // 완료 — 데이터 새로 고침
          set(
            { isCollecting: false, collectingStep: null, collectingProgress: null },
            false,
            'sourcing/triggerCollection/done',
          );
          await get().fetchAnalysis();
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류';
          set(
            { isCollecting: false, collectingStep: null, collectingProgress: null, error: message },
            false,
            'sourcing/triggerCollection/error',
          );
        }
      },

      // ─── 정렬 액션 ──────────────────────────────────────────────────────
      setSortField: (field: string) => {
        set({ sortField: field, sortOrder: 'desc', page: 1 }, false, 'sourcing/setSortField');
        get().fetchAnalysis();
      },

      toggleSortOrder: () => {
        const next = get().sortOrder === 'desc' ? 'asc' : 'desc';
        set({ sortOrder: next, page: 1 }, false, 'sourcing/toggleSortOrder');
        get().fetchAnalysis();
      },

      // ─── 필터 액션 ──────────────────────────────────────────────────────
      setCategoryFilter: (cat: string | null) => {
        set({ categoryFilter: cat, page: 1 }, false, 'sourcing/setCategoryFilter');
        get().fetchAnalysis();
      },

      setSearchQuery: (q: string) => {
        set({ searchQuery: q, page: 1 }, false, 'sourcing/setSearchQuery');
      },

      setMoqFilter: (moq: number | null) => {
        set({ moqFilter: moq, page: 1 }, false, 'sourcing/setMoqFilter');
        get().fetchAnalysis();
      },

      setFreeDeliOnly: (v: boolean) => {
        set({ freeDeliOnly: v, page: 1 }, false, 'sourcing/setFreeDeliOnly');
        get().fetchAnalysis();
      },

      setMinSales1d: (v: number | null) => {
        set({ minSales1d: v, page: 1 }, false, 'sourcing/setMinSales1d');
        get().fetchAnalysis();
      },
      setMinSales7d: (v: number | null) => {
        set({ minSales7d: v, page: 1 }, false, 'sourcing/setMinSales7d');
        get().fetchAnalysis();
      },
      setMinPrice: (v: number | null) => {
        set({ minPrice: v, page: 1 }, false, 'sourcing/setMinPrice');
        get().fetchAnalysis();
      },
      setMaxPrice: (v: number | null) => {
        set({ maxPrice: v, page: 1 }, false, 'sourcing/setMaxPrice');
        get().fetchAnalysis();
      },
      setMinMargin: (v: number | null) => {
        set({ minMargin: v, page: 1 }, false, 'sourcing/setMinMargin');
        get().fetchAnalysis();
      },
      setLegalFilter: (v: string | null) => {
        set({ legalFilter: v, page: 1 }, false, 'sourcing/setLegalFilter');
        get().fetchAnalysis();
      },
      setIpRiskFilter: (v: string | null) => {
        set({ ipRiskFilter: v, page: 1 }, false, 'sourcing/setIpRiskFilter');
        get().fetchAnalysis();
      },

      setSeasonOnly: (v: boolean) => {
        set({ seasonOnly: v, page: 1 }, false, 'sourcing/setSeasonOnly');
        get().fetchAnalysis();
      },

      setPage: (p: number) => {
        set({ page: p }, false, 'sourcing/setPage');
        get().fetchAnalysis();
      },

      clearError: () => {
        set({ error: null }, false, 'sourcing/clearError');
      },

      // ─── collectKeyword: 단일 키워드 즉시 수집 ───────────────────────────
      collectKeyword: async (keyword: string) => {
        if (get().isKeywordCollecting || get().isCollecting) return;
        set({ isKeywordCollecting: true, error: null }, false, 'sourcing/collectKeyword/start');
        try {
          const res = await fetch('/api/sourcing/fetch-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: [keyword] }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? '수집에 실패했습니다.');
          }
          const count = json.data?.totalFetched ?? 0;
          if (count === 0) {
            throw new Error(`"${keyword}"에 해당하는 상품이 도매꾹에 없습니다.`);
          }
          await get().fetchAnalysis();
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류';
          set({ error: message }, false, 'sourcing/collectKeyword/error');
        } finally {
          set({ isKeywordCollecting: false }, false, 'sourcing/collectKeyword/done');
        }
      },

      triggerLegalCheck: async () => {
        if (get().isLegalChecking) return;
        set({ isLegalChecking: true, error: null }, false, 'sourcing/legalCheck/start');

        try {
          const res = await fetch('/api/sourcing/domeggook/legal-check', { method: 'POST' });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? '법적 검토에 실패했습니다.');
          }
          set({ isLegalChecking: false }, false, 'sourcing/legalCheck/done');
          await get().fetchAnalysis();
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류';
          set({ isLegalChecking: false, error: message }, false, 'sourcing/legalCheck/error');
        }
      },

      // ─── verifyIp — 개별 상품의 KIPRIS IP 리스크 검증 ───────────────────
      verifyIp: async (itemId: string, keyword: string) => {
        if (get().ipVerifyingId) return; // 동시에 1건만 허용

        set({ ipVerifyingId: itemId, error: null }, false, 'sourcing/verifyIp/start');

        try {
          const res = await fetch('/api/sourcing/verify-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, itemId }),
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? 'IP 검증에 실패했습니다.');
          }

          // 검증 완료 후 해당 항목만 로컬 상태에서 즉시 반영
          const overallRisk = json.data.overallRisk as 'low' | 'medium' | 'high';
          set(
            (state) => ({
              ipVerifyingId: null,
              items: state.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      ipRiskLevel: overallRisk,
                      ipCheckedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            }),
            false,
            'sourcing/verifyIp/done',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : '알 수 없는 오류';
          set({ ipVerifyingId: null, error: message }, false, 'sourcing/verifyIp/error');
        }
      },
    }),
    { name: 'SourcingStore' },
  ),
);
