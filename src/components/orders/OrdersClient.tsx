'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, BarChart3, Settings, ClipboardList } from 'lucide-react';
import OrdersTab from './OrdersTab';
import AnalyticsTab from './AnalyticsTab';
import ChannelsTab from './ChannelsTab';

type SubTab = 'orders' | 'analytics' | 'channels';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출', active: true },
  { href: '/plan', label: '플랜' },
  { href: '/ad-strategy', label: '광고전략' },
];

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문관리', icon: <ClipboardList size={14} /> },
  { id: 'analytics', label: '매출분석', icon: <BarChart3 size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
];

export default function OrdersClient() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('orders');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f5f7' }}>
      {/* 헤더 */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, height: '52px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid #eee', backgroundColor: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px', color: '#1a1c1c' }}>
              Smart<span style={{ color: '#be0014' }}>Seller</span>Studio
            </span>
            <span style={{ backgroundColor: 'rgba(190,0,20,0.08)', color: '#be0014', fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '100px', border: '1px solid rgba(190,0,20,0.2)' }}>Beta</span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: item.active ? 600 : 500, color: item.active ? '#be0014' : '#71717a', textDecoration: 'none', backgroundColor: item.active ? 'rgba(190,0,20,0.07)' : 'transparent', border: item.active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent', whiteSpace: 'nowrap' }}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShoppingCart size={18} color="#be0014" />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#18181b', margin: 0 }}>주문 / 매출</h1>
            <p style={{ fontSize: '12px', color: '#71717a', margin: 0 }}>주문 라우팅 · 매출 분석 · 채널 관리</p>
          </div>
        </div>

        {/* 서브탭 */}
        <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '20px', border: '1px solid #e5e5e5' }}>
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: activeSubTab === tab.id ? 600 : 500,
                color: activeSubTab === tab.id ? '#be0014' : '#71717a',
                backgroundColor: activeSubTab === tab.id ? 'rgba(190,0,20,0.07)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* 콘텐츠 */}
        {activeSubTab === 'orders' && <OrdersTab />}
        {activeSubTab === 'analytics' && <AnalyticsTab />}
        {activeSubTab === 'channels' && <ChannelsTab />}
      </main>
    </div>
  );
}
