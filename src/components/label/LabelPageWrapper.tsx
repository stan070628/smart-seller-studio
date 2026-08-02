'use client';

import { useState, useEffect, Suspense } from 'react';
import LabelEditor from './LabelEditor';
import EventCardEditor from './EventCardEditor';
import ImageLabel2x2Editor from './ImageLabel2x2Editor';
import NutritionLabel2x3Editor from './NutritionLabel2x3Editor';
import QualityLabel2x3Editor from './QualityLabel2x3Editor';
import CosmeticLabel2x3Editor from './CosmeticLabel2x3Editor';
import ImageLabel2x3Editor from './ImageLabel2x3Editor';
import ImageLabel3x3Editor from './ImageLabel3x3Editor';
// 계산기(src/components/calculator/persist.ts)에서 검증된 SSR-safe localStorage 헬퍼를 그대로 재사용한다.
// 라벨 전용으로 파일을 옮기면 계산기 쪽 8개 파일의 import까지 고쳐야 해서, 이름만 라벨 맥락에 맞게 alias한다.
import { loadCalcState as loadPersistedState, saveCalcState as savePersistedState } from '@/components/calculator/persist';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

type LabelTab = 'quality' | 'event' | 'image2x2' | 'image2x3' | 'image3x3' | 'nutrition2x3' | 'quality2x3' | 'cosmetic2x3';

const TAB_IDS: LabelTab[] = [
  'quality', 'event', 'image2x2', 'image2x3', 'image3x3', 'nutrition2x3', 'quality2x3', 'cosmetic2x3',
];

const ACTIVE_TAB_KEY = 'sss_label_active_tab';

interface ActiveTabDraft {
  activeTab: LabelTab;
}

export default function LabelPageWrapper() {
  // 첫 렌더는 서버와 동일하게 'quality'로 고정한다. 탭 목록 중 어느 것이 보이는가는
  // 화면 전체 구조를 바꾸는 값이라, 서버 렌더 결과와 다르면 하이드레이션이 어긋난다.
  // 복원은 마운트 이후 useEffect에서 한 번만 한다.
  const [activeTab, setActiveTab] = useState<LabelTab>('quality');

  useEffect(() => {
    const saved = loadPersistedState<ActiveTabDraft>(ACTIVE_TAB_KEY);
    if (saved.activeTab && TAB_IDS.includes(saved.activeTab)) setActiveTab(saved.activeTab);
  }, []);

  // 탭 전환은 타이핑처럼 빈번하지 않으므로 디바운스 없이 즉시 저장한다 (계산기와 동일한 판단)
  useEffect(() => {
    savePersistedState(ACTIVE_TAB_KEY, { activeTab });
  }, [activeTab]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 탭 바 */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${C.border}`,
          background: '#fff',
          padding: '0 16px',
          gap: 4,
          flexShrink: 0,
        }}
      >
        {([
          { id: 'quality' as const, label: '품질표시 라벨' },
          { id: 'quality2x3' as const, label: '📋 품질표시 2×3' },
          { id: 'event' as const, label: '🎁 이벤트 카드' },
          { id: 'image2x2' as const, label: '🖼 이미지 2×2' },
          { id: 'image2x3' as const, label: '🖼 이미지 2×3' },
          { id: 'image3x3' as const, label: '🖼 이미지 3×3' },
          { id: 'nutrition2x3' as const, label: '📊 영양정보 2×3' },
          { id: 'cosmetic2x3' as const, label: '🧴 화장품 라벨 2×3' },
        ] as { id: LabelTab; label: string }[]).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? '#6366f1' : '#71717a',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 - 조건부 렌더 (LabelEditor는 localStorage로 상태 보존) */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'quality' ? (
          <Suspense>
            <LabelEditor />
          </Suspense>
        ) : activeTab === 'quality2x3' ? (
          <QualityLabel2x3Editor />
        ) : activeTab === 'event' ? (
          <EventCardEditor />
        ) : activeTab === 'image2x2' ? (
          <ImageLabel2x2Editor />
        ) : activeTab === 'image2x3' ? (
          <ImageLabel2x3Editor />
        ) : activeTab === 'image3x3' ? (
          <ImageLabel3x3Editor />
        ) : activeTab === 'nutrition2x3' ? (
          <NutritionLabel2x3Editor />
        ) : (
          <CosmeticLabel2x3Editor />
        )}
      </div>
    </div>
  );
}
