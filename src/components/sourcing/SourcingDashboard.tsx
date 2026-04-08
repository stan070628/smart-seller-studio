'use client';

/**
 * SourcingDashboard.tsx
 * 소싱 대시보드 메인 클라이언트 컴포넌트
 *
 * 레이아웃: 헤더 → 상태바 → 툴바 → 테이블 → 페이지네이션
 * 스타일: 인라인 style 사용 (밝은 테마)
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronUp, ChevronDown, Download, RefreshCw, AlertCircle, X, ShieldCheck, Calculator, Search } from 'lucide-react';
import { useSourcingStore, type CollectingProgress } from '@/store/useSourcingStore';
import type { SalesAnalysisItem } from '@/types/sourcing';

// 니치소싱 탭
import NicheTab from '@/components/niche/NicheTab';
import NicheAlertBadge from '@/components/niche/NicheAlertBadge';
import { useNicheStore } from '@/store/useNicheStore';

// 마진계산기 컴포넌트 (서브탭용)
import CoupangTab from '@/components/calculator/tabs/CoupangTab';
import NaverTab from '@/components/calculator/tabs/NaverTab';
import GmarketTab from '@/components/calculator/tabs/GmarketTab';
import ElevenstTab from '@/components/calculator/tabs/ElevenstTab';
import ShopeeTab from '@/components/calculator/tabs/ShopeeTab';
import CompareMode from '@/components/calculator/CompareMode';

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
  rowHover: '#f5f5f5',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 숫자 포맷 (천 단위 구분)
// ─────────────────────────────────────────────────────────────────────────────
function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ─────────────────────────────────────────────────────────────────────────────
// 판매량 셀: 양수=빨간 ▼ 감소(판매), 0="-", 음수=초록 ▲ 입고
// ─────────────────────────────────────────────────────────────────────────────
function SalesCell({ value }: { value: number }) {
  if (value === 0) {
    return <span style={{ color: C.textSub }}>-</span>;
  }
  if (value > 0) {
    // 재고 감소 = 판매 → 빨간 ▼
    return (
      <span style={{ color: C.accent, fontWeight: 600 }}>
        ▼{formatNumber(value)}
      </span>
    );
  }
  // 재고 증가 = 입고 → 초록 ▲
  return (
    <span style={{ color: '#16a34a', fontWeight: 600 }}>
      ▲{formatNumber(Math.abs(value))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 정렬 가능 컬럼 목록
// ─────────────────────────────────────────────────────────────────────────────
const SORTABLE_COLUMNS: { key: string; label: string; align?: 'left' | 'right' | 'center'; tooltip?: string }[] = [
  { key: 'title', label: '상품명', align: 'left' },
  { key: 'latest_inventory', label: '현재재고', align: 'right', tooltip: '가장 최근 스냅샷 기준 도매꾹 재고 수량' },
  { key: 'sales_1d', label: '전일판매', align: 'right', tooltip: '어제 재고 − 오늘 재고 (재고 감소량 = 추정 판매량)' },
  { key: 'sales_7d', label: '7일판매', align: 'right', tooltip: '7일 전 재고 − 오늘 재고 (누적 추정 판매량)' },
  { key: 'avg_daily_sales', label: '일평균', align: 'right', tooltip: '7일 판매량 ÷ 경과일수 (하루 평균 판매 추정)' },
  { key: 'latest_price_dome', label: '도매가', align: 'right', tooltip: '도매꾹 기준 매입가 (최근 스냅샷)' },
  { key: 'margin_rate', label: '마진율', align: 'right', tooltip: '(추천판매가 − 도매가) ÷ 추천판매가 × 100' },
  { key: 'moq', label: 'MOQ', align: 'right', tooltip: '최소주문수량 (Minimum Order Quantity)' },
  { key: 'legal_status', label: 'Legal', align: 'center', tooltip: 'KC인증 / 금지어 / 상표권 법적 검토 상태' },
  { key: 'ip_risk', label: 'IP 리스크', align: 'center', tooltip: '지적재산권 침해 위험도 (상표·디자인·특허)' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 배송비 부담 레이블
// ─────────────────────────────────────────────────────────────────────────────
const DELI_WHO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  S: { label: '무료', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
  P: { label: '선결제', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },
  B: { label: '착불', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  C: { label: '선택', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Legal 상태 배지
// ─────────────────────────────────────────────────────────────────────────────
const LEGAL_BADGE: Record<string, { emoji: string; label: string; color: string; bg: string }> = {
  blocked:   { emoji: '🔴', label: '차단', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
  warning:   { emoji: '🟡', label: '주의', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  safe:      { emoji: '🟢', label: '안전', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
  unchecked: { emoji: '⚪', label: '미검사', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// IP 리스크 배지 (KIPRIS 상표/특허/디자인 검증 결과)
// ─────────────────────────────────────────────────────────────────────────────
const IP_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low:    { label: '안전', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)',   border: 'rgba(22, 163, 74, 0.25)' },
  medium: { label: '주의', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)',   border: 'rgba(217, 119, 6, 0.25)' },
  high:   { label: '위험', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)',   border: 'rgba(220, 38, 38, 0.25)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 수집 진행률 바
// ─────────────────────────────────────────────────────────────────────────────
function CollectingProgressBar({ progress }: { progress: CollectingProgress }) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div
      style={{
        padding: '10px 24px',
        backgroundColor: 'rgba(190, 0, 20, 0.03)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: C.accent }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>
            {progress.phase === 'fetch' ? '상품 수집' : '재고 스냅샷'}
          </span>
          <span style={{ fontSize: '12px', color: C.textSub }}>
            {progress.label}
          </span>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: C.accent }}>
          {progress.current}/{progress.total} ({pct}%)
        </span>
      </div>
      {/* 프로그레스 바 */}
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          backgroundColor: 'rgba(190, 0, 20, 0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: C.accent,
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function SourcingDashboard() {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche'>('tracking');
  const [calcItem, setCalcItem] = useState<SalesAnalysisItem | null>(null);

  // 니치소싱 읽지 않은 알림 수
  const unreadAlertCount = useNicheStore((s) => s.unreadAlertCount);

  const {
    items,
    totalCount,
    lastCollectedAt,
    categories,
    isLoading,
    isCollecting,
    collectingStep,
    collectingProgress,
    error,
    sortField,
    sortOrder,
    categoryFilter,
    searchQuery,
    moqFilter,
    freeDeliOnly,
    minSales1d,
    minSales7d,
    minPrice,
    maxPrice,
    minMargin,
    legalFilter,
    ipRiskFilter,
    page,
    pageSize,
    fetchAnalysis,
    triggerCollection,
    setSortField,
    setCategoryFilter,
    setSearchQuery,
    setMoqFilter,
    setFreeDeliOnly,
    setMinSales1d,
    setMinSales7d,
    setMinPrice,
    setMaxPrice,
    setMinMargin,
    setLegalFilter,
    setIpRiskFilter,
    setPage,
    clearError,
    triggerLegalCheck,
    isLegalChecking,
    verifyIp,
    ipVerifyingId,
  } = useSourcingStore();

  // 마운트 시 초기 데이터 로드
  useEffect(() => {
    fetchAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 검색 debounce (300ms)
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchAnalysis();
      }, 300);
    },
    [setSearchQuery, fetchAnalysis],
  );

  // 정렬 헤더 클릭
  const handleSortClick = useCallback(
    (key: string) => {
      if (sortField === key) {
        // 동일 컬럼 → order 토글
        useSourcingStore.getState().toggleSortOrder();
      } else {
        setSortField(key);
      }
    },
    [sortField, setSortField],
  );

  // CSV 다운로드
  const handleCsvDownload = useCallback(() => {
    const params = new URLSearchParams({
      sort: sortField,
      order: sortOrder,
    });
    if (categoryFilter) params.set('category', categoryFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    window.open(`/api/sourcing/export?${params.toString()}`, '_blank');
  }, [sortField, sortOrder, categoryFilter, searchQuery]);

  // 페이지 계산
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // 카테고리 목록 (API에서 전체 목록 조회)
  const uniqueCategories = categories;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: C.bg,
        fontFamily: "'Noto Sans KR', sans-serif",
        color: C.text,
      }}
    >
      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 헤더                                                                  */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <header
        style={{
          flexShrink: 0,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        {/* 로고 + 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '16px',
                fontWeight: '700',
                letterSpacing: '-0.3px',
                color: C.text,
              }}
            >
              Smart
              <span style={{ color: C.accent }}>Seller</span>
              Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190, 0, 20, 0.08)',
                color: C.accent,
                fontSize: '11px',
                fontWeight: '600',
                padding: '2px 9px',
                borderRadius: '100px',
                border: '1px solid rgba(190, 0, 20, 0.2)',
              }}
            >
              Beta
            </span>
          </div>

          {/* 네비게이션 탭 */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { href: '/dashboard', label: '대시보드' },
              { href: '/sourcing', label: '소싱', active: true },
              { href: '/editor', label: '에디터' },
              { href: '/listing', label: '상품등록' },
              { href: '/orders', label: '주문/매출' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: item.active ? '600' : '500',
                  color: item.active ? C.accent : C.textSub,
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190, 0, 20, 0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190, 0, 20, 0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 서브탭 (상품추적 / 마진계산기)                                       */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0', backgroundColor: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
        {([
          { id: 'tracking' as const, label: '상품추적', icon: <RefreshCw size={13} /> },
          { id: 'calculator' as const, label: '마진계산기', icon: <Calculator size={13} /> },
          { id: 'niche' as const, label: '니치소싱', icon: <Search size={13} />, badge: <NicheAlertBadge count={unreadAlertCount} /> },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSourcingSubTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '10px 18px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: sourcingSubTab === tab.id ? 600 : 500,
              color: sourcingSubTab === tab.id ? C.accent : C.textSub,
              backgroundColor: 'transparent',
              borderBottom: sourcingSubTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {tab.icon}
            {tab.label}
            {'badge' in tab ? tab.badge : null}
          </button>
        ))}
      </div>

      {/* 마진계산기 서브탭 콘텐츠 */}
      {sourcingSubTab === 'calculator' && (
        <SourcingCalculator />
      )}

      {/* 니치소싱 서브탭 콘텐츠 */}
      {sourcingSubTab === 'niche' && (
        <NicheTab />
      )}

      {/* 상품추적 서브탭 — 기존 콘텐츠 시작 */}
      {sourcingSubTab === 'tracking' && <>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 상태바                                                               */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          padding: '10px 24px',
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
          fontSize: '13px',
          color: C.textSub,
        }}
      >
        <span>
          마지막 수집:{' '}
          <strong style={{ color: C.text }}>
            {lastCollectedAt ? formatDate(lastCollectedAt) : '아직 수집한 적 없습니다'}
          </strong>
        </span>
        <span
          style={{
            width: '1px',
            height: '14px',
            backgroundColor: C.border,
            display: 'inline-block',
          }}
        />
        <span>
          추적 상품:{' '}
          <strong style={{ color: C.text }}>{formatNumber(totalCount)}개</strong>
        </span>
      </div>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 에러 배너                                                            */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 24px',
            backgroundColor: 'rgba(190, 0, 20, 0.06)',
            borderBottom: `1px solid rgba(190, 0, 20, 0.2)`,
            fontSize: '13px',
            color: C.accent,
          }}
        >
          <AlertCircle size={15} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={clearError}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.accent,
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 수집 진행률 배너                                                       */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {isCollecting && collectingProgress && (
        <CollectingProgressBar progress={collectingProgress} />
      )}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 툴바                                                                  */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '14px 24px',
          flexWrap: 'wrap',
        }}
      >
        {/* 카테고리 필터 */}
        <select
          value={categoryFilter ?? ''}
          onChange={(e) => setCategoryFilter(e.target.value || null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${C.border}`,
            backgroundColor: C.card,
            color: categoryFilter ? C.text : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="">전체 카테고리</option>
          {uniqueCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* 검색 인풋 */}
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="상품명 검색..."
          style={{
            height: '36px',
            padding: '0 12px',
            borderRadius: '8px',
            border: `1px solid ${C.border}`,
            backgroundColor: C.card,
            color: C.text,
            fontSize: '13px',
            outline: 'none',
            minWidth: '200px',
            flex: 1,
            maxWidth: '320px',
          }}
        />

        {/* MOQ 필터 드롭다운 */}
        <select
          value={moqFilter ?? ''}
          onChange={(e) => setMoqFilter(e.target.value ? Number(e.target.value) : null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${moqFilter != null ? C.accent : C.border}`,
            backgroundColor: moqFilter != null ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: moqFilter != null ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: moqFilter != null ? '600' : '400',
          }}
        >
          <option value="">MOQ 전체</option>
          <option value="10">MOQ 10개 이하</option>
          <option value="50">MOQ 50개 이하</option>
          <option value="100">MOQ 100개 이하</option>
        </select>

        {/* 무료배송 필터 체크박스 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '36px',
            padding: '0 12px',
            borderRadius: '8px',
            border: `1px solid ${freeDeliOnly ? C.accent : C.border}`,
            backgroundColor: freeDeliOnly ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: freeDeliOnly ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            userSelect: 'none',
            fontWeight: freeDeliOnly ? '600' : '400',
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={freeDeliOnly}
            onChange={(e) => setFreeDeliOnly(e.target.checked)}
            style={{ accentColor: C.accent, cursor: 'pointer' }}
          />
          무료배송만
        </label>

        {/* 전일판매 최소 */}
        <select
          value={minSales1d ?? ''}
          onChange={(e) => setMinSales1d(e.target.value ? Number(e.target.value) : null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${minSales1d != null ? C.accent : C.border}`,
            backgroundColor: minSales1d != null ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: minSales1d != null ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: minSales1d != null ? '600' : '400',
          }}
        >
          <option value="">전일판매</option>
          <option value="1">1개 이상</option>
          <option value="5">5개 이상</option>
          <option value="10">10개 이상</option>
          <option value="50">50개 이상</option>
          <option value="100">100개 이상</option>
        </select>

        {/* 7일판매 최소 */}
        <select
          value={minSales7d ?? ''}
          onChange={(e) => setMinSales7d(e.target.value ? Number(e.target.value) : null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${minSales7d != null ? C.accent : C.border}`,
            backgroundColor: minSales7d != null ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: minSales7d != null ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: minSales7d != null ? '600' : '400',
          }}
        >
          <option value="">7일판매</option>
          <option value="1">1개 이상</option>
          <option value="10">10개 이상</option>
          <option value="50">50개 이상</option>
          <option value="100">100개 이상</option>
          <option value="500">500개 이상</option>
        </select>

        {/* 도매가 범위 */}
        <select
          value={minPrice != null ? `${minPrice}-${maxPrice ?? ''}` : ''}
          onChange={(e) => {
            if (!e.target.value) { setMinPrice(null); setMaxPrice(null); return; }
            const [lo, hi] = e.target.value.split('-').map(Number);
            setMinPrice(lo || null);
            setMaxPrice(hi || null);
          }}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${minPrice != null || maxPrice != null ? C.accent : C.border}`,
            backgroundColor: minPrice != null || maxPrice != null ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: minPrice != null || maxPrice != null ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: minPrice != null || maxPrice != null ? '600' : '400',
          }}
        >
          <option value="">도매가</option>
          <option value="0-5000">5,000원 이하</option>
          <option value="5000-10000">5,000~10,000원</option>
          <option value="10000-30000">10,000~30,000원</option>
          <option value="30000-">30,000원 이상</option>
        </select>

        {/* 마진율 최소 */}
        <select
          value={minMargin ?? ''}
          onChange={(e) => setMinMargin(e.target.value ? Number(e.target.value) : null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${minMargin != null ? C.accent : C.border}`,
            backgroundColor: minMargin != null ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: minMargin != null ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: minMargin != null ? '600' : '400',
          }}
        >
          <option value="">마진율</option>
          <option value="10">10% 이상</option>
          <option value="20">20% 이상</option>
          <option value="30">30% 이상</option>
          <option value="40">40% 이상</option>
          <option value="50">50% 이상</option>
        </select>

        {/* Legal 상태 */}
        <select
          value={legalFilter ?? ''}
          onChange={(e) => setLegalFilter(e.target.value || null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${legalFilter ? C.accent : C.border}`,
            backgroundColor: legalFilter ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: legalFilter ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: legalFilter ? '600' : '400',
          }}
        >
          <option value="">Legal 전체</option>
          <option value="safe">안전 (safe)</option>
          <option value="warning">주의 (warning)</option>
          <option value="blocked">차단 (blocked)</option>
          <option value="unchecked">미검토</option>
        </select>

        {/* IP 리스크 */}
        <select
          value={ipRiskFilter ?? ''}
          onChange={(e) => setIpRiskFilter(e.target.value || null)}
          style={{
            height: '36px',
            padding: '0 10px',
            borderRadius: '8px',
            border: `1px solid ${ipRiskFilter ? C.accent : C.border}`,
            backgroundColor: ipRiskFilter ? 'rgba(190, 0, 20, 0.04)' : C.card,
            color: ipRiskFilter ? C.accent : C.textSub,
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
            fontWeight: ipRiskFilter ? '600' : '400',
          }}
        >
          <option value="">IP 리스크</option>
          <option value="low">낮음 (low)</option>
          <option value="medium">보통 (medium)</option>
          <option value="high">높음 (high)</option>
        </select>

        {/* 우측 버튼 그룹 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          {/* 수동 수집 버튼 */}
          <button
            onClick={triggerCollection}
            disabled={isCollecting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: isCollecting ? '#e8e8e8' : C.btnPrimaryBg,
              color: isCollecting ? C.textSub : C.btnPrimaryText,
              fontSize: '13px',
              fontWeight: '600',
              cursor: isCollecting ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            {isCollecting ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                {collectingStep ?? '수집 중...'}
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                수동 수집
              </>
            )}
          </button>

          {/* 법적 검토 버튼 */}
          <button
            onClick={triggerLegalCheck}
            disabled={isLegalChecking}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              border: `1px solid ${C.border}`,
              backgroundColor: isLegalChecking ? '#e8e8e8' : C.card,
              color: isLegalChecking ? C.textSub : C.text,
              fontSize: '13px',
              fontWeight: '500',
              cursor: isLegalChecking ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            {isLegalChecking ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                검토 중...
              </>
            ) : (
              <>
                <span style={{ fontSize: '14px' }}>⚖️</span>
                법적 검토
              </>
            )}
          </button>

          {/* CSV 다운로드 버튼 */}
          <button
            onClick={handleCsvDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '36px',
              padding: '0 14px',
              borderRadius: '8px',
              border: `1px solid ${C.border}`,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            <Download size={14} />
            CSV 다운로드
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 테이블 영역                                                          */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          padding: '0 24px 24px',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            backgroundColor: C.card,
            borderRadius: '12px',
            border: `1px solid ${C.border}`,
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            {/* 테이블 헤더 */}
            <thead>
              <tr style={{ backgroundColor: C.tableHeader }}>
                {/* 순번 */}
                <th
                  style={{
                    padding: '11px 16px',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    width: '48px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  #
                </th>

                {/* 정렬 가능 컬럼들 */}
                {SORTABLE_COLUMNS.map((col) => (
                  <SortableHeader
                    key={col.key}
                    colKey={col.key}
                    label={col.label}
                    align={col.align ?? 'left'}
                    tooltip={col.tooltip}
                    currentSortField={sortField}
                    currentSortOrder={sortOrder}
                    onClick={handleSortClick}
                  />
                ))}
              </tr>
            </thead>

            {/* 테이블 바디 */}
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={SORTABLE_COLUMNS.length + 1}
                    style={{ padding: '48px', textAlign: 'center', color: C.textSub }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                      }}
                    >
                      <Loader2
                        size={18}
                        style={{ animation: 'spin 1s linear infinite', color: C.accent }}
                      />
                      <span>데이터를 불러오는 중...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={SORTABLE_COLUMNS.length + 1}
                    style={{ padding: '64px', textAlign: 'center', color: C.textSub }}
                  >

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '32px' }}>📦</span>
                      <span style={{ fontSize: '14px' }}>
                        아직 수집된 데이터가 없습니다. 수동 수집 버튼을 눌러 시작하세요.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => (
                  <TableRow
                    key={item.id}
                    item={item}
                    index={(page - 1) * pageSize + idx + 1}
                    onNavigate={() => item.domeUrl ? window.open(item.domeUrl, '_blank') : undefined}
                    ipVerifyingId={ipVerifyingId}
                    onVerifyIp={verifyIp}
                    onOpenCalc={setCalcItem}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* 페이지네이션                                                         */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        {!isLoading && items.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* 스피너 keyframe 주입 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      </>}

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* 마진계산기 모달                                                       */}
      {/* ─────────────────────────────────────────���────────────────────────── */}
      {calcItem && (
        <MarginCalcModal
          item={calcItem}
          onClose={() => setCalcItem(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 정렬 가능한 테이블 헤더 셀
// ─────────────────────────────────────────────────────────────────────────────
interface SortableHeaderProps {
  colKey: string;
  label: string;
  align: 'left' | 'right' | 'center';
  tooltip?: string;
  currentSortField: string;
  currentSortOrder: 'asc' | 'desc';
  onClick: (key: string) => void;
}

function SortableHeader({
  colKey,
  label,
  align,
  tooltip,
  currentSortField,
  currentSortOrder,
  onClick,
}: SortableHeaderProps) {
  const isActive = currentSortField === colKey;

  return (
    <th
      onClick={() => onClick(colKey)}
      title={tooltip}
      style={{
        padding: '11px 16px',
        textAlign: align,
        fontWeight: '600',
        color: isActive ? C.accent : C.textSub,
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        fontSize: '12px',
        transition: 'color 0.15s',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {label}
        {tooltip && (
          <span
            title={tooltip}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: `1px solid ${C.border}`,
              fontSize: '9px',
              fontWeight: '700',
              color: C.textSub,
              cursor: 'help',
              flexShrink: 0,
            }}
          >
            ?
          </span>
        )}
        {isActive ? (
          currentSortOrder === 'desc' ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronUp size={13} />
          )
        ) : (
          <span style={{ width: '13px', display: 'inline-block' }} />
        )}
      </span>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 테이블 행
// ─────────────────────────────────────────────────────────────────────────────
interface TableRowProps {
  item: SalesAnalysisItem;
  index: number;
  onNavigate: () => void;
  ipVerifyingId: string | null;
  onVerifyIp: (itemId: string, keyword: string) => Promise<void>;
  onOpenCalc: (item: SalesAnalysisItem) => void;
}

function TableRow({ item, index, onNavigate, ipVerifyingId, onVerifyIp, onOpenCalc }: TableRowProps) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <tr
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: hovered ? C.rowHover : C.card,
        cursor: 'pointer',
        transition: 'background 0.1s',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {/* 순번 */}
      <td
        style={{
          padding: '11px 16px',
          textAlign: 'center',
          color: C.textSub,
          fontSize: '12px',
          fontWeight: '500',
        }}
      >
        {index}
      </td>

      {/* 상품명 */}
      <td
        style={{
          padding: '11px 16px',
          color: C.text,
          fontWeight: '500',
          maxWidth: '320px',
        }}
      >
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: '1.4',
          }}
        >
          {item.title}
        </span>
        {item.categoryName && (
          <span
            style={{
              display: 'block',
              fontSize: '11px',
              color: C.textSub,
              marginTop: '2px',
            }}
          >
            {item.categoryName}
          </span>
        )}
      </td>

      {/* 현재재고 */}
      <td style={{ padding: '11px 16px', textAlign: 'right', fontWeight: '500' }}>
        {formatNumber(item.latestInventory)}
      </td>

      {/* 전일판매 */}
      <td style={{ padding: '11px 16px', textAlign: 'right' }}>
        <SalesCell value={item.sales1d} />
      </td>

      {/* 7일판매 */}
      <td style={{ padding: '11px 16px', textAlign: 'right' }}>
        <SalesCell value={item.sales7d} />
      </td>

      {/* 일평균 */}
      <td style={{ padding: '11px 16px', textAlign: 'right', color: C.text }}>
        {item.avgDailySales > 0 ? item.avgDailySales.toFixed(1) : '-'}
      </td>

      {/* 도매가 + 계산기 버튼 */}
      <td
        style={{ padding: '11px 16px', textAlign: 'right', color: C.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
          <span>
            {item.latestPriceDome != null
              ? `${formatNumber(item.latestPriceDome)}원`
              : '-'}
          </span>
          <button
            onClick={() => onOpenCalc(item)}
            title="마진 계산"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: 'transparent',
              color: C.textSub,
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(190, 0, 20, 0.06)';
              e.currentTarget.style.color = C.accent;
              e.currentTarget.style.borderColor = 'rgba(190, 0, 20, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = C.textSub;
              e.currentTarget.style.borderColor = C.border;
            }}
          >
            <Calculator size={13} />
          </button>
        </div>
      </td>

      {/* 마진율 */}
      <td style={{ padding: '11px 16px', textAlign: 'right' }}>
        {item.marginRate != null ? (
          <span
            style={{
              fontWeight: 600,
              color: item.marginRate >= 0 ? '#16a34a' : C.accent,
            }}
          >
            {item.marginRate > 0 ? '+' : ''}{item.marginRate}%
          </span>
        ) : (
          <span style={{ color: C.textSub }}>-</span>
        )}
      </td>

      {/* MOQ + 배송 */}
      <td style={{ padding: '11px 16px', textAlign: 'right' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
          <span style={{ color: item.moq != null ? C.text : C.textSub, fontWeight: 500 }}>
            {item.moq != null ? `${formatNumber(item.moq)}개` : '-'}
          </span>
          {item.deliWho != null && DELI_WHO_LABEL[item.deliWho] ? (
            <span
              style={{
                fontSize: '11px',
                fontWeight: '600',
                padding: '1px 6px',
                borderRadius: '100px',
                color: DELI_WHO_LABEL[item.deliWho].color,
                backgroundColor: DELI_WHO_LABEL[item.deliWho].bg,
              }}
            >
              {DELI_WHO_LABEL[item.deliWho].label}
            </span>
          ) : null}
        </div>
      </td>

      {/* Legal 상태 */}
      <td style={{ padding: '11px 16px', textAlign: 'center' }}>
        {(() => {
          const badge = LEGAL_BADGE[item.legalStatus] ?? LEGAL_BADGE.unchecked;
          return (
            <span
              title={
                item.legalIssues.length > 0
                  ? item.legalIssues.map((i) => i.message).join('\n')
                  : badge.label
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: '600',
                padding: '2px 8px',
                borderRadius: '100px',
                color: badge.color,
                backgroundColor: badge.bg,
                cursor: item.legalIssues.length > 0 ? 'help' : 'default',
              }}
            >
              {badge.emoji} {badge.label}
            </span>
          );
        })()}
      </td>

      {/* IP 리스크 — KIPRIS 상표/특허/디자인 검증 결과 */}
      <td
        style={{ padding: '11px 16px', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()} // 행 클릭 네비게이션 차단
      >
        {(() => {
          const isVerifying = ipVerifyingId === item.id;

          // 검증 중 상태
          if (isVerifying) {
            return (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  color: '#6b7280',
                  backgroundColor: 'rgba(107, 114, 128, 0.08)',
                  border: '1px solid rgba(107, 114, 128, 0.2)',
                }}
              >
                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                검증중
              </span>
            );
          }

          // 검증 완료: ipRiskLevel이 존재하는 경우
          if (item.ipRiskLevel && IP_BADGE[item.ipRiskLevel]) {
            const badge = IP_BADGE[item.ipRiskLevel];
            const riskEmoji = item.ipRiskLevel === 'low' ? '🟢' : item.ipRiskLevel === 'medium' ? '🟡' : '🔴';
            const checkedLabel = item.ipCheckedAt
              ? `마지막 검증: ${new Date(item.ipCheckedAt).toLocaleDateString('ko-KR')}`
              : badge.label;
            return (
              <button
                onClick={() => onVerifyIp(item.id, item.title)}
                title={`${checkedLabel} (클릭하여 재검증)`}
                disabled={ipVerifyingId !== null}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  color: badge.color,
                  backgroundColor: badge.bg,
                  border: `1px solid ${badge.border}`,
                  cursor: ipVerifyingId !== null ? 'not-allowed' : 'pointer',
                  opacity: ipVerifyingId !== null ? 0.6 : 1,
                }}
              >
                {riskEmoji} {badge.label}
              </button>
            );
          }

          // 미검증 상태 — 클릭 시 검증 시작
          return (
            <button
              onClick={() => onVerifyIp(item.id, item.title)}
              title="클릭하여 IP 리스크 검증 실행"
              disabled={ipVerifyingId !== null}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: '500',
                padding: '2px 8px',
                borderRadius: '100px',
                color: '#9ca3af',
                backgroundColor: 'rgba(156, 163, 175, 0.08)',
                border: '1px solid rgba(156, 163, 175, 0.25)',
                cursor: ipVerifyingId !== null ? 'not-allowed' : 'pointer',
                opacity: ipVerifyingId !== null ? 0.6 : 1,
              }}
            >
              <ShieldCheck size={11} />
              미검증
            </button>
          );
        })()}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 페이지네이션
// ─────────────────────────────────────────────────────────────────────────────
interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  // 표시할 페이지 번호 범위 계산 (최대 5개)
  const getPageNumbers = (): number[] => {
    const delta = 2;
    const start = Math.max(1, page - delta);
    const end = Math.min(totalPages, page + delta);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const pageNumbers = getPageNumbers();

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '32px',
    height: '32px',
    padding: '0 8px',
    borderRadius: '6px',
    border: `1px solid ${C.border}`,
    backgroundColor: C.card,
    color: C.text,
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background 0.1s',
  };

  const btnActive: React.CSSProperties = {
    ...btnBase,
    backgroundColor: C.accent,
    color: '#fff',
    border: `1px solid ${C.accent}`,
    fontWeight: '700',
  };

  const btnDisabled: React.CSSProperties = {
    ...btnBase,
    color: C.textSub,
    cursor: 'not-allowed',
    opacity: 0.5,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginTop: '20px',
      }}
    >
      {/* 이전 버튼 */}
      <button
        onClick={() => page > 1 && onPageChange(page - 1)}
        disabled={page <= 1}
        style={page <= 1 ? btnDisabled : btnBase}
      >
        &lt; 이전
      </button>

      {/* 첫 페이지 + 줄임표 */}
      {pageNumbers[0] > 1 && (
        <>
          <button onClick={() => onPageChange(1)} style={btnBase}>
            1
          </button>
          {pageNumbers[0] > 2 && (
            <span style={{ color: C.textSub, fontSize: '13px', padding: '0 4px' }}>
              ...
            </span>
          )}
        </>
      )}

      {/* 페이지 번호들 */}
      {pageNumbers.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          style={p === page ? btnActive : btnBase}
        >
          {p}
        </button>
      ))}

      {/* 마지막 페이지 + 줄임표 */}
      {pageNumbers[pageNumbers.length - 1] < totalPages && (
        <>
          {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
            <span style={{ color: C.textSub, fontSize: '13px', padding: '0 4px' }}>
              ...
            </span>
          )}
          <button onClick={() => onPageChange(totalPages)} style={btnBase}>
            {totalPages}
          </button>
        </>
      )}

      {/* 다음 버튼 */}
      <button
        onClick={() => page < totalPages && onPageChange(page + 1)}
        disabled={page >= totalPages}
        style={page >= totalPages ? btnDisabled : btnBase}
      >
        다음 &gt;
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 소싱 내 마진계산기
// ─────────────────────────────────────────────────────────────────────────────
type CalcTab = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee';

const CALC_TABS: { id: CalcTab; label: string; color: string }[] = [
  { id: 'coupang', label: '쿠팡', color: '#be0014' },
  { id: 'naver', label: '네이버', color: '#03c75a' },
  { id: 'gmarket', label: 'G마켓', color: '#6dbe46' },
  { id: 'elevenst', label: '11번가', color: '#ff0038' },
  { id: 'shopee', label: 'Shopee', color: '#ee4d2d' },
];

function SourcingCalculator() {
  const [activeCalcTab, setActiveCalcTab] = React.useState<CalcTab>('coupang');
  const [showCompare, setShowCompare] = React.useState(false);

  return (
    <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
      {/* 타이틀 + 비교모드 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Calculator size={18} color="#be0014" />
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#18181b', margin: 0 }}>마진 계산기</h2>
          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>플랫폼별 수수료 자동 계산</span>
        </div>
        <button
          onClick={() => setShowCompare(!showCompare)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 500, transition: 'all 0.15s',
            border: showCompare ? '1px solid rgba(190,0,20,0.3)' : '1px solid #e5e5e5',
            backgroundColor: showCompare ? 'rgba(190,0,20,0.05)' : '#fff',
            color: showCompare ? '#be0014' : '#52525b',
          }}
        >
          {showCompare ? '개별 계산 모드' : '플랫폼 비교 모드'}
        </button>
      </div>

      {showCompare ? (
        <CompareMode />
      ) : (
        <>
          {/* 플랫폼 탭 */}
          <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '16px', border: '1px solid #e5e5e5' }}>
            {CALC_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCalcTab(tab.id)}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: activeCalcTab === tab.id ? 600 : 500,
                  color: activeCalcTab === tab.id ? tab.color : '#71717a',
                  backgroundColor: activeCalcTab === tab.id ? `${tab.color}10` : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeCalcTab === 'coupang' && <CoupangTab />}
          {activeCalcTab === 'naver' && <NaverTab />}
          {activeCalcTab === 'gmarket' && <GmarketTab />}
          {activeCalcTab === 'elevenst' && <ElevenstTab />}
          {activeCalcTab === 'shopee' && <ShopeeTab />}
        </>
      )}

      <p style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#a1a1aa' }}>
        수수료�� 2025년 10월 기준이며, 플랫폼 정책 변경에 따라 달라질 수 있습니다.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────��─────
// 마진계산기 팝업 모달 (상품 선택 시 원가 자동입력)
// ─��─────────────��────────────────────────────────���────────────────────────────
interface MarginCalcModalProps {
  item: SalesAnalysisItem;
  onClose: () => void;
}

function MarginCalcModal({ item, onClose }: MarginCalcModalProps) {
  const [activeCalcTab, setActiveCalcTab] = React.useState<CalcTab>('coupang');
  const [showCompare, setShowCompare] = React.useState(false);

  const domeTiers = item.priceTiers?.dome ?? [];
  const hasTiers = domeTiers.length > 1;

  // MOQ에 해당하는 기본 티어 선택 (MOQ 이상인 가장 낮은 티어)
  const defaultTierIdx = (() => {
    if (domeTiers.length === 0) return 0;
    if (item.moq == null) return 0;
    const idx = domeTiers.findIndex((t) => t.minQty >= item.moq!);
    return idx >= 0 ? idx : domeTiers.length - 1;
  })();
  const [selectedTierIdx, setSelectedTierIdx] = React.useState(defaultTierIdx);

  const costPrice = domeTiers.length > 0
    ? domeTiers[selectedTierIdx]?.unitPrice ?? 0
    : item.latestPriceDome ?? 0;
  const shippingFee = item.deliWho !== 'P' ? (item.deliFee ?? 0) : 0;
  const selectedQty = domeTiers[selectedTierIdx]?.minQty ?? null;

  // 탭/비교모드 전환 시에도 원가가 반영되도록 key 사용
  const calcKey = `${costPrice}-${shippingFee}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          width: '640px',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        {/* 모달 헤더 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: `1px solid ${C.border}`,
            position: 'sticky',
            top: 0,
            backgroundColor: '#fff',
            borderRadius: '16px 16px 0 0',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <Calculator size={18} color={C.accent} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: C.text }}>
                마진 계산
              </h3>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: '12px',
                  color: C.textSub,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.title}
              >
                {item.title}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: `1px solid ${C.border}`,
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: C.textSub,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 수량별 가격 티어 선택 */}
        {hasTiers && (
          <div
            style={{
              padding: '14px 24px',
              backgroundColor: '#fafafa',
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 600, color: C.text, marginBottom: '8px' }}>
              주문 수량별 단가
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {domeTiers.map((tier, idx) => {
                const isSelected = idx === selectedTierIdx;
                const isMoqTier = item.moq != null && tier.minQty === item.moq;
                return (
                  <button
                    key={tier.minQty}
                    onClick={() => setSelectedTierIdx(idx)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: isSelected
                        ? `2px solid ${C.accent}`
                        : `1px solid ${C.border}`,
                      backgroundColor: isSelected ? 'rgba(190, 0, 20, 0.04)' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      position: 'relative',
                    }}
                  >
                    <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 500 }}>
                      {formatNumber(tier.minQty)}개 이상
                    </span>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        color: isSelected ? C.accent : C.text,
                      }}
                    >
                      {formatNumber(tier.unitPrice)}원
                    </span>
                    {isMoqTier && (
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: '#2563eb',
                          backgroundColor: 'rgba(37, 99, 235, 0.08)',
                          padding: '1px 5px',
                          borderRadius: '100px',
                        }}
                      >
                        MOQ
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 선택된 원가 요약 */}
        <div
          style={{
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: `1px solid ${C.border}`,
            backgroundColor: 'rgba(190, 0, 20, 0.02)',
          }}
        >
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: C.accent,
              backgroundColor: 'rgba(190, 0, 20, 0.06)',
              padding: '4px 10px',
              borderRadius: '100px',
              border: '1px solid rgba(190, 0, 20, 0.15)',
              whiteSpace: 'nowrap',
            }}
          >
            원가 {formatNumber(costPrice)}원
            {selectedQty != null && selectedQty > 1 && ` (${formatNumber(selectedQty)}개 기준)`}
          </span>
          {shippingFee > 0 && (
            <span style={{ fontSize: '11px', color: C.textSub }}>
              + 배송비 {formatNumber(shippingFee)}원
            </span>
          )}
        </div>

        {/* 모달 바디 */}
        <div style={{ padding: '20px 24px' }}>
          {/* 비교모드 토글 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <button
              onClick={() => setShowCompare(!showCompare)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 500, transition: 'all 0.15s',
                border: showCompare ? '1px solid rgba(190,0,20,0.3)' : '1px solid #e5e5e5',
                backgroundColor: showCompare ? 'rgba(190,0,20,0.05)' : '#fff',
                color: showCompare ? '#be0014' : '#52525b',
              }}
            >
              {showCompare ? '개별 계산 모드' : '플랫폼 비교 모드'}
            </button>
          </div>

          {showCompare ? (
            <CompareMode key={calcKey} initialCostPrice={costPrice} />
          ) : (
            <>
              {/* 플랫폼 탭 */}
              <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '16px', border: '1px solid #e5e5e5' }}>
                {CALC_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCalcTab(tab.id)}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                      fontSize: '13px', fontWeight: activeCalcTab === tab.id ? 600 : 500,
                      color: activeCalcTab === tab.id ? tab.color : '#71717a',
                      backgroundColor: activeCalcTab === tab.id ? `${tab.color}10` : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeCalcTab === 'coupang' && <CoupangTab key={calcKey} initialCostPrice={costPrice} initialShippingFee={shippingFee} />}
              {activeCalcTab === 'naver' && <NaverTab key={calcKey} initialCostPrice={costPrice} initialShippingFee={shippingFee} />}
              {activeCalcTab === 'gmarket' && <GmarketTab key={calcKey} initialCostPrice={costPrice} initialShippingFee={shippingFee} />}
              {activeCalcTab === 'elevenst' && <ElevenstTab key={calcKey} initialCostPrice={costPrice} initialShippingFee={shippingFee} />}
              {activeCalcTab === 'shopee' && <ShopeeTab key={calcKey} initialCostPrice={costPrice} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
