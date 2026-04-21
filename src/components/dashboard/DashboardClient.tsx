'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { C as BASE_C } from '@/lib/design-tokens';
import {
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  Package,
  ShoppingCart,
  ArrowRight,
  Loader2,
  BarChart3,
  Shield,
  Search,
  RefreshCw,
  Store,
} from 'lucide-react';

// ─── 색상 상수 (공통 토큰 + 대시보드 전용 오버라이드/확장) ──────────
const C = {
  ...BASE_C,
  // 대시보드는 약간 다른 배경/보더 톤 사용
  bg:          '#f5f5f7',
  border:      '#e5e5e5',
  text:        '#18181b',
  textSub:     '#71717a',
  // 대시보드 전용 추가 키
  textMuted:   '#a1a1aa',
  accentBg:    'rgba(190,0,20,0.07)',
  accentBorder:'rgba(190,0,20,0.15)',
  green:       '#16a34a',
  blue:        '#2563eb',
  purple:      '#7c3aed',
  orange:      '#d97706',
  red:         '#dc2626',
} as const;

// ─── 공통 네비게이션 ─────────────────────────────────────────
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
];

// ─── 타입 ─────────────────────────────────────────────────────
interface DashboardData {
  overview: {
    totalProducts: number;
    avgMarginDomeggook: number | null;
    avgMarginCostco: number | null;
    legalBlocked: number;
    legalWarning: number;
  };
  channels: {
    domeggook: {
      products: number;
      avgMargin: number | null;
      topSellers: { title: string; sales7d: number; marginRate: number | null; scoreTotal: number | null; priceDome: number | null }[];
      legalBlocked: number;
      legalWarning: number;
      lastCollected: string | null;
    };
    costco: {
      products: number;
      avgScore: number | null;
      avgMargin: number | null;
      gradeDistribution: { S: number; A: number; B: number; CD: number };
      lastCollected: string | null;
    };
    niche: {
      trackedKeywords: number;
      avgScore: number | null;
      topKeywords: { keyword: string; totalScore: number | null; grade: string | null; analyzedAt: string | null }[];
    };
  };
}

interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  newOrders: number;
}

const CANCELLED = new Set(['CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE']);
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

type ChannelTab = 'overview' | 'domeggook' | 'costco' | 'niche';

// ═══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════════════
export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ChannelTab>('overview');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const today = new Date();
      const from7 = toDateStr(new Date(today.getTime() - 6 * 86400_000));
      const to = toDateStr(today);

      const [summaryRes, ordersRes] = await Promise.allSettled([
        fetch('/api/dashboard/summary'),
        fetch(`/api/orders/coupang?from=${from7}&to=${to}`),
      ]);

      if (summaryRes.status === 'fulfilled') {
        const json = await summaryRes.value.json();
        if (json.success) setData(json.data);
      }

      if (ordersRes.status === 'fulfilled') {
        const json = await ordersRes.value.json();
        if (json.success) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const orders: any[] = json.data?.items ?? [];
          const active = orders.filter((o) => !CANCELLED.has(o.status));
          const totalRevenue = active.reduce((s: number, o: Record<string, unknown>) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            s + ((o.orderItems as any[]) ?? []).reduce((is: number, i: Record<string, unknown>) => is + ((i.orderPrice as number) ?? 0), 0), 0);
          setOrderStats({
            totalOrders: active.length,
            totalRevenue,
            newOrders: orders.filter((o) => o.status === 'ACCEPT').length,
          });
        }
      }
    } catch {
      // 데이터 없어도 대시보드는 표시
    } finally {
      setIsLoading(false);
    }
  };

  // 평균 마진 계산 (두 채널 가중평균)
  const overallAvgMargin = useMemo(() => {
    if (!data) return null;
    const dm = data.overview.avgMarginDomeggook;
    const cm = data.overview.avgMarginCostco;
    if (dm != null && cm != null) return Math.round(((dm + cm) / 2) * 10) / 10;
    return dm ?? cm;
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: C.bg }}>
      {/* ── 헤더 ─────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50, height: '52px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.card,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px', color: C.text }}>
              Smart<span style={{ color: C.accent }}>Seller</span>Studio
            </span>
            <span style={{
              backgroundColor: 'rgba(190,0,20,0.08)', color: C.accent,
              fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '100px',
              border: '1px solid rgba(190,0,20,0.2)',
            }}>Beta</span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} style={{
                padding: '5px 12px', borderRadius: '6px', fontSize: '13px',
                fontWeight: item.active ? 600 : 500,
                color: item.active ? C.accent : C.textSub,
                textDecoration: 'none',
                backgroundColor: item.active ? C.accentBg : 'transparent',
                border: item.active ? `1px solid ${C.accentBorder}` : '1px solid transparent',
              }}>{item.label}</Link>
            ))}
          </nav>
        </div>
      </header>

      {/* ── 메인 ─────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LayoutDashboard size={18} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: C.text, margin: 0 }}>통합 대시보드</h1>
            <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>도매꾹 · 코스트코 · 니치 소싱 현황을 한눈에</p>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: C.textMuted }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* ═══ 통합 스코어보드 (항상 고정) — 위험→건강→성과→규모 순 ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px' }}>
              <ScoreCard
                icon={<Shield size={18} />} label="법적 이슈" color={C.red}
                value={`${(data?.overview.legalBlocked ?? 0)}건`}
                sub={`주의 ${data?.overview.legalWarning ?? 0}건`}
              />
              <ScoreCard
                icon={<TrendingUp size={18} />} label="평균 마진율" color={C.green}
                value={overallAvgMargin != null ? `${overallAvgMargin}` : '—'} unit="%"
                sub={`도매꾹 ${data?.overview.avgMarginDomeggook ?? '—'}% · 코스트코 ${data?.overview.avgMarginCostco ?? '—'}%`}
              />
              <ScoreCard
                icon={<ShoppingCart size={18} />} label="주문 (7일)" color={C.blue}
                value={orderStats?.totalOrders ?? '—'} unit={orderStats ? '건' : ''}
                sub={orderStats?.newOrders ? `신규 ${orderStats.newOrders}건` : undefined}
              />
              <ScoreCard
                icon={<BarChart3 size={18} />} label="매출 (7일)" color={C.purple}
                value={orderStats ? `${Math.round(orderStats.totalRevenue / 10000)}만` : '—'}
                unit={orderStats ? '원' : ''}
              />
              <ScoreCard
                icon={<Package size={18} />} label="전체 소싱 상품" color={C.textSub}
                value={data?.overview.totalProducts ?? 0} unit="개"
                sub={`도매꾹 ${data?.channels.domeggook.products ?? 0} · 코스트코 ${data?.channels.costco.products ?? 0}`}
              />
            </div>

            {/* ═══ 채널 탭 ═══ */}
            <div style={{ display: 'flex', gap: '0', backgroundColor: C.card, borderRadius: '12px 12px 0 0', border: `1px solid ${C.border}`, borderBottom: 'none', padding: '0 4px' }}>
              {([
                { id: 'overview' as const, label: '전체 요약', icon: <LayoutDashboard size={14} /> },
                { id: 'domeggook' as const, label: '도매꾹', icon: <RefreshCw size={14} /> },
                { id: 'costco' as const, label: '코스트코', icon: <Store size={14} /> },
                { id: 'niche' as const, label: '니치소싱', icon: <Search size={14} /> },
              ]).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '11px 20px', border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: activeTab === tab.id ? 600 : 500,
                    color: activeTab === tab.id ? C.accent : C.textSub,
                    backgroundColor: 'transparent',
                    borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >{tab.icon} {tab.label}</button>
              ))}
            </div>

            {/* ═══ 탭 콘텐츠 ═══ */}
            <div style={{ backgroundColor: C.card, borderRadius: '0 0 12px 12px', border: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`, padding: '24px', minHeight: '320px' }}>
              {activeTab === 'overview' && <OverviewTab data={data} orderStats={orderStats} />}
              {activeTab === 'domeggook' && <DomeggookChannelTab data={data?.channels.domeggook ?? null} onRetry={fetchAll} />}
              {activeTab === 'costco' && <CostcoChannelTab data={data?.channels.costco ?? null} onRetry={fetchAll} />}
              {activeTab === 'niche' && <NicheChannelTab data={data?.channels.niche ?? null} onRetry={fetchAll} />}
            </div>

            {/* ═══ 퀵 액션 ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <QuickAction icon={<RefreshCw size={20} />} label="도매꾹 소싱" sub="드롭쉬핑 상품 수집" href="/sourcing" color={C.blue} />
              <QuickAction icon={<Store size={20} />} label="코스트코 소싱" sub="사입 상품 분석" href="/sourcing" color={C.accent} />
              <QuickAction icon={<Search size={20} />} label="니치 분석" sub="시장 트렌드 탐색" href="/sourcing" color={C.purple} />
              <QuickAction icon={<BarChart3 size={20} />} label="매출 분석" sub="주문/매출 현황" href="/orders" color={C.green} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 탭 콘텐츠: 전체 요약
// ═══════════════════════════════════════════════════════════════════
function OverviewTab({ data, orderStats }: { data: DashboardData | null; orderStats: OrderStats | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
      {/* 채널별 마진/수익 비교 */}
      <div>
        <SectionHeader icon={<TrendingUp size={15} color={C.green} />} title="채널별 마진 비교" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          <MarginBar label="도매꾹" margin={data?.channels.domeggook.avgMargin ?? null} target={10} color={C.blue} products={data?.channels.domeggook.products ?? 0} />
          <MarginBar label="코스트코" margin={data?.channels.costco.avgMargin ?? null} target={13} color={C.accent} products={data?.channels.costco.products ?? 0} />
          <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '8px', backgroundColor: '#f9f9f9', fontSize: '11px', color: C.textSub }}>
            목표 마진: 도매꾹 10% (회전 우선) · 코스트코 13% (안정 마진)
          </div>
        </div>
      </div>

      {/* 주문/매출 현황 */}
      <div>
        <SectionHeader icon={<ShoppingCart size={15} color={C.green} />} title="주문/매출 현황 (7일·쿠팡)" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          <StatRow label="총 주문" value={orderStats?.totalOrders ?? 0} unit="건" />
          <StatRow label="총 매출" value={orderStats ? `${Math.round(orderStats.totalRevenue).toLocaleString()}` : '—'} unit="원" />
          <StatRow label="신규 주문" value={orderStats?.newOrders ?? 0} unit="건" highlight />
        </div>
      </div>

      {/* 법적이슈 + 주의 */}
      <div>
        <SectionHeader icon={<AlertTriangle size={15} color={C.orange} />} title="주의 필요" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
          <ActionItem emoji="🔴" text={`KC 인증 누락 ${data?.overview.legalBlocked ?? 0}건`} linkText="검토하기" href="/sourcing" />
          <ActionItem emoji="🟡" text={`상표/과장광고 주의 ${data?.overview.legalWarning ?? 0}건`} linkText="확인하기" href="/sourcing" />
          {orderStats?.newOrders ? (
            <ActionItem emoji="📦" text={`미처리 신규주문 ${orderStats.newOrders}건`} linkText="처리하기" href="/orders" />
          ) : (
            <ActionItem emoji="📦" text="신규 주문 없음" linkText="확인하기" href="/orders" />
          )}
        </div>
      </div>

      {/* 니치 트렌드 요약 */}
      <div>
        <SectionHeader icon={<Search size={15} color={C.purple} />} title="니치 트렌드" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          <StatRow label="추적 키워드" value={data?.channels.niche.trackedKeywords ?? 0} unit="개" />
          <StatRow label="평균 점수" value={data?.channels.niche.avgScore ?? '—'} unit="점" />
          {data?.channels.niche.topKeywords && data.channels.niche.topKeywords.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
              {data.channels.niche.topKeywords.slice(0, 5).map((kw, i) => (
                <span key={i} style={{
                  padding: '4px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: 500,
                  backgroundColor: kw.grade === 'S' ? 'rgba(22,163,74,0.08)' : kw.grade === 'A' ? 'rgba(37,99,235,0.08)' : '#f5f5f5',
                  color: kw.grade === 'S' ? C.green : kw.grade === 'A' ? C.blue : C.textSub,
                  border: `1px solid ${kw.grade === 'S' ? 'rgba(22,163,74,0.2)' : kw.grade === 'A' ? 'rgba(37,99,235,0.2)' : C.border}`,
                }}>
                  {kw.keyword} {kw.grade && <strong>{kw.grade}</strong>}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: C.textMuted }}>아직 분석된 키워드가 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 탭 콘텐츠: 도매꾹 상세
// ═══════════════════════════════════════════════════════════════════
function DomeggookChannelTab({ data, onRetry }: { data: DashboardData['channels']['domeggook'] | null; onRetry: () => void }) {
  if (!data) return <ChannelErrorState channel="도매꾹" onRetry={onRetry} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* KPI 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MiniKPI label="추적 상품" value={data.products} unit="개" color={C.blue} />
        <MiniKPI label="평균 마진율" value={data.avgMargin != null ? `${data.avgMargin}` : '—'} unit="%" color={C.green} />
        <MiniKPI label="법적 차단" value={data.legalBlocked} unit="건" color={C.red} />
        <MiniKPI label="법적 주의" value={data.legalWarning} unit="건" color={C.orange} />
      </div>

      {/* Top 판매 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <SectionHeader icon={<TrendingUp size={15} color={C.green} />} title="7일 판매 Top 5" />
          <Link href="/sourcing" style={{ fontSize: '12px', color: C.textSub, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
            전체보기 <ArrowRight size={12} />
          </Link>
        </div>
        {data.topSellers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.topSellers.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: '10px',
                backgroundColor: i === 0 ? 'rgba(22,163,74,0.04)' : '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: i === 0 ? C.green : C.textMuted, width: '20px' }}>{i + 1}</span>
                  <span style={{ fontSize: '13px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                  {item.priceDome != null && (
                    <span style={{ fontSize: '11px', color: C.textSub }}>{item.priceDome.toLocaleString()}원</span>
                  )}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: C.green }}>
                    {item.sales7d}건
                  </span>
                  {item.marginRate != null && (
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                      backgroundColor: item.marginRate >= 20 ? 'rgba(22,163,74,0.08)' : item.marginRate >= 10 ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)',
                      color: item.marginRate >= 20 ? C.green : item.marginRate >= 10 ? C.orange : C.red,
                    }}>
                      {item.marginRate > 0 ? '+' : ''}{item.marginRate}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ChannelEmptyState
            emoji="📦"
            message="아직 수집된 판매 데이터가 없습니다"
            ctaText="도매꾹 소싱 시작하기"
            ctaHref="/sourcing"
          />
        )}
      </div>

      {data.lastCollected && (
        <p style={{ fontSize: '11px', color: C.textMuted, textAlign: 'right' }}>
          마지막 수집: {new Date(data.lastCollected).toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 탭 콘텐츠: 코스트코 상세
// ═══════════════════════════════════════════════════════════════════
function CostcoChannelTab({ data, onRetry }: { data: DashboardData['channels']['costco'] | null; onRetry: () => void }) {
  if (!data) return <ChannelErrorState channel="코스트코" onRetry={onRetry} />;

  const gradeTotal = data.gradeDistribution.S + data.gradeDistribution.A + data.gradeDistribution.B + data.gradeDistribution.CD;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* KPI 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <MiniKPI label="수집 상품" value={data.products} unit="개" color={C.accent} />
        <MiniKPI label="평균 스코어" value={data.avgScore ?? '—'} unit="점" color={C.blue} />
        <MiniKPI label="평균 마진율" value={data.avgMargin != null ? `${data.avgMargin}` : '—'} unit="%" color={C.green} />
        <MiniKPI label="S/A 등급" value={data.gradeDistribution.S + data.gradeDistribution.A} unit="개" color={C.purple} />
      </div>

      {/* 등급 분포 바 */}
      <div>
        <SectionHeader icon={<BarChart3 size={15} color={C.purple} />} title="소싱 등급 분포" />
        <div style={{ marginTop: '12px' }}>
          {gradeTotal > 0 ? (
            <>
              <div style={{ display: 'flex', height: '28px', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                <GradeBar label="S" count={data.gradeDistribution.S} total={gradeTotal} color="#16a34a" />
                <GradeBar label="A" count={data.gradeDistribution.A} total={gradeTotal} color="#2563eb" />
                <GradeBar label="B" count={data.gradeDistribution.B} total={gradeTotal} color="#d97706" />
                <GradeBar label="C/D" count={data.gradeDistribution.CD} total={gradeTotal} color="#a1a1aa" />
              </div>
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <GradeLegend label="S등급" count={data.gradeDistribution.S} color="#16a34a" desc="80점+" />
                <GradeLegend label="A등급" count={data.gradeDistribution.A} color="#2563eb" desc="65점+" />
                <GradeLegend label="B등급" count={data.gradeDistribution.B} color="#d97706" desc="50점+" />
                <GradeLegend label="C/D등급" count={data.gradeDistribution.CD} color="#a1a1aa" desc="50점 미만" />
              </div>
            </>
          ) : (
            <ChannelEmptyState
              emoji="🏬"
              message="코스트코 상품 수집이 아직 진행되지 않았습니다"
              ctaText="코스트코 소싱 보러가기"
              ctaHref="/sourcing"
            />
          )}
        </div>
      </div>

      <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: '#f9f9f9', fontSize: '12px', color: C.textSub }}>
        목표 순이익률 <strong style={{ color: C.text }}>13%</strong> · 판매 채널 수수료: 네이버 6%, 쿠팡 11%
      </div>

      {data.lastCollected && (
        <p style={{ fontSize: '11px', color: C.textMuted, textAlign: 'right' }}>
          마지막 수집: {new Date(data.lastCollected).toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 탭 콘텐츠: 니치소싱 상세
// ═══════════════════════════════════════════════════════════════════
function NicheChannelTab({ data, onRetry }: { data: DashboardData['channels']['niche'] | null; onRetry: () => void }) {
  if (!data) return <ChannelErrorState channel="니치소싱" onRetry={onRetry} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* KPI 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <MiniKPI label="추적 키워드" value={data.trackedKeywords} unit="개" color={C.purple} />
        <MiniKPI label="평균 점수" value={data.avgScore ?? '—'} unit="점" color={C.blue} />
        <MiniKPI label="Top 키워드" value={data.topKeywords.length} unit="개" color={C.green} />
      </div>

      {/* Top 키워드 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <SectionHeader icon={<Search size={15} color={C.purple} />} title="니치 키워드 Top 5" />
          <Link href="/sourcing" style={{ fontSize: '12px', color: C.textSub, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
            전체보기 <ArrowRight size={12} />
          </Link>
        </div>
        {data.topKeywords.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.topKeywords.map((kw, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: '10px', backgroundColor: '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: i === 0 ? C.purple : C.textMuted, width: '20px' }}>{i + 1}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: C.text }}>{kw.keyword}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {kw.totalScore != null && (
                    <span style={{ fontSize: '12px', color: C.textSub }}>{kw.totalScore}점</span>
                  )}
                  {kw.grade && (
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                      backgroundColor: kw.grade === 'S' ? 'rgba(22,163,74,0.08)' : kw.grade === 'A' ? 'rgba(37,99,235,0.08)' : '#f0f0f0',
                      color: kw.grade === 'S' ? C.green : kw.grade === 'A' ? C.blue : C.textSub,
                    }}>{kw.grade}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ChannelEmptyState
            emoji="🔍"
            message="아직 분석된 키워드가 없습니다"
            ctaText="니치 키워드 추가하기"
            ctaHref="/sourcing"
          />
        )}
      </div>

      <Link href="/sourcing" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        padding: '12px', borderRadius: '10px', border: `1px solid ${C.border}`,
        textDecoration: 'none', fontSize: '13px', fontWeight: 500, color: C.accent,
        backgroundColor: '#fafafa', transition: 'background-color 0.15s',
      }}>
        <Search size={14} /> 니치 키워드 분석하러 가기 <ArrowRight size={14} />
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 공통 서브 컴포넌트
// ═══════════════════════════════════════════════════════════════════

function ScoreCard({ icon, label, value, unit, sub, color }: {
  icon: React.ReactNode; label: string; value: number | string; unit?: string; sub?: string; color: string;
}) {
  return (
    <div style={{
      backgroundColor: C.card, borderRadius: '14px', border: `1px solid ${C.border}`,
      padding: '18px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
        <div style={{ color }}>{icon}</div>
        <span style={{ fontSize: '11px', fontWeight: 500, color: C.textSub }}>{label}</span>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: C.text }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span style={{ fontSize: '13px', fontWeight: 500, color: C.textMuted, marginLeft: '3px' }}>{unit}</span>}
      </div>
      {sub && <p style={{ fontSize: '10px', color: C.textMuted, margin: '4px 0 0', lineHeight: 1.4 }}>{sub}</p>}
    </div>
  );
}

function MiniKPI({ label, value, unit, color }: {
  label: string; value: number | string; unit?: string; color: string;
}) {
  return (
    <div style={{
      padding: '14px', borderRadius: '10px', border: `1px solid ${C.border}`, backgroundColor: '#fafafa',
    }}>
      <p style={{ fontSize: '11px', color: C.textSub, margin: '0 0 6px' }}>{label}</p>
      <div style={{ fontSize: '20px', fontWeight: 700, color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span style={{ fontSize: '12px', fontWeight: 500, color: C.textMuted, marginLeft: '2px' }}>{unit}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      {icon}
      <h3 style={{ fontSize: '14px', fontWeight: 600, color: C.text, margin: 0 }}>{title}</h3>
    </div>
  );
}

function MarginBar({ label, margin, target, color, products }: {
  label: string; margin: number | null; target: number; color: string; products: number;
}) {
  const pct = margin != null ? Math.min(margin / 30 * 100, 100) : 0;
  const targetPct = target / 30 * 100;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>{label} <span style={{ fontWeight: 400, color: C.textSub }}>({products}개)</span></span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: margin != null && margin >= target ? C.green : C.orange }}>
          {margin != null ? `${margin}%` : '—'}
        </span>
      </div>
      <div style={{ position: 'relative', height: '8px', borderRadius: '4px', backgroundColor: '#f0f0f0' }}>
        <div style={{ height: '100%', borderRadius: '4px', backgroundColor: color, width: `${pct}%`, transition: 'width 0.5s', opacity: 0.8 }} />
        <div style={{
          position: 'absolute', top: '-2px', left: `${targetPct}%`, width: '2px', height: '12px',
          backgroundColor: C.red, borderRadius: '1px',
        }} />
      </div>
      <div style={{ fontSize: '10px', color: C.textMuted, marginTop: '2px', textAlign: 'right' }}>목표 {target}%</div>
    </div>
  );
}

function GradeBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  if (pct === 0) return null;
  return (
    <div style={{
      width: `${pct}%`, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '11px', fontWeight: 600, color: '#fff', minWidth: pct > 5 ? 'auto' : '0',
      transition: 'width 0.5s',
    }}>
      {pct > 8 ? `${label} ${count}` : ''}
    </div>
  );
}

function GradeLegend({ label, count, color, desc }: { label: string; count: number; color: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: color }} />
      <span style={{ fontSize: '11px', color: C.text, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: '11px', color: C.textSub }}>{count}개</span>
      <span style={{ fontSize: '10px', color: C.textMuted }}>({desc})</span>
    </div>
  );
}

function StatRow({ label, value, unit, highlight }: {
  label: string; value: number | string; unit?: string; highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', borderRadius: '8px', backgroundColor: highlight ? 'rgba(190,0,20,0.03)' : '#fafafa',
    }}>
      <span style={{ fontSize: '13px', color: C.textSub }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: 600, color: highlight ? C.accent : C.text }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span style={{ fontSize: '12px', fontWeight: 400, color: C.textMuted, marginLeft: '2px' }}>{unit}</span>}
      </span>
    </div>
  );
}

function ActionItem({ emoji, text, linkText, href }: { emoji: string; text: string; linkText: string; href: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '10px', backgroundColor: '#fafafa' }}>
      <span style={{ fontSize: '13px', color: C.text }}>{emoji} {text}</span>
      <Link href={href} style={{ fontSize: '12px', color: C.accent, fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
        {linkText} <ArrowRight size={11} />
      </Link>
    </div>
  );
}

function QuickAction({ icon, label, sub, href, color }: {
  icon: React.ReactNode; label: string; sub: string; href: string; color: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        backgroundColor: C.card, borderRadius: '14px', border: `1px solid ${C.border}`,
        padding: '18px', display: 'flex', alignItems: 'center', gap: '14px',
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          backgroundColor: `${color}10`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color, flexShrink: 0,
        }}>{icon}</div>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: 0 }}>{label}</p>
          <p style={{ fontSize: '11px', color: C.textMuted, margin: '2px 0 0' }}>{sub}</p>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p style={{ fontSize: '13px', color: C.textMuted, textAlign: 'center', padding: '24px 0' }}>{message}</p>
  );
}

/** 채널별 빈 상태 — CTA 버튼 포함 */
function ChannelEmptyState({ emoji, message, ctaText, ctaHref }: {
  emoji: string; message: string; ctaText: string; ctaHref: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '32px 0' }}>
      <span style={{ fontSize: '28px' }}>{emoji}</span>
      <p style={{ fontSize: '13px', color: C.textMuted, margin: 0 }}>{message}</p>
      <Link href={ctaHref} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '8px 18px', borderRadius: '8px',
        backgroundColor: C.accent, color: '#fff',
        fontSize: '13px', fontWeight: 600, textDecoration: 'none',
      }}>
        {ctaText} <ArrowRight size={13} />
      </Link>
    </div>
  );
}

/** 채널 데이터 로드 실패 — 재시도 버튼 + 마지막 상태 안내 */
function ChannelErrorState({ channel, onRetry }: { channel: string; onRetry: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '32px 0' }}>
      <AlertTriangle size={24} color={C.orange} />
      <p style={{ fontSize: '13px', color: C.textSub, margin: 0 }}>{channel} 데이터를 불러오지 못했습니다</p>
      <button
        onClick={onRetry}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '7px 16px', borderRadius: '8px', cursor: 'pointer',
          border: `1px solid ${C.border}`, backgroundColor: '#fafafa',
          fontSize: '12px', fontWeight: 500, color: C.text,
        }}
      >
        <RefreshCw size={13} /> 다시 시도
      </button>
    </div>
  );
}
