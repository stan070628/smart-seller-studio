/**
 * useCostcoProducts
 * 코스트코 소싱 상품 목록 무한스크롤 데이터 fetch 훅
 * - 서버 필터(category, grade, stockStatus 등) + 페이지네이션
 * - 클라이언트 전용 필터(hideHighCs, hideBlocked)는 fetch 후 메모리에서 처리
 */
'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { CostcoProductRow, CostcoSortKey } from '@/types/costco';
import type { CostcoFilterState } from '@/types/costco-mobile';
import { buildFilterParams } from '@/types/costco-mobile';
import { getCsRisk } from '@/lib/sourcing/domeggook-cs-filter';

interface UseCostcoProductsOptions {
  filters: CostcoFilterState;
  sort: CostcoSortKey;
  search: string;
  pageSize?: number;
}

interface UseCostcoProductsReturn {
  products: CostcoProductRow[];
  /** hideHighCs / hideBlocked 클라이언트 필터 적용 결과 */
  filteredProducts: CostcoProductRow[];
  total: number;
  categories: string[];
  lastCollected: string | null;

  isLoading: boolean;
  isFetchingMore: boolean;
  error: string | null;
  isEmpty: boolean;

  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;

  /** optimistic update — 시장가 편집 등에서 사용 */
  updateProduct: (productCode: string, patch: Partial<CostcoProductRow>) => void;
}

export function useCostcoProducts({
  filters,
  sort,
  search,
  pageSize = 20,
}: UseCostcoProductsOptions): UseCostcoProductsReturn {
  const [products, setProducts] = useState<CostcoProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetchPage 내부에서 항상 최신 filters/sort/search를 참조하기 위해 ref 사용
  // 이렇게 하면 fetchPage를 useCallback으로 감싸도 filters 객체가 dependency에 들어가 무한 루프가 생기는 문제를 방지
  const filtersRef = useRef(filters);
  const sortRef = useRef(sort);
  const searchRef = useRef(search);
  const pageSizeRef = useRef(pageSize);

  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { sortRef.current = sort; }, [sort]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { pageSizeRef.current = pageSize; }, [pageSize]);

  // 중복 요청 방지용 AbortController ref
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (pageNum: number) => {
    const isFirst = pageNum === 1;

    // 이전 요청이 진행 중이면 취소
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    if (isFirst) setIsLoading(true);
    else setIsFetchingMore(true);
    setError(null);

    try {
      const params = buildFilterParams(filtersRef.current);
      params.set('page', String(pageNum));
      params.set('pageSize', String(pageSizeRef.current));
      params.set('sort', sortRef.current);
      if (searchRef.current) params.set('search', searchRef.current);

      const res = await fetch(`/api/sourcing/costco?${params}`, {
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: {
        products: CostcoProductRow[];
        total: number;
        categories: string[];
        lastCollected: string | null;
      } = await res.json();

      if (isFirst) {
        setProducts(data.products);
        setCategories(data.categories);
        setLastCollected(data.lastCollected);
      } else {
        setProducts((prev) => [...prev, ...data.products]);
      }
      setTotal(data.total);
    } catch (e) {
      // abort는 에러로 처리하지 않음
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      if (isFirst) setIsLoading(false);
      else setIsFetchingMore(false);
    }
  }, []); // ref를 통해 최신값을 참조하므로 dependency 없음

  // filters / sort / search 변경 시 page 1로 리셋 후 재조회
  useEffect(() => {
    setPage(1);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.category,
    filters.grade,
    filters.stockStatus,
    filters.genderFilter,
    filters.asteriskOnly,
    filters.seasonOnly,
    sort,
    search,
  ]);

  // 컴포넌트 언마운트 시 진행 중인 요청 취소
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (isFetchingMore || isLoading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchPage(nextPage);
  }, [page, isFetchingMore, isLoading, fetchPage]);

  const refresh = useCallback(() => {
    setPage(1);
    fetchPage(1);
  }, [fetchPage]);

  const updateProduct = useCallback((productCode: string, patch: Partial<CostcoProductRow>) => {
    setProducts((prev) =>
      prev.map((p) => (p.product_code === productCode ? { ...p, ...patch } : p)),
    );
  }, []);

  // 클라이언트 전용 필터 적용 (hideHighCs, hideBlocked)
  const filteredProducts = useMemo(() => {
    let result = products;

    if (filters.hideHighCs) {
      result = result.filter(
        (p) => getCsRisk(p.category_name).level !== 'high',
      );
    }

    if (filters.hideBlocked) {
      // blocked_reason이 undefined(DB 미반환)이면 통과, null이어야 blocked 아닌 것으로 판단
      result = result.filter((p) => {
        if (p.blocked_reason === undefined) return true;
        return p.blocked_reason === null;
      });
    }

    return result;
  }, [products, filters.hideHighCs, filters.hideBlocked]);

  const isEmpty = !isLoading && products.length === 0;
  const hasMore = products.length < total;

  return {
    products,
    filteredProducts,
    total,
    categories,
    lastCollected,
    isLoading,
    isFetchingMore,
    error,
    isEmpty,
    hasMore,
    loadMore,
    refresh,
    updateProduct,
  };
}
