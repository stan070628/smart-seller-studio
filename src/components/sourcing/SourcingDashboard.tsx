'use client';

import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import { C } from '@/lib/design-tokens';

// ── 발굴 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import DeepKeywordEngine from '@/components/sourcing/DeepKeywordEngine';
import NicheTab from '@/components/niche/NicheTab';
import NicheAlertBadge from '@/components/niche/NicheAlertBadge';
import { useNicheStore } from '@/store/useNicheStore';
import ProductDiscoveryTab from '@/components/sourcing/ProductDiscoveryTab';
import KeywordTrackerTab from '@/components/sourcing/KeywordTrackerTab';
import SourcingAgentTab from '@/components/sourcing/SourcingAgentTab';

// ── 검증 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import TrademarkPrecheckForm from '@/components/sourcing/TrademarkPrecheckForm';
import WinnerOccupancyTable from '@/components/winner/WinnerOccupancyTable';
import KeywordSuggestionForm from '@/components/winner/KeywordSuggestionForm';
import CoupangTab from '@/components/calculator/tabs/CoupangTab';
import NaverTab from '@/components/calculator/tabs/NaverTab';
import GmarketTab from '@/components/calculator/tabs/GmarketTab';
import ElevenstTab from '@/components/calculator/tabs/ElevenstTab';
import ShopeeTab from '@/components/calculator/tabs/ShopeeTab';
import CompareMode from '@/components/calculator/CompareMode';

// ── 실행 탭 컴포넌트들 ─────────────────────────────────────────────────────────
import DomeggookTab from '@/components/sourcing/DomeggookTab';
import CostcoTab from '@/components/sourcing/CostcoTab';
import SourcingMemoTab from '@/components/sourcing/SourcingMemoTab';
import InboundChecklistForm from '@/components/sourcing/InboundChecklistForm';
import { NEGOTIATION_STEPS } from '@/lib/sourcing/negotiation-guide';

// ─── 타입 ─────────────────────────────────────────────────────────────────────
type MainTab = 'discover' | 'validate' | 'execute';
type DiscoverSubTab = 'keywords' | 'niche' | 'seed' | 'tracker' | 'agent';
type ValidateSubTab = 'margin' | 'trademark' | 'winner' | 'keyword-opt';
type ExecuteSubTab = 'domeggook' | 'costco' | 'memo' | 'inbound' | 'negotiation';
type CalcTab = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee';

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function SourcingDashboard() {
  const [mainTab, setMainTab] = useState<MainTab>('discover');
  const [discoverSubTab, setDiscoverSubTab] = useState<DiscoverSubTab>('keywords');
  const [validateSubTab, setValidateSubTab] = useState<ValidateSubTab>('margin');
  const [executeSubTab, setExecuteSubTab] = useState<ExecuteSubTab>('domeggook');
  const unreadAlertCount = useNicheStore((s) => s.unreadAlertCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', backgroundColor: C.bg, fontFamily: "'Noto Sans KR', sans-serif", color: C.text }}>
      {/* ── 메인 탭 (발굴 / 검증 / 실행) ───────────────────────────────────────── */}
      <div style={{ display: 'flex', backgroundColor: C.card, borderBottom: `2px solid ${C.border}`, padding: '0 24px' }}>
        {([
          { id: 'discover' as MainTab, label: '발굴' },
          { id: 'validate' as MainTab, label: '검증' },
          { id: 'execute' as MainTab,  label: '실행' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMainTab(tab.id)}
            style={{
              padding: '12px 28px', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: mainTab === tab.id ? 700 : 500,
              color: mainTab === tab.id ? C.accent : C.textSub,
              backgroundColor: 'transparent',
              borderBottom: mainTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === 'discover' && (
        <DiscoverSection subTab={discoverSubTab} setSubTab={setDiscoverSubTab} unreadAlertCount={unreadAlertCount} />
      )}
      {mainTab === 'validate' && (
        <ValidateSection subTab={validateSubTab} setSubTab={setValidateSubTab} />
      )}
      {mainTab === 'execute' && (
        <ExecuteSection subTab={executeSubTab} setSubTab={setExecuteSubTab} />
      )}
    </div>
  );
}

// ─── 공통: 서브탭 바 ──────────────────────────────────────────────────────────
function SubTabBar({ tabs, active, onSelect }: {
  tabs: { id: string; label: string; badge?: React.ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', backgroundColor: '#fafafa', borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: active === tab.id ? 600 : 500,
            color: active === tab.id ? C.accent : C.textSub,
            backgroundColor: 'transparent',
            borderBottom: active === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          {tab.label}
          {tab.badge ?? null}
        </button>
      ))}
    </div>
  );
}

// ─── 발굴 섹션 ────────────────────────────────────────────────────────────────
function DiscoverSection({ subTab, setSubTab, unreadAlertCount }: {
  subTab: DiscoverSubTab;
  setSubTab: (t: DiscoverSubTab) => void;
  unreadAlertCount: number;
}) {
  const tabs = [
    { id: 'keywords', label: '🔍 딥 키워드' },
    { id: 'niche',    label: '니치소싱', badge: <NicheAlertBadge count={unreadAlertCount} /> },
    { id: 'seed',     label: '🌱 상품 발굴' },
    { id: 'tracker',  label: '키워드 목록' },
    { id: 'agent',    label: '🤖 소싱 에이전트' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as DiscoverSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'keywords' && <DeepKeywordEngine />}
        {subTab === 'niche'    && <NicheTab />}
        {subTab === 'seed'     && <ProductDiscoveryTab />}
        {subTab === 'tracker'  && <KeywordTrackerTab />}
        {subTab === 'agent'    && <SourcingAgentTab />}
      </div>
    </>
  );
}

// ─── 검증 섹션 ────────────────────────────────────────────────────────────────
function ValidateSection({ subTab, setSubTab }: {
  subTab: ValidateSubTab;
  setSubTab: (t: ValidateSubTab) => void;
}) {
  const tabs = [
    { id: 'margin',      label: '마진계산기' },
    { id: 'trademark',   label: '상표 사전검색' },
    { id: 'winner',      label: '위너 대시보드' },
    { id: 'keyword-opt', label: '키워드 최적화' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as ValidateSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'margin'      && <SourcingCalculator />}
        {subTab === 'trademark'   && <TrademarkPrecheckContent />}
        {subTab === 'winner'      && <WinnerDashboardContent />}
        {subTab === 'keyword-opt' && <KeywordOptimizerContent />}
      </div>
    </>
  );
}

// ─── 실행 섹션 ────────────────────────────────────────────────────────────────
function ExecuteSection({ subTab, setSubTab }: {
  subTab: ExecuteSubTab;
  setSubTab: (t: ExecuteSubTab) => void;
}) {
  const tabs = [
    { id: 'domeggook',   label: '도매꾹' },
    { id: 'costco',      label: '코스트코' },
    { id: 'memo',        label: '소싱 메모' },
    { id: 'inbound',     label: '입고 체크리스트' },
    { id: 'negotiation', label: '협상 가이드' },
  ];

  return (
    <>
      <SubTabBar tabs={tabs} active={subTab} onSelect={(id) => setSubTab(id as ExecuteSubTab)} />
      <div style={{ flex: 1, padding: '20px 24px', overflow: 'auto' }}>
        {subTab === 'domeggook'   && <DomeggookTab />}
        {subTab === 'costco'      && <CostcoTab />}
        {subTab === 'memo'        && <SourcingMemoTab />}
        {subTab === 'inbound'     && <InboundChecklistContent />}
        {subTab === 'negotiation' && <NegotiationGuideContent />}
      </div>
    </>
  );
}

// ─── 콘텐츠 래퍼들 (서브 라우트 → 탭 승격) ──────────────────────────────────

function TrademarkPrecheckContent() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 발주 사전체크</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        위너 후보 상품명을 입력하면 KIPRIS 등록상표를 검사합니다. 등록상표 충돌 시 1688 검색 링크가 자동 차단됩니다.
      </p>
      <TrademarkPrecheckForm />
    </div>
  );
}

function WinnerDashboardContent() {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>위너 대시보드</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        SKU별 아이템위너 점유율 일별 추적. 빼앗김 발생 시 알림 센터에 표시됩니다.
      </p>
      <WinnerOccupancyTable />
    </div>
  );
}

function KeywordOptimizerContent() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>위너 SKU 키워드 최적화</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        검색 1페이지 진입 못 한 위너 SKU의 상품명을 AI로 재구성합니다.
      </p>
      <KeywordSuggestionForm />
    </div>
  );
}

function InboundChecklistContent() {
  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 입고 체크리스트</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        SKU 정보를 입력하면 체크리스트가 자동 생성됩니다. 브라우저 인쇄(Cmd+P) → PDF 저장.
      </p>
      <InboundChecklistForm />
    </div>
  );
}

function NegotiationGuideContent() {
  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>1688 가격 협상 가이드</h2>
      <p style={{ fontSize: 12, color: C.textSub, margin: '0 0 20px' }}>
        채널 영상 "1688 네고 흥정 팁 (2025-06-22)" 기반. 발주 단계별 협상 전략.
      </p>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {NEGOTIATION_STEPS.map((step) => (
          <li key={step.order} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: C.text }}>
              {step.order}. {step.title}
            </h3>
            <p style={{ fontSize: 13, color: C.textSub, margin: 0 }}>{step.detail}</p>
            {step.tip && (
              <div style={{
                marginTop: 8, borderRadius: 6, border: '1px solid #fde68a',
                background: '#fefce8', padding: '8px 12px', fontSize: 12, color: '#92400e',
              }}>
                💡 {step.tip}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── 서브 컴포넌트: 마진계산기 ────────────────────────────────────────────────
const CALC_TABS: { id: CalcTab; label: string; color: string }[] = [
  { id: 'coupang',  label: '쿠팡',   color: '#be0014' },
  { id: 'naver',    label: '네이버', color: '#03c75a' },
  { id: 'gmarket',  label: 'G마켓',  color: '#6dbe46' },
  { id: 'elevenst', label: '11번가', color: '#ff0038' },
  { id: 'shopee',   label: 'Shopee', color: '#ee4d2d' },
];

function SourcingCalculator() {
  const [activeCalcTab, setActiveCalcTab] = React.useState<CalcTab>('coupang');
  const [showCompare, setShowCompare] = React.useState(false);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
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

          {activeCalcTab === 'coupang'  && <CoupangTab />}
          {activeCalcTab === 'naver'    && <NaverTab />}
          {activeCalcTab === 'gmarket'  && <GmarketTab />}
          {activeCalcTab === 'elevenst' && <ElevenstTab />}
          {activeCalcTab === 'shopee'   && <ShopeeTab />}
        </>
      )}

      <p style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px', color: '#a1a1aa' }}>
        수수료는 2025년 10월 기준이며, 플랫폼 정책 변경에 따라 달라질 수 있습니다.
      </p>
    </div>
  );
}
