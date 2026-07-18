'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { ShoppingCart, BarChart3, Settings, ClipboardList, Wallet, Receipt } from 'lucide-react';
import OrdersTab from './OrdersTab';
import ChannelsTab from './ChannelsTab';
import CostManagementTab from './CostManagementTab';
import SettlementTab from './SettlementTab';
import ExpensesTab from './ExpensesTab';

type SubTab = 'orders' | 'channels' | 'cost' | 'settlement' | 'expenses';

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문·배송', icon: <ClipboardList size={14} /> },
  { id: 'cost', label: '수익·원가', icon: <BarChart3 size={14} /> },
  { id: 'settlement', label: '정산', icon: <Wallet size={14} /> },
  { id: 'expenses', label: '비용', icon: <Receipt size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
];

function OrdersClientInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('orders');

  // URL ?tab= 파라미터에서 초기 탭 동기화
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'cost' || tab === 'channels' || tab === 'settlement' || tab === 'expenses') setActiveSubTab(tab);
    else setActiveSubTab('orders');
  }, [searchParams]);

  // 탭 전환 + URL 동기화 헬퍼 — 기본 탭(orders)은 파라미터를 제거
  const goTab = (id: SubTab) => {
    setActiveSubTab(id);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (id === 'orders') params.delete('tab');
    else params.set('tab', id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div style={{ backgroundColor: '#f5f5f7', minHeight: '100%' }}>
      <main style={{ width: '100%', padding: '28px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShoppingCart size={18} color="#be0014" />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#18181b', margin: 0 }}>주문 / 매출</h1>
            <p style={{ fontSize: '12px', color: '#71717a', margin: 0 }}>주문 배송 · 수익·원가 관리 · 채널 설정</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '20px', border: '1px solid #e5e5e5' }}>
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => goTab(tab.id)}
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

        {activeSubTab === 'orders' && <OrdersTab />}
        {activeSubTab === 'cost' && <CostManagementTab />}
        {activeSubTab === 'settlement' && <SettlementTab />}
        {activeSubTab === 'expenses' && <ExpensesTab />}
        {activeSubTab === 'channels' && <ChannelsTab />}
      </main>
    </div>
  );
}

export default function OrdersClient() {
  return (
    <Suspense fallback={null}>
      <OrdersClientInner />
    </Suspense>
  );
}
