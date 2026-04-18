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
  ChevronDown, ShoppingCart, ShieldCheck,
} from 'lucide-react';
import { C as BASE_C } from '@/lib/design-tokens';
import type { CostcoProductRow, CostcoSortKey } from '@/types/costco';
import { STOCK_STATUS_LABELS } from '@/lib/sourcing/costco-constants';
import {
  calcRecommendedPrice, calcGrade, getWeightKgFromProduct,
  GRADE_COLORS, type SourcingGrade,
} from '@/lib/sourcing/costco-pricing';
import { classifyMaleTarget, type MaleTier } from '@/lib/sourcing/shared/male-classifier';
import { getSeasonBonus } from '@/lib/sourcing/shared/season-bonus';
import { getCsRisk } from '@/lib/sourcing/domeggook-cs-filter';
import { COSTCO_SCORE_MAX, COSTCO_SCORE_LABELS } from '@/lib/sourcing/costco-scoring';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (공통 토큰 + 코스트코 탭 전용 확장)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  ...BASE_C,
  rowHover:   '#fef7f7', // 코스트코 탭 전용 hover 색상 (기본값 오버라이드)
  green:      '#16a34a',
  greenBg:    '#f0fdf4',
  orange:     '#ea580c',
  orangeBg:   '#fff7ed',
  red:        '#dc2626',
  redBg:      '#fef2f2',
  blue:       '#2563eb',
  naver:      '#03c75a',
  naverBg:    '#e8f9ee',
  coupang:    '#e52222',
  coupangBg:  '#fff0f0',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// v2 소싱 스코어 상수
// ─────────────────────────────────────────────────────────────────────────────

const MALE_TIER_BADGE: Record<MaleTier, string> = {
  high:    '🔵 남성',
  mid:     '⚪ 친화',
  neutral: '',
  female:  '🚫 여성',
};

/** v2 스코어 키 → DB 컬럼명 매핑 */
const SCORE_KEY_TO_DB: Record<string, keyof CostcoProductRow> = {
  legalIp:   'costco_score_legal',
  priceComp: 'costco_score_price',
  csSafety:  'costco_score_cs',
  margin:    'costco_score_margin',
  demand:    'costco_score_demand',
  turnover:  'costco_score_turnover',
  supply:    'costco_score_supply',
};

// ─────────────────────────────────────────────────────────────────────────────
// v2 실시간 계산 헬퍼 (DB null 시 fallback)
// ─────────────────────────────────────────────────────────────────────────────

/** DB에 male_tier가 있으면 그대로, 없으면 classifyMaleTarget으로 실시간 계산 */
function getEffectiveMaleTier(p: CostcoProductRow): MaleTier {
  if (p.male_tier) return p.male_tier as MaleTier;
  return classifyMaleTarget(p.title, p.category_name ?? '').tier;
}

/** 시즌 가산점은 날짜 의존 값이므로 항상 실시간 계산 */
function getEffectiveSeasonBonus(p: CostcoProductRow): { bonus: number; seasons: string[] } {
  const r = getSeasonBonus(p.title);
  return { bonus: r.bonus, seasons: r.matchedSeasons };
}

/** blocked_reason 우선, 없으면 실시간 판정 */
function getEffectiveBlockedReason(p: CostcoProductRow): string | null {
  if (p.blocked_reason != null) return p.blocked_reason;
  const male = classifyMaleTarget(p.title, p.category_name ?? '');
  if (male.legalBlocked) return '법적 통신판매 금지 키워드 포함';
  const cs = getCsRisk(p.category_name);
  if (cs.level === 'high') return `고위험 CS: ${cs.reason ?? ''}`;
  return null;
}

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

/** 단가 절감율 (양수 = 코스트코가 저렴) */
function calcUnitSavingRate(
  costcoUnit: number | null | undefined,
  naverUnit: number | null | undefined,
): number | null {
  if (!costcoUnit || !naverUnit || costcoUnit <= 0) return null;
  return Math.round((naverUnit / costcoUnit - 1) * 1000) / 10;
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
  const weightKg = getWeightKgFromProduct(product);

  // 시장가 환산: market_unit_price가 있으면 동일 수량 기준으로 환산
  // (예: 300매×6×4팩 → market_unit_price(1매당) × 7200 / 1)
  // DB effMarketExpr과 동일 로직
  const effMarketPrice: number | null = (() => {
    if (
      product.market_unit_price && product.market_unit_price > 0 &&
      product.total_quantity    && product.total_quantity    > 0
    ) {
      const divisor = product.unit_type === 'count' ? 1 : 100;
      return Math.round(product.market_unit_price * product.total_quantity / divisor);
    }
    return product.market_lowest_price ?? null;
  })();

  const pricing = calcRecommendedPrice(
    product.price,
    product.category_name,
    channel,
    weightKg,
    effMarketPrice,
  );

  const channelColor = channel === 'naver' ? C.naver : C.coupang;
  const channelBg    = channel === 'naver' ? C.naverBg : C.coupangBg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
      <span style={{ fontWeight: 700, color: pricing.isOverprice ? C.red : C.text }}>
        {fmtPrice(pricing.recommendedPrice)}
      </span>
      <span style={{ fontSize: '10px', color: marginColor(pricing.realMarginRate), fontWeight: 600 }}>
        {pricing.realMarginRate.toFixed(1)}% 마진
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
      {product.unit_type === 'count' && product.total_quantity && product.total_quantity > 1 && (
        <span style={{ fontSize: '9px', color: C.textSub }}>
          개당 {fmtPrice(pricing.perUnitPrice)}
        </span>
      )}
      {!effMarketPrice && (
        <span style={{ fontSize: '9px', color: '#c4c4c4' }}>시장가 없음</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
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

  const displayScore = product.costco_score_total ?? product.sourcing_score;

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <GradeBadge score={displayScore} />
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          height: '20px', padding: '0 6px', borderRadius: '10px',
          backgroundColor: scoreColor(displayScore) + '18',
          color: scoreColor(displayScore),
          fontWeight: 600, fontSize: '11px', cursor: 'default',
          border: `1px solid ${scoreColor(displayScore)}44`,
        }}
      >
        {displayScore}
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
          {product.costco_score_total != null ? (
            // v2 스코어 breakdown
            <>
              <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f9f9f9' }}>v2 소싱 스코어</div>
              {Object.entries(COSTCO_SCORE_MAX).map(([key, max]) => {
                const dbKey = SCORE_KEY_TO_DB[key];
                const val = dbKey ? (product[dbKey] as number | null) : null;
                const label = COSTCO_SCORE_LABELS[key];
                return (
                  <div key={key}>
                    {label} <span style={{ color: '#86efac', fontWeight: 600 }}>{val ?? '-'}</span> / {max}
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '6px', paddingTop: '6px', fontWeight: 700 }}>
                종합 <span style={{ color: scoreColor(product.costco_score_total) }}>{product.costco_score_total}</span>점 / 110
              </div>
            </>
          ) : (
            // v1 fallback
            <>
              <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f9f9f9' }}>소싱 스코어 분석</div>
              <div>수요 점수 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.demand_score}</span> / 100 × 20%</div>
              <div>가격 기회 <span style={{ color: '#86efac', fontWeight: 600 }}>{product.price_opp_score}</span> / 100 × 30%</div>
              <div>희소성     <span style={{ color: '#86efac', fontWeight: 600 }}>{product.urgency_score}</span> / 100 × 10%</div>
              <div>경쟁 강도  <span style={{ color: '#86efac', fontWeight: 600 }}>{product.seasonal_score}</span> / 100 × 15%</div>
              <div>마진       <span style={{ color: '#86efac', fontWeight: 600 }}>{product.margin_score}</span> / 100 × 25%</div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '6px', paddingTop: '6px', fontWeight: 700 }}>
                종합 <span style={{ color: scoreColor(product.sourcing_score) }}>{product.sourcing_score}</span>점
              </div>
            </>
          )}
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
type MaleTierFilter = 'all' | 'male_high' | 'male_friendly' | 'neutral' | 'female';

export interface CostcoTabProps {
  /** 외부 서브메뉴에서 주입하는 성별 타겟 필터 (변경 시 내부 상태 동기화) */
  externalGenderFilter?: MaleTierFilter;
}

export default function CostcoTab({ externalGenderFilter }: CostcoTabProps = {}) {
  const [products, setProducts]           = useState<CostcoProductRow[]>([]);
  const [total, setTotal]                 = useState(0);
  const [categories, setCategories]       = useState<string[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [isCollecting, setIsCollecting]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [collectError, setCollectError]     = useState<string | null>(null);
  const [collectResult, setCollectResult]   = useState<{ totalFetched: number; errorCount: number } | null>(null);
  const [isLegalChecking, setIsLegalChecking] = useState(false);
  const [legalCheckResult, setLegalCheckResult] = useState<{ checkedCount: number; blockedCount: number; warningCount: number } | null>(null);
  // IP 검증 상태: 현재 검증 중인 product_code, 완료된 결과 맵
  const [ipVerifyingId, setIpVerifyingId] = useState<string | null>(null);
  const [ipRiskMap, setIpRiskMap] = useState<Record<string, 'low' | 'medium' | 'high'>>({});

  // 필터 & 정렬
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter]       = useState<'all' | 'inStock' | 'lowStock' | 'outOfStock'>('all');
  const [gradeFilter, setGradeFilter]       = useState<GradeFilter>('all');
  const [overpriceOnly, setOverpriceOnly]   = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort]                     = useState<CostcoSortKey>('sourcing_score_desc');
  const [page, setPage]                     = useState(1);

  // v2 소싱 스코어 필터
  const [genderFilter, setGenderFilter]         = useState<MaleTierFilter>(externalGenderFilter ?? 'all');
  const [hideHighCs, setHideHighCs]             = useState(true);   // 기본 ON
  const [hideBlocked, setHideBlocked]           = useState(true);   // 기본 ON
  const [asteriskOnly, setAsteriskOnly]         = useState(false);
  const [seasonOnly, setSeasonOnly]             = useState(false);
  const PAGE_SIZE = 50;

  // 외부 서브메뉴 필터 변경 시 내부 상태 동기화
  useEffect(() => {
    if (externalGenderFilter !== undefined) {
      setGenderFilter(externalGenderFilter);
      setPage(1);
    }
  }, [externalGenderFilter]);

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
      // 성별 필터를 서버에 전달 (서버 사이드 카테고리+키워드 필터링)
      if (genderFilter !== 'all') params.set('genderFilter', genderFilter);
      if (seasonOnly)             params.set('seasonOnly', '1');
      if (gradeFilter !== 'all')  params.set('grade', gradeFilter);
      if (asteriskOnly)           params.set('asteriskOnly', '1');

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
  }, [categoryFilter, stockFilter, debouncedSearch, sort, page, genderFilter, seasonOnly, gradeFilter, asteriskOnly]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ── 수집 실행
  const handleCollect = async () => {
    if (isCollecting) return;
    setIsCollecting(true);
    setCollectError(null);
    setCollectResult(null);
    try {
      const res = await fetch('/api/sourcing/costco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const totalFetched: number = data.data?.totalFetched ?? 0;
      const errors: { category: string; message: string }[] = data.data?.errors ?? [];

      setCollectResult({ totalFetched, errorCount: errors.length });

      if (totalFetched === 0) {
        const firstErr = errors[0];
        setCollectError(
          firstErr
            ? `수집된 상품 없음 — ${firstErr.category}: ${firstErr.message}`
            : '수집된 상품이 없습니다. 코스트코 API 상태를 확인해 주세요.',
        );
      } else if (errors.length > 0) {
        setCollectError(`일부 카테고리 오류 (${errors.length}건): ${errors[0].category} — ${errors[0].message}`);
      }

      await fetchProducts();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '수집 실패');
    } finally {
      setIsCollecting(false);
    }
  };

  // ── 법적 검토 실행
  const handleLegalCheck = async () => {
    if (isLegalChecking) return;
    setIsLegalChecking(true);
    setLegalCheckResult(null);
    try {
      const res = await fetch('/api/sourcing/costco/legal-check', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? '법적 검토 실패');
      setLegalCheckResult(data.data);
      await fetchProducts();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '법적 검토 실패');
    } finally {
      setIsLegalChecking(false);
    }
  };

  // ── KIPRIS IP 검증
  const handleVerifyIp = async (productCode: string, title: string) => {
    if (ipVerifyingId) return;
    setIpVerifyingId(productCode);
    try {
      const res = await fetch('/api/sourcing/costco/verify-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: title, productCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'IP 검증 실패');
      const risk = data.data.overallRisk as 'low' | 'medium' | 'high';
      setIpRiskMap((prev) => ({ ...prev, [productCode]: risk }));
      // costco_score_legal 로컬 반영
      if (typeof data.data.legalScore === 'number') {
        setProducts((prev) =>
          prev.map((p) =>
            p.product_code === productCode
              ? { ...p, costco_score_legal: data.data.legalScore as number }
              : p,
          ),
        );
      }
    } catch (e) {
      console.error('[handleVerifyIp]', e);
    } finally {
      setIpVerifyingId(null);
    }
  };

  // grade/asteriskOnly/genderFilter/seasonOnly는 서버에서 처리됨
  // 클라이언트에서는 시장가 초과·CS·차단 등 계산 필요한 필터만 처리
  const filteredProducts = products.filter((p) => {
    if (overpriceOnly) {
      const wKg = getWeightKgFromProduct(p);
      const mkt  = p.market_lowest_price ?? null;
      const naver = calcRecommendedPrice(p.price, p.category_name, 'naver', wKg, mkt);
      if (!naver.isOverprice) return false;
    }
    // 고위험 CS 숨기기
    if (hideHighCs && getCsRisk(p.category_name).level === 'high') return false;
    // 차단 숨기기
    if (hideBlocked && getEffectiveBlockedReason(p) !== null) return false;
    return true;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilter  = !!(categoryFilter || debouncedSearch || stockFilter !== 'all' || gradeFilter !== 'all' || overpriceOnly
    || genderFilter !== 'all' || !hideHighCs || !hideBlocked || asteriskOnly || seasonOnly);

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
            표시 <strong style={{ color: C.text }}>{filteredProducts.length.toLocaleString()}</strong>개
            {filteredProducts.length !== total && (
              <span style={{ color: C.textSub }}> / 전체 {total.toLocaleString()}개</span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* 법적 검토 */}
          <button
            onClick={handleLegalCheck}
            disabled={isLegalChecking || isCollecting}
            title={legalCheckResult ? `검토 완료: ${legalCheckResult.checkedCount}건 / 차단 ${legalCheckResult.blockedCount}건 / 검토 ${legalCheckResult.warningCount}건` : '전체 상품 법적 검토 실행'}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px',
              backgroundColor: '#f3f3f3',
              color: isLegalChecking ? C.textSub : C.text,
              border: `1px solid ${C.border}`, borderRadius: '6px',
              fontSize: '12px', fontWeight: 600,
              cursor: isLegalChecking || isCollecting ? 'not-allowed' : 'pointer',
              opacity: isLegalChecking || isCollecting ? 0.6 : 1,
            }}
          >
            {isLegalChecking
              ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> 검토 중...</>
              : <><ShieldCheck size={12} /> 법적 검토</>}
          </button>
          {/* 코스트코 수집 */}
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
      </div>

      {/* ── 수집 결과 배너 */}
      {collectResult && collectResult.totalFetched > 0 && !collectError && (
        <div
          style={{
            margin: '12px 24px 0', padding: '10px 14px',
            backgroundColor: 'rgba(21,128,61,0.06)',
            border: '1px solid rgba(21,128,61,0.2)', borderRadius: '6px',
            fontSize: '13px', color: '#15803d',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>
            ✅ {collectResult.totalFetched.toLocaleString()}개 수집 완료
            {collectResult.errorCount > 0 && (
              <span style={{ color: '#b45309', marginLeft: '8px' }}>
                (일부 카테고리 오류 {collectResult.errorCount}건)
              </span>
            )}
          </span>
          <button onClick={() => setCollectResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803d' }}>
            <X size={14} />
          </button>
        </div>
      )}

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

        {/* 성별 타겟 필터 */}
        <select
          value={genderFilter}
          onChange={(e) => { setGenderFilter(e.target.value as MaleTierFilter); setPage(1); }}
          style={{
            ...selectStyle,
            borderColor: genderFilter !== 'all' ? '#2563eb' : C.border,
            color:       genderFilter !== 'all' ? '#2563eb' : C.text,
            fontWeight:  genderFilter !== 'all' ? 600 : 400,
          }}
        >
          <option value="all">타겟 전체</option>
          <option value="male_high">🔵 남성 타겟만</option>
          <option value="male_friendly">⚪ 남성 친화 이상</option>
          <option value="neutral">중립</option>
          <option value="female">🚫 여성 타겟만</option>
        </select>

        {/* 체크박스 그룹 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: C.textSub, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={hideHighCs} onChange={(e) => { setHideHighCs(e.target.checked); setPage(1); }} />
          고위험CS 숨기기
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: C.textSub, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={hideBlocked} onChange={(e) => { setHideBlocked(e.target.checked); setPage(1); }} />
          차단 숨기기
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: C.textSub, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={asteriskOnly} onChange={(e) => { setAsteriskOnly(e.target.checked); setPage(1); }} />
          ★ 별표만
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: C.textSub, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={seasonOnly} onChange={(e) => { setSeasonOnly(e.target.checked); setPage(1); }} />
          시즌 상품만
        </label>

        {/* 정렬 */}
        <select
          value={sort}
          onChange={(e) => handleSortClick(e.target.value as CostcoSortKey)}
          style={selectStyle}
        >
          <option value="sourcing_score_desc">소싱스코어 높은순</option>
          <option value="unit_saving_rate_desc">단가절감율 높은순</option>
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
              setGenderFilter('all');
              setHideHighCs(true);
              setHideBlocked(true);
              setAsteriskOnly(false);
              setSeasonOnly(false);
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
                    {/* 이미지 — sticky left */}
                    <th style={{
                      ...thStyle, width: '52px', textAlign: 'center',
                      position: 'sticky', left: 0, zIndex: 2, backgroundColor: C.tableHeader,
                    }}></th>

                    {/* 상품명 — sticky left (이미지 너비 다음) */}
                    <th style={{
                      ...thStyle, minWidth: '240px', textAlign: 'left',
                      position: 'sticky', left: '52px', zIndex: 2, backgroundColor: C.tableHeader,
                      boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                    }}>상품명</th>

                    {/* 등급/점수 — 상품명 바로 다음 */}
                    <th
                      style={{ ...thStyle, width: '90px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSortClick('sourcing_score_desc')}
                      title="소싱 스코어 높은순 정렬"
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                        등급/점수 <SortIcon col="sourcing_score_desc" />
                      </span>
                    </th>

                    {/* 타겟 */}
                    <th style={{ ...thStyle, width: '68px', textAlign: 'center' }}>타겟</th>
                    {/* 시즌 */}
                    <th style={{ ...thStyle, width: '68px', textAlign: 'center' }}>시즌</th>
                    {/* 검토 / IP */}
                    <th style={{ ...thStyle, width: '90px', textAlign: 'center' }}>검토 / IP</th>


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
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = C.rowHover;
                          e.currentTarget.querySelectorAll<HTMLElement>('td[data-sticky]').forEach(
                            (td) => { td.style.backgroundColor = C.rowHover; },
                          );
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = bgColor;
                          e.currentTarget.querySelectorAll<HTMLElement>('td[data-sticky]').forEach(
                            (td) => { td.style.backgroundColor = bgColor; },
                          );
                        }}
                      >
                        {/* 이미지 — sticky left */}
                        <td data-sticky="true" style={{
                          padding: '8px', textAlign: 'center', verticalAlign: 'middle',
                          position: 'sticky', left: 0, zIndex: 1,
                          backgroundColor: bgColor,
                        }}>
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

                        {/* 상품명 — sticky left, 단위가격 3번째 줄 포함 */}
                        {(() => {
                          const savingRate = calcUnitSavingRate(product.unit_price, product.market_unit_price);
                          const hasUnitPrice = product.unit_price != null && product.unit_price_label;
                          return (
                            <td data-sticky="true" style={{
                              padding: '8px 10px', verticalAlign: 'middle',
                              position: 'sticky', left: '52px', zIndex: 1,
                              backgroundColor: bgColor,
                              boxShadow: '2px 0 4px rgba(0,0,0,0.06)',
                            }}>
                              <div
                                style={{ fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }}
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
                              {/* 3번째 줄: 단위가격 비교 (unit_price가 있을 때만) */}
                              {hasUnitPrice && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '9px', color: C.accent, fontWeight: 600 }}>
                                    코C {fmtPrice(Math.round(product.unit_price!))}
                                  </span>
                                  <span style={{ fontSize: '9px', color: '#ccc' }}>·</span>
                                  {product.market_unit_price != null ? (
                                    <>
                                      <span style={{ fontSize: '9px', color: C.naver, fontWeight: 600 }}>
                                        네N {fmtPrice(Math.round(product.market_unit_price))}
                                      </span>
                                      <span style={{ fontSize: '9px', color: '#ccc' }}>·</span>
                                      {savingRate != null && (
                                        <span style={{
                                          fontSize: '9px', fontWeight: 700,
                                          color: savingRate >= 0 ? C.green : C.red,
                                        }}>
                                          {savingRate >= 0 ? `▼${savingRate.toFixed(1)}%` : `▲${Math.abs(savingRate).toFixed(1)}%`}
                                          {' '}{savingRate >= 0 ? '저렴' : '비쌈'}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span style={{ fontSize: '9px', color: '#c4c4c4' }}>네이버 수집 예정</span>
                                  )}
                                  <span style={{ fontSize: '9px', color: '#bbb', marginLeft: '2px' }}>
                                    ({product.unit_price_label})
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        })()}

                        {/* 등급/점수 */}
                        <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <ScoreBadge product={product} />
                        </td>

                        {/* 타겟 */}
                        {(() => {
                          const tier = getEffectiveMaleTier(product);
                          const label = MALE_TIER_BADGE[tier];
                          if (!label) return <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>-</td>;
                          return (
                            <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span style={{ fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
                            </td>
                          );
                        })()}

                        {/* 시즌 */}
                        {(() => {
                          const { bonus, seasons } = getEffectiveSeasonBonus(product);
                          if (bonus === 0) return <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle', color: '#ccc', fontSize: '11px' }}>-</td>;
                          return (
                            <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span
                                style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', backgroundColor: 'rgba(22,163,74,0.08)', color: '#16a34a', whiteSpace: 'nowrap' }}
                                title={seasons.join(', ')}
                              >
                                +{bonus}
                              </span>
                            </td>
                          );
                        })()}

                        {/* 검토 / IP */}
                        {(() => {
                          const blocked = getEffectiveBlockedReason(product);
                          const review  = product.needs_review;
                          const ipRisk  = ipRiskMap[product.product_code];
                          const isVerifyingThis = ipVerifyingId === product.product_code;
                          const isOtherVerifying = ipVerifyingId !== null && !isVerifyingThis;

                          const IP_RISK_BADGE: Record<'low' | 'medium' | 'high', { label: string; color: string; bg: string }> = {
                            low:    { label: '🟢 안전', color: C.green,  bg: C.greenBg },
                            medium: { label: '🟡 주의', color: '#ca8a04', bg: '#fefce8' },
                            high:   { label: '🔴 위험', color: C.red,    bg: C.redBg },
                          };

                          return (
                            <td style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                              {/* 일괄 검토 결과 뱃지 */}
                              <div style={{ marginBottom: ipRisk || isVerifyingThis ? '4px' : '0' }}>
                                {blocked ? (
                                  <span
                                    style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(220,38,38,0.08)', color: '#dc2626', cursor: 'default' }}
                                    title={blocked}
                                  >
                                    ❌
                                  </span>
                                ) : review ? (
                                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(217,119,6,0.08)', color: '#d97706' }}>⚠</span>
                                ) : (
                                  <span style={{ fontSize: '10px', color: '#ccc' }}>✓</span>
                                )}
                              </div>

                              {/* IP 검증 결과 또는 버튼 */}
                              {isVerifyingThis ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', fontSize: '10px', color: C.textSub }}>
                                  <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                  <span>검증중</span>
                                </div>
                              ) : ipRisk ? (
                                <span
                                  style={{
                                    fontSize: '10px', fontWeight: 700, padding: '1px 5px',
                                    borderRadius: '4px',
                                    backgroundColor: IP_RISK_BADGE[ipRisk].bg,
                                    color: IP_RISK_BADGE[ipRisk].color,
                                    cursor: 'pointer',
                                    display: 'inline-block',
                                  }}
                                  title="클릭하여 IP 재검증"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isOtherVerifying) {
                                      handleVerifyIp(product.product_code, product.title);
                                    }
                                  }}
                                >
                                  {IP_RISK_BADGE[ipRisk].label}
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isOtherVerifying) {
                                      handleVerifyIp(product.product_code, product.title);
                                    }
                                  }}
                                  disabled={isOtherVerifying}
                                  title={isOtherVerifying ? '다른 항목 검증 중' : 'KIPRIS 상표·특허·디자인 검증'}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                    fontSize: '10px', fontWeight: 600,
                                    padding: '2px 6px', borderRadius: '4px',
                                    border: `1px solid ${isOtherVerifying ? '#ddd' : C.blue + '66'}`,
                                    backgroundColor: isOtherVerifying ? '#f5f5f5' : 'rgba(37,99,235,0.05)',
                                    color: isOtherVerifying ? '#bbb' : C.blue,
                                    cursor: isOtherVerifying ? 'not-allowed' : 'pointer',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <ShieldCheck size={10} />
                                  IP 검증
                                </button>
                              )}
                            </td>
                          );
                        })()}

                        {/* 매입가 */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: C.text }}>{fmtPrice(product.price)}</div>
                          {product.original_price && product.original_price !== product.price && (
                            <div style={{ fontSize: '10px', color: C.textSub, textDecoration: 'line-through' }}>
                              {fmtPrice(product.original_price)}
                            </div>
                          )}
                        </td>

                        {/* 추천가(네이버) */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <ChannelPriceCell product={product} channel="naver" />
                        </td>

                        {/* 추천가(쿠팡) */}
                        <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle' }}>
                          <ChannelPriceCell product={product} channel="coupang" />
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
