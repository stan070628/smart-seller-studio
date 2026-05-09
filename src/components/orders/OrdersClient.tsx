'use client';

import React, { useState } from 'react';
import { ShoppingCart, BarChart3, Settings, ClipboardList } from 'lucide-react';
import OrdersTab from './OrdersTab';
import AnalyticsTab from './AnalyticsTab';
import ChannelsTab from './ChannelsTab';

type SubTab = 'orders' | 'analytics' | 'channels';


const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문관리', icon: <ClipboardList size={14} /> },
  { id: 'analytics', label: '매출분석', icon: <BarChart3 size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
];

export default function OrdersClient() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('orders');

  return (
    <div style={{ backgroundColor: '#f5f5f7', minHeight: '100%' }}>
      <main style={{ maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
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
