'use client';

/**
 * CostcoTab.tsx
 * 코스트코 소싱 탭 — 단가 경쟁력 중심 재설계
 *
 * 핵심 가치: "코스트코 단가 vs 네이버 단가" 비교로 가격 경쟁력을 한눈에
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, Search, X, ExternalLink,
  ChevronDown, Edit2, Check, ShoppingCart, TrendingDown, TrendingUp,
} from 'lucide-react';
import type { CostcoProductRow, CostcoSortKey } from '@/types/costco';
import { STOCK_STATUS_LABELS, MARGIN_CONSTANTS } from '@/lib/sourcing/costco-constants';

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
  blueBg: '#eff6ff',
  savingHigh: '#15803d',    // 절감율 30%+
  savingMid: '#ca8a04',     // 절감율 15-30%
  savingLow: '#6b7280',     // 절감율 0-15%
  expensiveHigh: '#dc2626', // 비쌈 30%+
  expensiveMid: '#ea580c',  // 비쌈 15-30%
  expensiveLow: '#6b7280',  // 비쌈 0-15%
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

/** 마진율 계산 (시장가 기반) */
function calcMarginRate(purchasePrice: number, marketPrice: number | null): number | null {
  if (!marketPrice || marketPrice <= 0) return null;
  const { MARKETPLACE_FEE_RATE, LOGISTICS_FEE, TAX_RATE } = MARGIN_CONSTANTS;
  const net = (marketPrice * (1 - MARKETPLACE_FEE_RATE) - purchasePrice - LOGISTICS_FEE) / (1 + TAX_RATE);
  return net / marketPrice * 100;
}

function fmtMarginRate(rate: number | null): string {
  if (rate == null) return '-';
  return `${rate.toFixed(1)}%`;
}

function marginColor(rate: number | null): string {
  if (rate == null) return C.textSub;
  if (rate >= 20) return C.green;
  if (rate >= 10) return C.orange;
  if (rate > 0) return '#ca8a04';
  return C.red;
}

function marginBg(rate: number | null): string {
  if (rate == null) return 'transparent';
  if (rate >= 20) return C.greenBg;
  if (rate >= 10) return C.orangeBg;
  if (rate > 0) return '#fffbeb';
  return C.redBg;
}

/** 소싱 스코어 색상 */
function scoreColor(score: number): string {
  if (score >= 70) return C.green;
  if (score >= 40) return C.orange;
  return C.textSub;
}

/** 재고 상태 색상 */
function stockColor(status: string): string {
  if (status === 'inStock') return C.green;
  if (status === 'lowStock') return C.orange;
  return C.red;
}

/** 단가 절감율/비쌈 색상 */
function savingColor(rate: number | null): string {
  if (rate == null) return C.textSub;
  // 코스트코가 저렴한 경우 (양수)
  if (rate >= 30) return C.savingHigh;
  if (rate >= 15) return C.savingMid;
  if (rate >= 0) return C.savingLow;
  // 코스트코가 비싼 경우 (음수)
  if (rate <= -30) return C.expensiveHigh;
  if (rate <= -15) return C.expensiveMid;
  return C.expensiveLow;
}

function savingBg(rate: number | null): string {
  if (rate == null) return 'transparent';
  if (rate >= 30) return '#f0fdf4';
  if (rate >= 15) return '#fefce8';
  if (rate >= 0) return '#f9fafb';
  if (rate <= -30) return '#fef2f2';
  if (rate <= -15) return '#fff7ed';
  return '#f9fafb';
}

/**
 * 단가 절감율 계산 헬퍼
 * costcoUnit 대비 naverUnit이 얼마나 비싼지 퍼센트로 반환 (소수점 1자리)
 * 양수면 코스트코가 저렴, 음수면 코스트코가 더 비쌈
 */
function calcUnitSavingRate(costcoUnit: number | null | undefined, naverUnit: number | null | undefined): number | null {
  if (!costcoUnit || !naverUnit || costcoUnit <= 0) return null;
  return Math.round((naverUnit / costcoUnit - 1) * 1000) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// 단가 절감율/비쌈 뱃지
// ─────────────────────────────────────────────────────────────────────────────
function SavingBadge({ rate }: { rate: number | null }) {
  if (rate == null) return <span style={{ color: '#c4c4c4', fontSize: '11px' }}>-</span>;

  const color = savingColor(rate);
  const bg = savingBg(rate);
  const isCheaper = rate >= 0;
  const absRate = Math.abs(rate);

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        padding: '3px 7px', borderRadius: '12px',
        backgroundColor: bg,
        border: `1px solid ${color}30`,
      }}
    >
      {isCheaper
        ? <TrendingDown size={10} color={color} />
        : <TrendingUp size={10} color={color} />
      }
      <span style={{ fontSize: '12px', fontWeight: 700, color }}>
        {isCheaper ? '▼' : '▲'}{absRate.toFixed(1)}%
      </span>
      <span style={{ fontSize: '10px', color, opacity: 0.8 }}>
        {isCheaper ? '저렴' : '비쌈'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 단가 비교 셀
// ─────────────────────────────────────────────────────────────────────────────
function UnitPriceCell({ product }: { product: CostcoProductRow }) {
  // 새 컬럼(unit_price, unit_price_label) 우선, 없으면 기존 컬럼 폴백
  const costcoUnitPrice = product.unit_price ?? product.costco_unit_price ?? null;
  const naverUnitPrice = product.market_unit_price ?? product.naver_unit_price ?? null;
  // 단가 레이블: 새 컬럼 우선, 없으면 기존 costco_unit에서 "/{unit}" 형태로 표시
  const unitLabel = product.unit_price_label ?? (product.costco_unit ? product.costco_unit : null);

  if (costcoUnitPrice == null && !unitLabel) {
    return <span style={{ color: '#c4c4c4', fontSize: '11px' }}>단위 미확인</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '110px' }}>
      {/* 코스트코 단가 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span
          style={{
            fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
            backgroundColor: C.accent + '14', color: C.accent, flexShrink: 0,
          }}
        >
          코C
        </span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>
          {costcoUnitPrice != null ? fmtPrice(costcoUnitPrice) : '-'}
        </span>
        {unitLabel && (
          <span style={{ fontSize: '10px', color: C.textSub }}>/{unitLabel}</span>
        )}
      </div>

      {/* 네이버 단가 */}
      {naverUnitPrice != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px',
              backgroundColor: '#e8f9ee', color: '#03c75a', flexShrink: 0,
            }}
          >
            N
          </span>
          <span style={{ fontSize: '12px', color: C.textSub }}>
            {fmtPrice(naverUnitPrice)}
          </span>
          {unitLabel && (
            <span style={{ fontSize: '10px', color: C.textSub }}>/{unitLabel}</span>
          )}
        </div>
      )}

      {/* 매칭된 네이버 상품명 (있을 경우) */}
      {product.market_unit_title && (
        <div
          style={{ fontSize: '9px', color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}
          title={product.market_unit_title}
        >
          {product.market_unit_title}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 소싱 스코어 툴팁 뱃지
// ─────────────────────────────────────────────────────────────────────────────
function ScoreBadge({ product }: { product: CostcoProductRow }) {
  const [show, setShow] = useState(false);
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
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '38px', height: '22px', borderRadius: '11px',
          backgroundColor: scoreColor(product.sourcing_score) + '18',
          color: scoreColor(product.sourcing_score),
          fontWeight: 700, fontSize: '12px', cursor: 'default',
          border: `1px solid ${scoreColor(product.sourcing_score)}44`,
        }}
      >
        {product.sourcing_score}
      </div>

      {show && (
        <div
          style={{
            position: 'absolute',
            ...(above ? { bottom: '28px' } : { top: '28px' }),
            left: '50%', transform: 'translateX(-50%)',
            backgroundColor: '#1a1c1c', color: '#fff', borderRadius: '8px',
            padding: '10px 12px', fontSize: '11px', lineHeight: '1.7',
            whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f9f9f9' }}>소싱 스코어 분석</div>
          <div>수요 점수 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.demand_score}</span> / 100 × 25%</div>
          <div>가격 기회 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.price_opp_score}</span> / 100 × 30%</div>
          <div>긴급성     <span style={{ color: '#86efac', fontWeight: 600 }}>{product.urgency_score}</span> / 100 × 15%</div>
          <div>계절성     <span style={{ color: '#86efac', fontWeight: 600 }}>{product.seasonal_score}</span> / 100 × 15%</div>
          <div>마진       <span style={{ color: '#86efac', fontWeight: 600 }}>{product.margin_score}</span> / 100 × 15%</div>
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
// 시장가 인라인 편집 셀
// ─────────────────────────────────────────────────────────────────────────────
function MarketPriceCell({
  product,
  onUpdated,
}: {
  product: CostcoProductRow;
  onUpdated: (productCode: string, marketPrice: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setValue(product.market_lowest_price ? String(product.market_lowest_price) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const save = async () => {
    const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
    if (isNaN(num) || num <= 0) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/sourcing/costco/market-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: product.product_code, marketPrice: num, source: 'manual' }),
      });
      if (res.ok) {
        onUpdated(product.product_code, num);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            width: '90px', height: '26px', padding: '0 6px',
            border: `1px solid ${C.accent}`, borderRadius: '4px',
            fontSize: '12px', textAlign: 'right', outline: 'none',
          }}
          placeholder="시장가 입력"
        />
        <button
          onClick={save}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '22px', border: 'none',
            backgroundColor: C.accent, borderRadius: '4px',
            color: '#fff', cursor: 'pointer',
          }}
        >
          {saving ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={10} />}
        </button>
        <button
          onClick={() => setEditing(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '22px', height: '22px', border: `1px solid ${C.border}`,
            backgroundColor: C.card, borderRadius: '4px', cursor: 'pointer',
          }}
        >
          <X size={10} color={C.textSub} />
        </button>
      </div>
    );
  }

  const isNaverSource = product.market_price_source === 'naver_api';

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
      onClick={startEdit}
      title={isNaverSource ? '네이버 자동 수집 (클릭하여 수동 수정)' : '클릭하여 시장가 입력'}
    >
      {product.market_lowest_price ? (
        <>
          <span style={{ fontWeight: 600, color: C.text }}>
            {fmtPrice(product.market_lowest_price)}
          </span>
          <span
            style={{
              fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px',
              backgroundColor: isNaverSource ? '#e8f9ee' : '#f0f0f0',
              color: isNaverSource ? '#03c75a' : C.textSub,
              flexShrink: 0,
            }}
          >
            {isNaverSource ? 'N' : '수동'}
          </span>
        </>
      ) : (
        <span style={{ color: '#c4c4c4', fontSize: '11px' }}>입력 필요</span>
      )}
      <Edit2 size={10} color={C.textSub} style={{ flexShrink: 0 }} />
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

/** 가격 경쟁력 필터 값 */
type SavingFilter = 'all' | 'high' | 'mid' | 'any';

export default function CostcoTab() {
  const [products, setProducts] = useState<CostcoProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);

  // 필터 & 정렬
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'inStock' | 'lowStock' | 'outOfStock'>('all');
  const [savingFilter, setSavingFilter] = useState<SavingFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<CostcoSortKey>('unit_saving_rate_desc');
  const [page, setPage] = useState(1);
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
      if (categoryFilter) params.set('category', categoryFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (stockFilter !== 'all') params.set('stockStatus', stockFilter);
      if (savingFilter !== 'all') params.set('savingFilter', savingFilter);

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
  }, [categoryFilter, stockFilter, savingFilter, debouncedSearch, sort, page]);

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

  // ── 시장가 업데이트 후 로컬 상태 갱신
  const handleMarketPriceUpdated = (productCode: string, marketPrice: number) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.product_code === productCode
          ? { ...p, market_lowest_price: marketPrice, market_price_source: 'manual' }
          : p,
      ),
    );
    setTimeout(fetchProducts, 500);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilter = !!(categoryFilter || debouncedSearch || stockFilter !== 'all' || savingFilter !== 'all');

  // 정렬 헤더 클릭 핸들러
  const handleSortClick = (key: CostcoSortKey) => {
    setSort(key);
    setPage(1);
  };

  // 정렬 아이콘
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

        {/* 가격 경쟁력 필터 — 핵심 신규 필터 */}
        <select
          value={savingFilter}
          onChange={(e) => { setSavingFilter(e.target.value as SavingFilter); setPage(1); }}
          style={{
            ...selectStyle,
            // 선택된 경우 강조
            borderColor: savingFilter !== 'all' ? C.savingHigh : C.border,
            color: savingFilter !== 'all' ? C.savingHigh : C.text,
            fontWeight: savingFilter !== 'all' ? 600 : 400,
          }}
        >
          <option value="all">단가 절감율 전체</option>
          <option value="high">30% 이상 절감 (매력적)</option>
          <option value="mid">15% 이상 절감 (양호)</option>
          <option value="any">단가 비교 가능한 것만</option>
        </select>

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
          onChange={(e) => { handleSortClick(e.target.value as CostcoSortKey); }}
          style={selectStyle}
        >
          <option value="unit_saving_rate_desc">단가 절감율 높은순</option>
          <option value="margin_rate_desc">마진율 높은순</option>
          <option value="sourcing_score_desc">소싱스코어 높은순</option>
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
              setSavingFilter('all');
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
                    <th style={{ ...thStyle, width: '52px', textAlign: 'center' }}>이미지</th>

                    {/* 상품명 */}
                    <th style={{ ...thStyle, minWidth: '220px', textAlign: 'left' }}>상품명</th>

                    {/* 매입가 */}
                    <th
                      style={{ ...thStyle, width: '100px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('price_asc')}
                      title="매입가 낮은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        매입가 <SortIcon col="price_asc" />
                      </span>
                    </th>

                    {/* 단가 비교 — 핵심 신규 컬럼 */}
                    <th style={{ ...thStyle, width: '180px', textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        단가 비교
                        <span
                          style={{
                            fontSize: '9px', fontWeight: 600, padding: '1px 4px', borderRadius: '3px',
                            backgroundColor: '#dcfce7', color: C.savingHigh,
                          }}
                        >
                          코C vs 네이버
                        </span>
                      </span>
                    </th>

                    {/* 단가 절감율 — 핵심 신규 컬럼 */}
                    <th
                      style={{ ...thStyle, width: '120px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('unit_saving_rate_desc')}
                      title="단가 절감율 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        단가 절감율 <SortIcon col="unit_saving_rate_desc" />
                      </span>
                    </th>

                    {/* 시장가(네이버) */}
                    <th style={{ ...thStyle, width: '120px', textAlign: 'right' }}>
                      시장가
                      <span style={{ fontWeight: 400, color: '#aaa', marginLeft: '3px' }}>(네이버)</span>
                    </th>

                    {/* 마진율 */}
                    <th
                      style={{ ...thStyle, width: '72px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('margin_rate_desc')}
                      title="마진율 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        마진율 <SortIcon col="margin_rate_desc" />
                      </span>
                    </th>

                    {/* 소싱 스코어 */}
                    <th
                      style={{ ...thStyle, width: '70px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('sourcing_score_desc')}
                      title="소싱 스코어 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        스코어 <SortIcon col="sourcing_score_desc" />
                      </span>
                    </th>

                    {/* 재고 */}
                    <th style={{ ...thStyle, width: '72px', textAlign: 'center' }}>재고</th>

                    {/* 링크 */}
                    <th style={{ ...thStyle, width: '72px', textAlign: 'center' }}>링크</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, idx) => {
                    const bgColor = idx % 2 === 0 ? C.card : '#fafafa';
                    const naverQuery = encodeURIComponent(product.title);
                    const naverUrl = `https://search.shopping.naver.com/search/all?query=${naverQuery}`;
                    const coupangUrl = `https://www.coupang.com/np/search?q=${naverQuery}`;
                    const marginRate = calcMarginRate(product.price, product.market_lowest_price);
                    // 새 컬럼(unit_price, market_unit_price)으로 절감율 재계산, 없으면 기존 unit_saving_rate 사용
                    const savingRate =
                      (product.unit_price != null && product.market_unit_price != null)
                        ? calcUnitSavingRate(product.unit_price, product.market_unit_price)
                        : product.unit_saving_rate;

                    return (
                      <tr
                        key={product.id}
                        style={{ backgroundColor: bgColor, borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.rowHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = bgColor)}
                      >
                        {/* 이미지 */}
                        <td style={{ padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
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
                            style={{ fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}
                            title={product.title}
                          >
                            {product.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                            {product.brand && (
                              <span style={{ fontSize: '10px', color: C.textSub }}>{product.brand}</span>
                            )}
                            {product.category_name && (
                              <span
                                style={{
                                  fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                                  backgroundColor: '#f3f3f3', color: C.textSub,
                                }}
                              >
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

                        {/* 단가 비교 */}
                        <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                          <UnitPriceCell product={product} />
                        </td>

                        {/* 단가 절감율 */}
                        <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <SavingBadge rate={savingRate ?? null} />
                        </td>

                        {/* 시장가 (인라인 입력) */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <MarketPriceCell
                            product={product}
                            onUpdated={handleMarketPriceUpdated}
                          />
                        </td>

                        {/* 마진율 */}
                        <td style={{ padding: '6px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px', borderRadius: '10px',
                              backgroundColor: marginBg(marginRate),
                              fontWeight: 600, fontSize: '12px',
                              color: marginColor(marginRate),
                            }}
                          >
                            {fmtMarginRate(marginRate)}
                          </div>
                        </td>

                        {/* 소싱 스코어 */}
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
};
