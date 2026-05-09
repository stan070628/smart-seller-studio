'use client';

import { useState, Suspense } from 'react';
import LabelEditor from './LabelEditor';
import EventCardEditor from './EventCardEditor';
import ImageLabel2x2Editor from './ImageLabel2x2Editor';
import NutritionLabel2x3Editor from './NutritionLabel2x3Editor';

const C = { border: '#e5e7eb', bg: '#f9fafb' };

type LabelTab = 'quality' | 'event' | 'image2x2' | 'nutrition2x3';

export default function LabelPageWrapper() {
  const [activeTab, setActiveTab] = useState<LabelTab>('quality');

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
          { id: 'event' as const, label: '🎁 이벤트 카드' },
          { id: 'image2x2' as const, label: '🖼 이미지 2×2' },
          { id: 'nutrition2x3' as const, label: '📊 영양정보 2×3' },
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
        ) : activeTab === 'event' ? (
          <EventCardEditor />
        ) : activeTab === 'image2x2' ? (
          <ImageLabel2x2Editor />
        ) : (
          <NutritionLabel2x3Editor />
        )}
      </div>
    </div>
  );
}
