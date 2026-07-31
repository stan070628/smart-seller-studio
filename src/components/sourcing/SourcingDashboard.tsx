'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';

// ── 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import ShortlistTab from '@/components/sourcing/ShortlistTab';
import CostcoTab from '@/components/sourcing/CostcoTab';
import SourcingAgentTab from '@/components/sourcing/SourcingAgentTab';
import SourcingMemoTab from '@/components/sourcing/SourcingMemoTab';

// ─── 타입 ─────────────────────────────────────────────────────────────────────
type Tab = 'shortlist' | 'costco' | 'agent' | 'memo';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shortlist', label: '소싱리스트' },
  { key: 'costco', label: '코스트코' },
  { key: 'agent', label: '봇결과' },
  { key: 'memo', label: '메모' },
];

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function SourcingDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('shortlist');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', backgroundColor: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* ── 탭 (소싱리스트 / 코스트코 / 봇결과 / 메모) ───────────────────────── */}
      <div style={{ display: 'flex', backgroundColor: C.card, borderBottom: `2px solid ${C.border}`, padding: '0 24px' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 28px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? C.accent : C.textSub,
              backgroundColor: 'transparent',
              borderBottom: activeTab === tab.key ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {activeTab === 'shortlist' && <ShortlistTab />}
        {activeTab === 'costco' && <CostcoTab />}
        {activeTab === 'agent' && <SourcingAgentTab />}
        {activeTab === 'memo' && <SourcingMemoTab />}
      </div>
    </div>
  );
}
