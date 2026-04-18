'use client';

/**
 * SourcingDashboard.tsx
 * 소싱 대시보드 메인 클라이언트 컴포넌트
 *
 * 레이아웃: 헤더 → 상태바 → 툴바 → 테이블 → 페이지네이션
 * 스타일: 인라인 style 사용 (밝은 테마)
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Calculator, Search } from 'lucide-react';
import { C } from '@/lib/design-tokens';

// 니치소싱 탭
import NicheTab from '@/components/niche/NicheTab';
import NicheAlertBadge from '@/components/niche/NicheAlertBadge';

// 코스트코 탭
import CostcoTab from '@/components/sourcing/CostcoTab';
import { useNicheStore } from '@/store/useNicheStore';

// 도매꾹 v2 탭
import DomeggookTab from '@/components/sourcing/DomeggookTab';

// 마진계산기 컴포넌트 (서브탭용)
import CoupangTab from '@/components/calculator/tabs/CoupangTab';
import NaverTab from '@/components/calculator/tabs/NaverTab';
import GmarketTab from '@/components/calculator/tabs/GmarketTab';
import ElevenstTab from '@/components/calculator/tabs/ElevenstTab';
import ShopeeTab from '@/components/calculator/tabs/ShopeeTab';
import CompareMode from '@/components/calculator/CompareMode';

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function SourcingDashboard() {
  const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco'>('niche');

  // 니치소싱 읽지 않은 알림 수
  const unreadAlertCount = useNicheStore((s) => s.unreadAlertCount);

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
      {/* 서브탭 (니치소싱 / 도매꾹 / 코스트코 / 마진계산기)                    */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0', backgroundColor: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
        {([
          { id: 'niche' as const, label: '니치소싱', icon: <Search size={13} />, badge: <NicheAlertBadge count={unreadAlertCount} /> },
          { id: 'tracking' as const, label: '도매꾹', icon: <RefreshCw size={13} /> },
          { id: 'costco' as const, label: '코스트코', icon: <span style={{ fontSize: '13px' }}>🏬</span> },
          { id: 'calculator' as const, label: '마진계산기', icon: <Calculator size={13} /> },
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

      {/* 코스트코 서브탭 콘텐츠 */}
      {sourcingSubTab === 'costco' && (
        <CostcoTab />
      )}

      {/* 도매꾹 v2 서브탭 */}
      {sourcingSubTab === 'tracking' && <DomeggookTab />}

      {/* 마진계산기 모달 (레거시 — DomeggookTab 내부로 이전됨)                  */}
      {/* ─────────────────────────────────────────���────────────────────────── */}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 정렬 가능한 테이블 헤더 셀
// ─────────────────────────────────────────────────────────────────────────────
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

