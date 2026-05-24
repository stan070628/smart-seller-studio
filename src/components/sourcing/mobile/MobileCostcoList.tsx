'use client';

/**
 * 코스트코 모바일 상품 목록 컨테이너
 * 필터/정렬 상태 관리 + useCostcoProducts + 무한스크롤
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CostcoProductRow, CostcoSortKey } from '@/types/costco';
import {
  type CostcoFilterState,
  DEFAULT_FILTER_STATE,
  parseFilterParams,
} from '@/types/costco-mobile';
import { useCostcoProducts } from '@/hooks/useCostcoProducts';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';

import MobileCostcoCard from './MobileCostcoCard';
import MobileCostcoSkeletonList from './MobileCostcoSkeletonList';
import MobileEmptyState from './MobileEmptyState';
import MobileFilterChipBar from './MobileFilterChipBar';
import MobileBottomSheet from './MobileBottomSheet';
import MobileFilterSheet from './MobileFilterSheet';
import MobileSortSheet from './MobileSortSheet';
import MobileCostcoDetail from './MobileCostcoDetail';
import MobileCodeSearchCard from './MobileCodeSearchCard';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileCostcoListProps {
  /** page.tsx에서 내려주는 초기 searchParams */
  initialSearch?: Record<string, string | string[] | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 포맷 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileCostcoList({ initialSearch }: MobileCostcoListProps) {
  // ── 필터 / 정렬 / 검색 상태 ───────────────────────────────────────────────
  const [filters, setFilters] = useState<CostcoFilterState>(() =>
    parseFilterParams(initialSearch ?? {}),
  );

  const [sort, setSort] = useState<CostcoSortKey>(() => {
    const v = initialSearch?.sort;
    return (Array.isArray(v) ? v[0] : v) as CostcoSortKey ?? 'sourcing_score_desc';
  });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // 6~7자리 숫자 입력 시 상품코드 모드로 전환 (코스트코 코드는 6자리도 존재)
  const isProductCode = /^\d{6,7}$/.test(search);

  // ── UI 상태 ───────────────────────────────────────────────────────────────
  const [selectedProduct, setSelectedProduct] = useState<CostcoProductRow | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);

  // ── 검색어 300ms debounce ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // ── 데이터 fetch ──────────────────────────────────────────────────────────
  const {
    filteredProducts,
    total,
    categories,
    lastCollected,
    isLoading,
    isFetchingMore,
    isEmpty,
    hasMore,
    loadMore,
    refresh,
    updateProduct,
  // 상품코드 모드일 때는 텍스트 필터 비활성화
  } = useCostcoProducts({ filters, sort, search: isProductCode ? '' : debouncedSearch });

  // ── 무한스크롤 sentinel ───────────────────────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null);

  const stableLoadMore = useCallback(() => {
    loadMore();
  }, [loadMore]);

  useIntersectionObserver(sentinelRef, {
    rootMargin: '200px',
    onIntersect: stableLoadMore,
    enabled: hasMore && !isFetchingMore && !isLoading,
  });

  // ── 활성 필터 수 계산 ─────────────────────────────────────────────────────
  const activeFilterCount = [
    filters.category !== '',
    filters.grade !== 'all',
    filters.stockStatus !== 'all',
    filters.genderFilter !== 'all',
    filters.asteriskOnly,
    filters.seasonOnly,
    !filters.hideHighCs,
    !filters.hideBlocked,
  ].filter(Boolean).length;

  // ── 개별 필터 제거 핸들러 ─────────────────────────────────────────────────
  const handleClearFilter = useCallback((key: keyof CostcoFilterState) => {
    setFilters((prev) => ({
      ...prev,
      [key]: DEFAULT_FILTER_STATE[key],
    }));
  }, []);

  const handleClearSort = useCallback(() => {
    setSort('sourcing_score_desc');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ backgroundColor: '#f4f4f4', minHeight: '100vh' }}>

        {/* 상단 검색 + 필터/정렬 버튼 바 */}
        <div
          style={{
            position: 'sticky',
            top: '52px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e5e7eb',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 10,
          }}
        >
          {/* 검색 입력 — 상품코드 모드 시 파란 테두리 + 뱃지 표시 */}
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명, 브랜드 또는 상품코드 7자리..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: '36px',
                padding: isProductCode ? '0 88px 0 10px' : '0 10px',
                fontSize: '13px',
                border: `1px solid ${isProductCode ? '#2563eb' : '#e5e7eb'}`,
                borderRadius: '8px',
                outline: 'none',
                color: '#1a1c1c',
                backgroundColor: isProductCode ? '#eff6ff' : '#f9fafb',
              }}
            />
            {/* 상품코드 모드 뱃지 */}
            {isProductCode && (
              <span style={{
                position: 'absolute',
                right: 36,
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#2563eb',
                color: '#fff',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                pointerEvents: 'none',
              }}>상품코드</span>
            )}
            {/* 검색어 초기화 버튼 */}
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 2,
                }}
                aria-label="검색어 지우기"
              >
                ✕
              </button>
            )}
          </div>

          {/* 정렬 버튼 */}
          <button
            onClick={() => setIsSortOpen(true)}
            style={{
              height: '36px',
              padding: '0 12px',
              fontSize: '13px',
              fontWeight: 600,
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              backgroundColor: sort !== 'sourcing_score_desc' ? '#1a1c1c' : '#ffffff',
              color: sort !== 'sourcing_score_desc' ? '#ffffff' : '#374151',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            정렬
          </button>

          {/* 필터 버튼 */}
          <button
            onClick={() => setIsFilterOpen(true)}
            style={{
              height: '36px',
              padding: '0 12px',
              fontSize: '13px',
              fontWeight: 600,
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              backgroundColor: activeFilterCount > 0 ? '#1a1c1c' : '#ffffff',
              color: activeFilterCount > 0 ? '#ffffff' : '#374151',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            필터
            {activeFilterCount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '16px',
                  height: '16px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  borderRadius: '50%',
                  fontSize: '10px',
                  fontWeight: 700,
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* 활성 필터 칩 바 */}
        {activeFilterCount > 0 && (
          <MobileFilterChipBar
            filters={filters}
            sort={sort}
            onClearFilter={handleClearFilter}
            onClearSort={handleClearSort}
          />
        )}

        {/* 통계 바 */}
        <div
          style={{
            padding: '8px 16px',
            fontSize: '12px',
            color: '#6b7280',
            backgroundColor: '#f4f4f4',
          }}
        >
          전체 {total.toLocaleString()}개
          {lastCollected && ` · 수집 ${fmtDate(lastCollected)}`}
        </div>

        {/* 로딩 상태 */}
        {isLoading && <MobileCostcoSkeletonList />}

        {/* 빈 상태 */}
        {!isLoading && isEmpty && (
          <MobileEmptyState
            hasFilter={activeFilterCount > 0}
            searchTerm={debouncedSearch || undefined}
            onResetFilter={() => {
              setFilters(DEFAULT_FILTER_STATE);
              setSearch('');
            }}
          />
        )}

        {/* 상품코드 모드: MobileCodeSearchCard 표시 */}
        {isProductCode && (
          <MobileCodeSearchCard
            code={search}
            onClose={() => setSearch('')}
          />
        )}

        {/* 카드 목록 */}
        {!isLoading &&
          filteredProducts.map((p) => (
            <MobileCostcoCard key={p.id} product={p} onTap={setSelectedProduct} />
          ))}

        {/* 추가 로딩 스켈레톤 */}
        {isFetchingMore && <MobileCostcoSkeletonList count={3} />}

        {/* 무한스크롤 sentinel */}
        <div ref={sentinelRef} style={{ height: '1px' }} />

        {/* 하단 여백 */}
        <div style={{ height: '32px' }} />
      </div>

      {/* 필터 바텀시트 */}
      <MobileFilterSheet
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        filterState={filters}
        onApply={(newFilters) => {
          setFilters(newFilters);
          setIsFilterOpen(false);
        }}
        categories={categories}
      />

      {/* 정렬 바텀시트 */}
      <MobileSortSheet
        isOpen={isSortOpen}
        onClose={() => setIsSortOpen(false)}
        currentSort={sort}
        onSelect={(s) => {
          setSort(s);
          setIsSortOpen(false);
        }}
      />

      {/* 상세 바텀시트 */}
      <MobileBottomSheet
        isOpen={selectedProduct !== null}
        onClose={() => setSelectedProduct(null)}
        title="상품 상세"
        maxHeight={85}
      >
        {selectedProduct && (
          <MobileCostcoDetail
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onUpdateProduct={updateProduct}
          />
        )}
      </MobileBottomSheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton export (loading.tsx에서 사용)
// ─────────────────────────────────────────────────────────────────────────────

export function MobileCostcoListSkeleton() {
  return (
    <div style={{ backgroundColor: '#f4f4f4', minHeight: '100vh' }}>
      {/* 검색바 skeleton */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          padding: '10px 12px',
          display: 'flex',
          gap: '8px',
        }}
      >
        <div
          style={{
            flex: 1,
            height: '36px',
            backgroundColor: '#e5e7eb',
            borderRadius: '8px',
            animation: 'mobileSkeleton 1.5s ease-in-out infinite',
          }}
        />
        <div
          style={{
            width: '52px',
            height: '36px',
            backgroundColor: '#e5e7eb',
            borderRadius: '8px',
            animation: 'mobileSkeleton 1.5s ease-in-out infinite',
          }}
        />
        <div
          style={{
            width: '52px',
            height: '36px',
            backgroundColor: '#e5e7eb',
            borderRadius: '8px',
            animation: 'mobileSkeleton 1.5s ease-in-out infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes mobileSkeleton {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <MobileCostcoSkeletonList />
    </div>
  );
}

