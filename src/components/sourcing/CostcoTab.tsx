'use client';

/**
 * CostcoTab.tsx
 * 코스트코 소싱 탭 — 단위 가격 기반 경쟁력 분석
 *
 * 컬럼: 매입가 | 단위가격(코스트코) | 단위가격(네이버) | 단가절감율 | 추천판매가 | 스코어 | 재고 | 링크
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, Search, X, ExternalLink,
  ChevronDown, ShoppingCart, Pencil, Check, Ban,
} from 'lucide-react';
import type { CostcoProductRow, CostcoSortKey } from '@/types/costco';
import { STOCK_STATUS_LABELS } from '@/lib/sourcing/costco-constants';
import {
  calcRecommendedPrice, calcGrade, getWeightKgFromProduct,
  GRADE_COLORS, type SourcingGrade,
} from '@/lib/sourcing/costco-pricing';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#fef7f7',
  green: '#16a34a',
  greenBg: '#f0fdf4',
  orange: '#ea580c',
  orangeBg: '#fff7ed',
  red: '#dc2626',
  redBg: '#fef2f2',
  blue: '#2563eb',
  naver: '#03c75a',
  naverBg: '#e8f9ee',
  coupang: '#e52222',
  coupangBg: '#fff0f0',
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

const fmtPrice = (n: number | null | undefined) =>
  n != null ? n.toLocaleString('ko-KR') + '원' : '-';

const fmtDate = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function scoreColor(score: number): string {
  if (score >= 70) return C.green;
  if (score >= 40) return C.orange;
  return C.textSub;
}

function stockColor(status: string): string {
  if (status === 'inStock') return C.green;
  if (status === 'lowStock') return C.orange;
  return C.red;
}

function marginColor(rate: number): string {
  if (rate >= 0.25) return C.green;
  if (rate >= 0.15) return C.orange;
  if (rate > 0)     return C.textSub;
  return C.red;
}

// ─────────────────────────────────────────────────────────────────────────────
// 채널 추천가 셀 (네이버 / 쿠팡)
// ─────────────────────────────────────────────────────────────────────────────
function ChannelPriceCell({
  product,
  channel,
}: {
  product: CostcoProductRow;
  channel: 'naver' | 'coupang';
}) {
  const weightKg    = getWeightKgFromProduct(product);
  const marketPrice = product.market_lowest_price ?? null;
  const pricing     = calcRecommendedPrice(
    product.price,
    product.category_name,
    channel,
    weightKg,
    marketPrice,
  );

  const channelColor = channel === 'naver' ? C.naver : C.coupang;
  const channelBg    = channel === 'naver' ? C.naverBg : C.coupangBg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
      <span style={{ fontWeight: 700, color: pricing.isOverprice ? C.red : C.text }}>
        {fmtPrice(pricing.recommendedPrice)}
      </span>
      <span style={{ fontSize: '10px', color: marginColor(pricing.realMarginRate), fontWeight: 600 }}>
        {(pricing.realMarginRate * 100).toFixed(1)}% 마진
      </span>
      {pricing.vsMarket != null && (
        <span
          style={{
            fontSize: '9px', fontWeight: 700, padding: '1px 5px',
            borderRadius: '8px', backgroundColor: channelBg, color: channelColor,
          }}
        >
          {pricing.isOverprice
            ? `시장가 +${Math.abs(pricing.vsMarket).toFixed(1)}% 초과`
            : `시장가 -${Math.abs(pricing.vsMarket).toFixed(1)}%`}
        </span>
      )}
      {!marketPrice && (
        <span style={{ fontSize: '9px', color: '#c4c4c4' }}>시장가 없음</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 실질마진율 셀
// ─────────────────────────────────────────────────────────────────────────────
function MarginRateCell({ product }: { product: CostcoProductRow }) {
  const weightKg    = getWeightKgFromProduct(product);
  const marketPrice = product.market_lowest_price ?? null;
  const naver       = calcRecommendedPrice(product.price, product.category_name, 'naver', weightKg, marketPrice);
  const coupang     = calcRecommendedPrice(product.price, product.category_name, 'coupang', weightKg, marketPrice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '9px', color: C.naver, fontWeight: 700 }}>N</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: marginColor(naver.realMarginRate) }}>
          {(naver.realMarginRate * 100).toFixed(1)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '9px', color: C.coupang, fontWeight: 700 }}>C</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: marginColor(coupang.realMarginRate) }}>
          {(coupang.realMarginRate * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 시장최저가 셀 (인라인 편집 + N/수동 뱃지)
// ─────────────────────────────────────────────────────────────────────────────
function MarketPriceCell({
  product,
  onSaved,
}: {
  product: CostcoProductRow;
  onSaved: (productCode: string, newPrice: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setInputVal(product.market_lowest_price ? String(product.market_lowest_price) : '');
    setEditing(true);
  };

  const handleSave = async () => {
    const price = parseInt(inputVal.replace(/[^0-9]/g, ''), 10);
    if (isNaN(price) || price <= 0) { setEditing(false); return; }
    setSaving(true);
    try {
      await fetch('/api/sourcing/costco/market-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: product.product_code, marketPrice: price, source: 'manual' }),
      });
      onSaved(product.product_code, price);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          style={{
            width: '80px', height: '24px', padding: '0 4px',
            border: `1px solid ${C.accent}`, borderRadius: '4px',
            fontSize: '11px', textAlign: 'right',
          }}
        />
        {saving
          ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          : <>
              <button onClick={handleSave} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, padding: '2px' }}><Check size={12} /></button>
              <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, padding: '2px' }}><Ban size={12} /></button>
            </>}
      </div>
    );
  }

  const price  = product.market_lowest_price;
  const source = product.market_price_source;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', cursor: 'pointer' }}
      onClick={startEdit}
      title="클릭하여 시장 최저가 편집"
    >
      {price ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {source === 'naver_api' && (
              <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '4px', backgroundColor: C.naverBg, color: C.naver }}>N</span>
            )}
            {source === 'manual' && (
              <span style={{ fontSize: '9px', fontWeight: 500, padding: '1px 4px', borderRadius: '4px', backgroundColor: '#f0f0f0', color: '#888' }}>수동</span>
            )}
            <span style={{ fontWeight: 600, color: C.text }}>{fmtPrice(price)}</span>
            <Pencil size={9} color={C.textSub} />
          </div>
        </>
      ) : (
        <span style={{ fontSize: '11px', color: '#c4c4c4', display: 'flex', alignItems: 'center', gap: '3px' }}>
          입력 <Pencil size={9} />
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 등급 뱃지
// ─────────────────────────────────────────────────────────────────────────────
function GradeBadge({ score }: { score: number }) {
  const grade = calcGrade(score);
  const { color, bg } = GRADE_COLORS[grade];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '24px', height: '24px', borderRadius: '6px',
        backgroundColor: bg, color, fontWeight: 800, fontSize: '13px',
        border: `1px solid ${color}44`,
      }}
    >
      {grade}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 소싱 스코어 툴팁 뱃지
// ─────────────────────────────────────────────────────────────────────────────
function ScoreBadge({ product }: { product: CostcoProductRow }) {
  const [show, setShow]   = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAbove(rect.top > 180);
    }
    setShow(true);
  };

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <GradeBadge score={product.sourcing_score} />
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          height: '20px', padding: '0 6px', borderRadius: '10px',
          backgroundColor: scoreColor(product.sourcing_score) + '18',
          color: scoreColor(product.sourcing_score),
          fontWeight: 600, fontSize: '11px', cursor: 'default',
          border: `1px solid ${scoreColor(product.sourcing_score)}44`,
        }}
      >
        {product.sourcing_score}
      </div>
      {show && (
        <div
          style={{
            position: 'absolute',
            ...(above ? { bottom: '30px' } : { top: '30px' }),
            left: '50%', transform: 'translateX(-50%)',
            backgroundColor: '#1a1c1c', color: '#fff', borderRadius: '8px',
            padding: '10px 12px', fontSize: '11px', lineHeight: '1.7',
            whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f9f9f9' }}>소싱 스코어 분석</div>
          <div>수요 점수 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.demand_score}</span> / 100 × 20%</div>
          <div>가격 기회 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.price_opp_score}</span> / 100 × 30%</div>
          <div>희소성     <span style={{ color: '#86efac', fontWeight: 600 }}>{product.urgency_score}</span> / 100 × 10%</div>
          <div>경쟁 강도  <span style={{ color: '#86efac', fontWeight: 600 }}>{product.seasonal_score}</span> / 100 × 15%</div>
          <div>마진       <span style={{ color: '#86efac', fontWeight: 600 }}>{product.margin_score}</span> / 100 × 25%</div>
          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '6px',
              paddingTop: '6px', fontWeight: 700,
            }}
          >
            종합 <span style={{ color: scoreColor(product.sourcing_score) }}>{product.sourcing_score}</span>점
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

interface ApiResponse {
  products: CostcoProductRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  lastCollected: string | null;
}

type GradeFilter = 'all' | SourcingGrade;

export default function CostcoTab() {
  const [products, setProducts]           = useState<CostcoProductRow[]>([]);
  const [total, setTotal]                 = useState(0);
  const [categories, setCategories]       = useState<string[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [isCollecting, setIsCollecting]   = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [collectError, setCollectError]   = useState<string | null>(null);

  // 필터 & 정렬
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter]       = useState<'all' | 'inStock' | 'lowStock' | 'outOfStock'>('all');
  const [gradeFilter, setGradeFilter]       = useState<GradeFilter>('all');
  const [overpriceOnly, setOverpriceOnly]   = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort]                     = useState<CostcoSortKey>('sourcing_score_desc');
  const [page, setPage]                     = useState(1);
  const PAGE_SIZE = 50;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  };

  // ── 상품 목록 fetch
  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort });
      if (categoryFilter)         params.set('category', categoryFilter);
      if (debouncedSearch)        params.set('search', debouncedSearch);
      if (stockFilter !== 'all')  params.set('stockStatus', stockFilter);

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
  }, [categoryFilter, stockFilter, debouncedSearch, sort, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ── 수집 실행
  const handleCollect = async () => {
    if (isCollecting) return;
    setIsCollecting(true);
    setCollectError(null);
    try {
      const res = await fetch('/api/sourcing/costco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await fetchProducts();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '수집 실패');
    } finally {
      setIsCollecting(false);
    }
  };

  // 시장최저가 인라인 업데이트 (리렌더 없이 로컬 반영)
  const handleMarketPriceSaved = (productCode: string, newPrice: number) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.product_code === productCode
          ? { ...p, market_lowest_price: newPrice, market_price_source: 'manual' }
          : p,
      ),
    );
  };

  // 등급/시장가초과 필터는 프론트엔드에서 처리
  const filteredProducts = products.filter((p) => {
    if (gradeFilter !== 'all' && calcGrade(p.sourcing_score) !== gradeFilter) return false;
    if (overpriceOnly) {
      const wKg = getWeightKgFromProduct(p);
      const mkt  = p.market_lowest_price ?? null;
      const naver = calcRecommendedPrice(p.price, p.category_name, 'naver', wKg, mkt);
      if (!naver.isOverprice) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilter  = !!(categoryFilter || debouncedSearch || stockFilter !== 'all' || gradeFilter !== 'all' || overpriceOnly);

  const handleSortClick = (key: CostcoSortKey) => { setSort(key); setPage(1); };

  const SortIcon = ({ col }: { col: CostcoSortKey }) => (
    sort === col
      ? <ChevronDown size={10} color={C.accent} />
      : <span style={{ opacity: 0.3 }}><ChevronDown size={10} /></span>
  );

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', color: C.textSub }}>
            마지막 수집: <strong style={{ color: C.text }}>{fmtDate(lastCollected)}</strong>
          </span>
          <span style={{ fontSize: '13px', color: C.textSub }}>
            전체 <strong style={{ color: C.text }}>{total.toLocaleString()}</strong>개
          </span>
        </div>
        <button
          onClick={handleCollect}
          disabled={isCollecting}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 16px',
            backgroundColor: isCollecting ? '#f3f3f3' : C.accent,
            color: isCollecting ? C.textSub : '#fff',
            border: 'none', borderRadius: '6px',
            fontSize: '13px', fontWeight: 600,
            cursor: isCollecting ? 'not-allowed' : 'pointer',
          }}
        >
          {isCollecting
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> 수집 중...</>
            : <><RefreshCw size={13} /> 코스트코 수집</>}
        </button>
      </div>

      {/* ── 에러 배너 */}
      {collectError && (
        <div
          style={{
            margin: '12px 24px 0', padding: '10px 14px',
            backgroundColor: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px',
            fontSize: '13px', color: C.red,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>수집 오류: {collectError}</span>
          <button onClick={() => setCollectError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 필터 툴바 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 24px', flexWrap: 'wrap',
          backgroundColor: C.card, borderBottom: `1px solid ${C.border}`,
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
              fontSize: '12px', width: '180px', color: C.text,
              backgroundColor: C.bg, outline: 'none',
            }}
          />
        </div>

        {/* 카테고리 */}
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="">전체 카테고리</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* 등급 필터 */}
        <select
          value={gradeFilter}
          onChange={(e) => { setGradeFilter(e.target.value as GradeFilter); setPage(1); }}
          style={{
            ...selectStyle,
            borderColor: gradeFilter !== 'all' ? '#7c3aed' : C.border,
            color:       gradeFilter !== 'all' ? '#7c3aed' : C.text,
            fontWeight:  gradeFilter !== 'all' ? 600 : 400,
          }}
        >
          <option value="all">등급 전체</option>
          <option value="S">S등급 (80점+)</option>
          <option value="A">A등급 (65점+)</option>
          <option value="B">B등급 (50점+)</option>
          <option value="C">C등급 (35점+)</option>
          <option value="D">D등급 (35점 미만)</option>
        </select>

        {/* 시장가 초과 필터 */}
        <button
          onClick={() => { setOverpriceOnly((v) => !v); setPage(1); }}
          style={{
            height: '32px', padding: '0 10px',
            border: `1px solid ${overpriceOnly ? C.red : C.border}`,
            borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
            backgroundColor: overpriceOnly ? C.redBg : C.bg,
            color: overpriceOnly ? C.red : C.textSub, fontWeight: overpriceOnly ? 600 : 400,
          }}
        >
          시장가 초과만
        </button>

        {/* 재고 상태 */}
        <select
          value={stockFilter}
          onChange={(e) => { setStockFilter(e.target.value as typeof stockFilter); setPage(1); }}
          style={selectStyle}
        >
          <option value="all">전체 재고</option>
          <option value="inStock">재고있음</option>
          <option value="lowStock">품절임박</option>
          <option value="outOfStock">품절</option>
        </select>

        {/* 정렬 */}
        <select
          value={sort}
          onChange={(e) => handleSortClick(e.target.value as CostcoSortKey)}
          style={selectStyle}
        >
          <option value="sourcing_score_desc">소싱스코어 높은순</option>
          <option value="margin_rate_desc">마진율 높은순</option>
          <option value="price_asc">매입가 낮은순</option>
          <option value="price_desc">매입가 높은순</option>
          <option value="review_count_desc">리뷰 많은순</option>
          <option value="collected_desc">최신 수집순</option>
        </select>

        {/* 초기화 */}
        {hasFilter && (
          <button
            onClick={() => {
              setCategoryFilter('');
              setSearchQuery('');
              setDebouncedSearch('');
              setStockFilter('all');
              setGradeFilter('all');
              setOverpriceOnly(false);
              setPage(1);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              height: '32px', padding: '0 10px',
              border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '12px', color: C.textSub, backgroundColor: C.bg, cursor: 'pointer',
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
      <div style={{ padding: '16px 24px 24px' }}>
        <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', gap: '8px', color: C.textSub }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px' }}>로딩 중...</span>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: C.red, fontSize: '13px' }}>
              조회 오류: {error}
            </div>
          ) : products.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '260px', gap: '12px' }}>
              <span style={{ fontSize: '40px' }}>🏬</span>
              <span style={{ fontSize: '14px', color: C.textSub, fontWeight: 500 }}>수집된 상품이 없습니다.</span>
              <span style={{ fontSize: '12px', color: C.textSub }}>상단의 「코스트코 수집」 버튼을 눌러 상품 수집을 시작하세요.</span>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: C.tableHeader }}>
                    {/* 이미지 */}
                    <th style={{ ...thStyle, width: '52px', textAlign: 'center' }}></th>

                    {/* 상품명 */}
                    <th style={{ ...thStyle, minWidth: '200px', textAlign: 'left' }}>상품명</th>

                    {/* 매입가 */}
                    <th
                      style={{ ...thStyle, width: '95px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('price_asc')}
                      title="매입가 낮은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        매입가 <SortIcon col="price_asc" />
                      </span>
                    </th>

                    {/* 시장최저가 */}
                    <th style={{ ...thStyle, width: '110px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '1px' }}>
                        <span>시장최저가</span>
                        <span style={{ fontSize: '9px', color: '#aaa' }}>클릭 편집</span>
                      </span>
                    </th>

                    {/* 추천가(네이버) */}
                    <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '1px' }}>
                        <span>추천가</span>
                        <span style={{ fontSize: '9px', fontWeight: 600, padding: '0px 4px', borderRadius: '3px', backgroundColor: C.naverBg, color: C.naver }}>
                          네이버 6%
                        </span>
                      </span>
                    </th>

                    {/* 추천가(쿠팡) */}
                    <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '1px' }}>
                        <span>추천가</span>
                        <span style={{ fontSize: '9px', fontWeight: 600, padding: '0px 4px', borderRadius: '3px', backgroundColor: C.coupangBg, color: C.coupang }}>
                          쿠팡 11%
                        </span>
                      </span>
                    </th>

                    {/* 실질마진율 */}
                    <th
                      style={{ ...thStyle, width: '90px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('margin_rate_desc')}
                      title="마진율 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        실질마진율 <SortIcon col="margin_rate_desc" />
                      </span>
                    </th>

                    {/* 등급/스코어 */}
                    <th
                      style={{ ...thStyle, width: '90px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('sourcing_score_desc')}
                      title="소싱 스코어 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        등급/점수 <SortIcon col="sourcing_score_desc" />
                      </span>
                    </th>

                    {/* 재고 */}
                    <th style={{ ...thStyle, width: '72px', textAlign: 'center' }}>재고</th>

                    {/* 링크 */}
                    <th style={{ ...thStyle, width: '72px', textAlign: 'center' }}>링크</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product, idx) => {
                    const bgColor    = idx % 2 === 0 ? C.card : '#fafafa';
                    const naverQuery = encodeURIComponent(product.title);
                    const naverUrl   = `https://search.shopping.naver.com/search/all?query=${naverQuery}`;
                    const coupangUrl = `https://www.coupang.com/np/search?q=${naverQuery}`;

                    return (
                      <tr
                        key={product.id}
                        style={{ backgroundColor: bgColor, borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = bgColor)}
                      >
                        {/* 이미지 */}
                        <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.title}
                              style={{ width: '36px', height: '36px', objectFit: 'contain', borderRadius: '4px', border: `1px solid ${C.border}` }}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <div style={{ width: '36px', height: '36px', backgroundColor: C.tableHeader, borderRadius: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
                              🏬
                            </div>
                          )}
                        </td>

                        {/* 상품명 */}
                        <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                          <div
                            style={{ fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}
                            title={product.title}
                          >
                            {product.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                            {product.brand && (
                              <span style={{ fontSize: '10px', color: C.textSub }}>{product.brand}</span>
                            )}
                            {product.category_name && (
                              <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', backgroundColor: '#f3f3f3', color: C.textSub }}>
                                {product.category_name}
                              </span>
                            )}
                            {product.average_rating && (
                              <span style={{ fontSize: '10px', color: '#ca8a04' }}>
                                ★ {Number(product.average_rating).toFixed(1)} ({product.review_count.toLocaleString()})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 매입가 */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: C.text }}>{fmtPrice(product.price)}</div>
                          {product.original_price && product.original_price !== product.price && (
                            <div style={{ fontSize: '10px', color: C.textSub, textDecoration: 'line-through' }}>
                              {fmtPrice(product.original_price)}
                            </div>
                          )}
                        </td>

                        {/* 시장최저가 */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <MarketPriceCell product={product} onSaved={handleMarketPriceSaved} />
                        </td>

                        {/* 추천가(네이버) */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <ChannelPriceCell product={product} channel="naver" />
                        </td>

                        {/* 추천가(쿠팡) */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <ChannelPriceCell product={product} channel="coupang" />
                        </td>

                        {/* 실질마진율 */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <MarginRateCell product={product} />
                        </td>

                        {/* 등급/스코어 */}
                        <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <ScoreBadge product={product} />
                        </td>

                        {/* 재고 상태 */}
                        <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: stockColor(product.stock_status) }}>
                            {STOCK_STATUS_LABELS[product.stock_status] ?? product.stock_status}
                          </span>
                        </td>

                        {/* 링크 */}
                        <td style={{ padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            <a
                              href={product.product_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="코스트코에서 보기"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10px', color: C.accent, textDecoration: 'none' }}
                            >
                              <ExternalLink size={10} /> 코스트코
                            </a>
                            <a
                              href={naverUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="네이버 쇼핑 검색"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10px', color: '#03c75a', textDecoration: 'none' }}
                            >
                              <Search size={10} /> 네이버
                            </a>
                            <a
                              href={coupangUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="쿠팡 검색"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '10px', color: '#e52222', textDecoration: 'none' }}
                            >
                              <ShoppingCart size={10} /> 쿠팡
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
// 스타일 상수
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

const selectStyle: React.CSSProperties = {
  height: '32px',
  padding: '0 10px',
  border: '1px solid #eeeeee',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#1a1c1c',
  backgroundColor: '#f9f9f9',
  cursor: 'pointer',
};

const pageBtn: React.CSSProperties = {
  padding: '5px 12px',
  border: '1px solid #eeeeee',
  borderRadius: '5px',
  fontSize: '12px',
  backgroundColor: '#ffffff',
  color: '#1a1c1c',
  cursor: 'pointer',
};
