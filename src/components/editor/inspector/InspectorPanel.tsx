'use client';

/**
 * InspectorPanel.tsx
 * 3컬럼 레이아웃의 오른쪽 패널 — 선택된 프레임의 편집 컨트롤을 표시
 */

import React, { useState, useEffect } from 'react';
import useEditorStore from '@/store/useEditorStore';
import { getFrameSlots } from '@/lib/constants/image-slots';
import EmptyInspectorState from './EmptyInspectorState';
import InspectorHeader from './sections/InspectorHeader';
import ImageSection from './sections/ImageSection';
// TextSection 제거 — 텍스트는 중앙 패널에서 직접 편집
import AIImageSection from './sections/AIImageSection';
import ImageAdjustSection from './sections/ImageAdjustSection';
import ExportSection from './sections/ExportSection';

// 구분선 컴포넌트
const Divider = () => (
  <hr
    style={{
      border: 'none',
      borderTop: '1px solid #eeeeee',
      margin: 0,
    }}
  />
);

const InspectorPanel: React.FC = () => {
  const selectedFrameType = useEditorStore((s) => s.selectedFrameType);
  const frames = useEditorStore((s) => s.frames);

  // 활성 슬롯 키 — 기본값 'main'
  const [activeSlotKey, setActiveSlotKey] = useState('main');

  // selectedFrameType이 바뀌면 첫 번째 슬롯으로 리셋
  useEffect(() => {
    if (!selectedFrameType) return;
    const slots = getFrameSlots(selectedFrameType);
    setActiveSlotKey(slots.length > 0 ? slots[0].key : 'main');
  }, [selectedFrameType]);

  // selectedFrameType에 해당하는 frame과 1-based 인덱스 탐색
  const frameIndex = frames.findIndex((f) => f.frameType === selectedFrameType);
  const frame = frameIndex !== -1 ? frames[frameIndex] : null;

  return (
    <aside
      style={{
        width: '380px',
        flexShrink: 0,
        borderLeft: '1px solid #eeeeee',
        backgroundColor: '#ffffff',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {selectedFrameType === null || frame === null ? (
        <EmptyInspectorState />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* 헤더: 프레임 번호, 이름, 닫기 버튼 */}
          <InspectorHeader frame={frame} frameIndex={frameIndex + 1} />

          {/* 이미지 섹션 — 슬롯 인식 */}
          <ImageSection
            frame={frame}
            activeSlotKey={activeSlotKey}
            onSlotChange={setActiveSlotKey}
          />

          <Divider />

          {/* AI 이미지 통합 섹션 */}
          <div style={{ padding: '16px' }}>
            <AIImageSection
              frameType={selectedFrameType}
              imagePrompt={frame.imagePrompt}
              imageDirection={frame.imageDirection}
              needsProductImage={frame.needsProductImage}
              frame={frame}
              activeSlotKey={activeSlotKey}
            />
          </div>

          <Divider />

          {/* 이미지 조정 섹션 — 슬롯별 조정 */}
          <div style={{ padding: '16px' }}>
            <ImageAdjustSection
              frameType={selectedFrameType}
              activeSlotKey={activeSlotKey}
            />
          </div>

          <Divider />

          {/* 내보내기 섹션 */}
          <div style={{ padding: '16px' }}>
            <ExportSection
              frameType={selectedFrameType}
              frameIndex={frameIndex + 1}
            />
          </div>
        </div>
      )}
    </aside>
  );
};

export default InspectorPanel;
