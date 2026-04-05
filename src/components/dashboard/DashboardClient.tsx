'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
  FileText,
} from 'lucide-react';

// ─── 공통 네비게이션 ─────────────────────────────────────────
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
];

// ─── 소싱 통계 타입 ─────────────────────────────────────────
interface SourcingStats {
  totalItems: number;
  legalBlocked: number;
  legalWarning: number;
  topSellers: { title: string; sales7d: number; marginRate: number | null }[];
}

export default function DashboardClient() {
  const [sourcingStats, setSourcingStats] = useState<SourcingStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      // 소싱 데이터에서 통계 추출
      const res = await fetch('/api/sourcing/analyze?sort=sales_7d&order=desc&limit=5');
      const json = await res.json();
      if (json.success) {
        const items = json.data.items ?? [];
        setSourcingStats({
          totalItems: json.data.total ?? 0,
          legalBlocked: items.filter((i: Record<string, unknown>) => i.legalStatus === 'blocked').length,
          legalWarning: items.filter((i: Record<string, unknown>) => i.legalStatus === 'warning').length,
          topSellers: items.slice(0, 5).map((i: Record<string, unknown>) => ({
            title: i.title as string,
            sales7d: i.sales7d as number,
            marginRate: i.marginRate as number | null,
          })),
        });
      }
    } catch {
      // 데이터 없어도 대시보드는 표시
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f5f7' }}>
      {/* 헤더 */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 50,
          height: '52px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid #eee', backgroundColor: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px', color: '#1a1c1c' }}>
              Smart<span style={{ color: '#be0014' }}>Seller</span>Studio
            </span>
            <span style={{ backgroundColor: 'rgba(190,0,20,0.08)', color: '#be0014', fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '100px', border: '1px solid rgba(190,0,20,0.2)' }}>
              Beta
            </span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px', borderRadius: '6px', fontSize: '13px',
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? '#be0014' : '#71717a',
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190,0,20,0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* 메인 */}
      <main style={{ flex: 1, maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LayoutDashboard size={18} color="#be0014" />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#18181b', margin: 0 }}>대시보드</h1>
            <p style={{ fontSize: '12px', color: '#71717a', margin: 0 }}>전체 현황을 한눈에 확인하세요</p>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#a1a1aa' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 요약 카드 4개 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              <SummaryCard icon={<Package size={18} />} label="추적 상품" value={sourcingStats?.totalItems ?? 0} unit="개" color="#2563eb" href="/sourcing" />
              <SummaryCard icon={<ShoppingCart size={18} />} label="주문 (미연동)" value="—" color="#16a34a" href="/orders" />
              <SummaryCard icon={<BarChart3 size={18} />} label="매출 (미연동)" value="—" color="#7c3aed" href="/orders" />
              <SummaryCard icon={<Shield size={18} />} label="법적 이슈" value={`${sourcingStats?.legalBlocked ?? 0}건`} sub={`주의 ${sourcingStats?.legalWarning ?? 0}건`} color="#dc2626" href="/sourcing" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {/* 판매량 급증 Top 5 */}
              <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e5e5e5', padding: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={16} color="#16a34a" />
                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: 0 }}>7일 판매 Top 5</h3>
                  </div>
                  <Link href="/sourcing" style={{ fontSize: '12px', color: '#71717a', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    전체보기 <ArrowRight size={12} />
                  </Link>
                </div>
                {sourcingStats?.topSellers && sourcingStats.topSellers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {sourcingStats.topSellers.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '10px', backgroundColor: i === 0 ? 'rgba(22,163,74,0.04)' : 'transparent' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: i === 0 ? '#16a34a' : '#a1a1aa', width: '20px' }}>{i + 1}</span>
                          <span style={{ fontSize: '13px', color: '#18181b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a' }}>▼{item.sales7d}</span>
                          {item.marginRate != null && (
                            <span style={{ fontSize: '11px', color: item.marginRate >= 20 ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                              {item.marginRate > 0 ? '+' : ''}{item.marginRate}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '13px', color: '#a1a1aa', textAlign: 'center', padding: '20px 0' }}>소싱 데이터를 먼저 수집하세요</p>
                )}
              </div>

              {/* 즉시 처리 필요 */}
              <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e5e5e5', padding: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <AlertTriangle size={16} color="#d97706" />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: 0 }}>주의 필요</h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <ActionItem emoji="🔴" text={`KC 인증 누락 ${sourcingStats?.legalBlocked ?? 0}건`} linkText="검토하기" href="/sourcing" />
                  <ActionItem emoji="🟡" text={`상표/과장광고 주의 ${sourcingStats?.legalWarning ?? 0}건`} linkText="확인하기" href="/sourcing" />
                  <ActionItem emoji="📦" text="주문 채널 미연동" linkText="설정하기" href="/orders" />
                  <ActionItem emoji="📋" text="상품등록 채널 미연동" linkText="연동하기" href="/listing" />
                </div>
              </div>
            </div>

            {/* 퀵 액션 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <QuickAction icon={<Package size={20} />} label="소싱 수집" sub="도매꾹 상품 수집" href="/sourcing" color="#2563eb" />
              <QuickAction icon={<FileText size={20} />} label="상세페이지 제작" sub="AI 카피 생성" href="/editor" color="#be0014" />
              <QuickAction icon={<ShoppingCart size={20} />} label="상품 등록" sub="플랫폼 등록 관리" href="/listing" color="#7c3aed" />
              <QuickAction icon={<BarChart3 size={20} />} label="매출 분석" sub="주문/매출 현황" href="/orders" color="#16a34a" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────

function SummaryCard({ icon, label, value, unit, sub, color, href }: {
  icon: React.ReactNode; label: string; value: number | string; unit?: string; sub?: string; color: string; href: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e5e5e5', padding: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'border-color 0.15s', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <div style={{ color }}>{icon}</div>
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#71717a' }}>{label}</span>
        </div>
        <div style={{ fontSize: '24px', fontWeight: 700, color: '#18181b' }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
          {unit && <span style={{ fontSize: '14px', fontWeight: 500, color: '#a1a1aa', marginLeft: '4px' }}>{unit}</span>}
        </div>
        {sub && <p style={{ fontSize: '11px', color: '#a1a1aa', margin: '4px 0 0' }}>{sub}</p>}
      </div>
    </Link>
  );
}

function ActionItem({ emoji, text, linkText, href }: { emoji: string; text: string; linkText: string; href: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '10px', backgroundColor: '#fafafa' }}>
      <span style={{ fontSize: '13px', color: '#18181b' }}>{emoji} {text}</span>
      <Link href={href} style={{ fontSize: '12px', color: '#be0014', fontWeight: 500, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
        {linkText} <ArrowRight size={11} />
      </Link>
    </div>
  );
}

function QuickAction({ icon, label, sub, href, color }: { icon: React.ReactNode; label: string; sub: string; href: string; color: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '18px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer', transition: 'border-color 0.15s' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: `${color}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
          {icon}
        </div>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#18181b', margin: 0 }}>{label}</p>
          <p style={{ fontSize: '11px', color: '#a1a1aa', margin: '2px 0 0' }}>{sub}</p>
        </div>
      </div>
    </Link>
  );
}
