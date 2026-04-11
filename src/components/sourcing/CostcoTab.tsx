'use client';

/**
 * CostcoTab.tsx
 * 코스트코 온라인몰 상품 수집·조회 탭
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, X, ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (SourcingDashboard 동일 테마)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#f5f5f5',
};

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = 'price_asc' | 'price_desc' | 'title_asc' | 'collected_desc';

interface CostcoProductRow {
  id: string;
  product_code: string;
  title: string;
  category_name: string | null;
  price: number;
  original_price: number | null;
  image_url: string | null;
  product_url: string;
  collected_at: string;
}

interface ApiResponse {
  products: CostcoProductRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  lastCollected: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function CostcoTab() {
  const [products, setProducts] = useState<CostcoProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  // 필터
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('collected_desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  };

  // 상품 목록 fetch
  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
      if (categoryFilter) params.set('category', categoryFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`/api/sourcing/costco?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiResponse = await res.json();
      setProducts(data.products);
      setTotal(data.total);
      setCategories(data.categories);
      setLastCollected(data.lastCollected);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패');
    } finally {
      setIsLoading(false);
    }
  }, [categoryFilter, debouncedSearch, sort, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // 스크래핑 실행
  const handleScrape = async () => {
    if (isScraping) return;
    setIsScraping(true);
    setScrapeError(null);
    try {
      const res = await fetch('/api/sourcing/costco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchProducts();
    } catch (e) {
      setScrapeError(e instanceof Error ? e.message : '수집 실패');
    } finally {
      setIsScraping(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const fmtPrice = (n: number) => n.toLocaleString('ko-KR') + '원';
  const fmtDate = (iso: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 정렬 토글 헬퍼
  const handlePriceSort = () => setSort((s) => s === 'price_asc' ? 'price_desc' : 'price_asc');

  return (
    <div style={{ backgroundColor: C.bg, minHeight: '100%' }}>

      {/* ── 헤더 바 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 24px', backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: C.textSub }}>
            마지막 수집: <strong style={{ color: C.text }}>{fmtDate(lastCollected)}</strong>
          </span>
          <span style={{ fontSize: '13px', color: C.textSub }}>
            전체 <strong style={{ color: C.text }}>{total.toLocaleString()}</strong>개
          </span>
        </div>

        <button
          onClick={handleScrape}
          disabled={isScraping}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 16px',
            backgroundColor: isScraping ? '#f3f3f3' : C.accent,
            color: isScraping ? C.textSub : '#fff',
            border: 'none', borderRadius: '6px',
            fontSize: '13px', fontWeight: 600,
            cursor: isScraping ? 'not-allowed' : 'pointer',
          }}
        >
          {isScraping
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> 수집 중...</>
            : <><RefreshCw size={13} /> 코스트코 수집</>
          }
        </button>
      </div>

      {/* ── 스크래핑 에러 */}
      {scrapeError && (
        <div
          style={{
            margin: '12px 24px 0', padding: '10px 14px',
            backgroundColor: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px',
            fontSize: '13px', color: '#dc2626',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>⚠️ {scrapeError}</span>
          <button onClick={() => setScrapeError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 필터 툴바 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 24px', flexWrap: 'wrap',
        }}
      >
        {/* 검색 */}
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textSub }} />
          <input
            type="text"
            placeholder="상품명 검색"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              paddingLeft: '30px', paddingRight: '10px', height: '32px',
              border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '12px', width: '200px', color: C.text,
              backgroundColor: C.card, outline: 'none',
            }}
          />
        </div>

        {/* 카테고리 */}
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          style={{
            height: '32px', padding: '0 10px',
            border: `1px solid ${C.border}`, borderRadius: '6px',
            fontSize: '12px', color: C.text, backgroundColor: C.card, cursor: 'pointer',
          }}
        >
          <option value="">전체 카테고리</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* 초기화 */}
        {(categoryFilter || debouncedSearch) && (
          <button
            onClick={() => { setCategoryFilter(''); setSearchQuery(''); setDebouncedSearch(''); setPage(1); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              height: '32px', padding: '0 10px',
              border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '12px', color: C.textSub, backgroundColor: C.card, cursor: 'pointer',
            }}
          >
            <X size={12} /> 초기화
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.textSub }}>
          {total > 0
            ? `${Math.min((page - 1) * PAGE_SIZE + 1, total)}–${Math.min(page * PAGE_SIZE, total)} / ${total.toLocaleString()}개`
            : '0개'}
        </span>
      </div>

      {/* ── 테이블 */}
      <div style={{ padding: '0 24px 24px' }}>
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', gap: '8px', color: C.textSub }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px' }}>로딩 중...</span>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: '#dc2626', fontSize: '13px' }}>
              ⚠️ {error}
            </div>
          ) : products.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '240px', gap: '12px' }}>
              <span style={{ fontSize: '32px' }}>🏬</span>
              <span style={{ fontSize: '14px', color: C.textSub }}>수집된 상품이 없습니다.</span>
              <span style={{ fontSize: '12px', color: C.textSub }}>「코스트코 수집」 버튼을 눌러 스크래핑을 시작하세요.</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: C.tableHeader }}>
                  {/* 이미지 */}
                  <th style={{ ...thStyle, width: '60px' }}>이미지</th>
                  {/* 상품명 */}
                  <th style={{ ...thStyle, textAlign: 'left' }}>상품명</th>
                  {/* 카테고리 */}
                  <th style={{ ...thStyle, width: '110px' }}>카테고리</th>
                  {/* 가격 — 정렬 버튼 */}
                  <th
                    style={{ ...thStyle, width: '120px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    onClick={handlePriceSort}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                      가격
                      {sort === 'price_asc'
                        ? <ChevronUp size={11} />
                        : sort === 'price_desc'
                          ? <ChevronDown size={11} />
                          : <span style={{ opacity: 0.4 }}><ChevronUp size={11} /></span>
                      }
                    </span>
                  </th>
                  {/* 링크 */}
                  <th style={{ ...thStyle, width: '48px', textAlign: 'center' }}>링크</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => (
                  <tr
                    key={product.id}
                    style={{ backgroundColor: idx % 2 === 0 ? C.card : '#fafafa', borderBottom: `1px solid ${C.border}` }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = idx % 2 === 0 ? C.card : '#fafafa')}
                  >
                    {/* 이미지 */}
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.title}
                          style={{ width: '40px', height: '40px', objectFit: 'contain', borderRadius: '4px', border: `1px solid ${C.border}` }}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div style={{ width: '40px', height: '40px', backgroundColor: C.tableHeader, borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
                          🏬
                        </div>
                      )}
                    </td>

                    {/* 상품명 */}
                    <td style={{ padding: '8px 10px', color: C.text, fontWeight: 500, maxWidth: '360px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={product.title}>
                        {product.title}
                      </div>
                    </td>

                    {/* 카테고리 */}
                    <td style={{ padding: '8px 10px', color: C.textSub }}>
                      {product.category_name ?? '-'}
                    </td>

                    {/* 가격 */}
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: C.text }}>
                        {fmtPrice(product.price)}
                      </div>
                      {product.original_price && product.original_price !== product.price && (
                        <div style={{ fontSize: '11px', color: C.textSub, textDecoration: 'line-through' }}>
                          {fmtPrice(product.original_price)}
                        </div>
                      )}
                    </td>

                    {/* 링크 */}
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <a
                        href={product.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: C.textSub, display: 'inline-flex' }}
                        title="코스트코에서 보기"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <button
              onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
              style={{ ...pageBtn, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
            >
              이전
            </button>
            <span style={{ fontSize: '12px', color: C.textSub }}>{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
              style={{ ...pageBtn, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
            >
              다음
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 인라인 스타일 상수
// ─────────────────────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  color: '#926f6b',
  fontSize: '11px',
  borderBottom: '1px solid #eeeeee',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

const pageBtn: React.CSSProperties = {
  padding: '5px 12px',
  border: '1px solid #eeeeee',
  borderRadius: '5px',
  fontSize: '12px',
  backgroundColor: '#ffffff',
  color: '#1a1c1c',
};
