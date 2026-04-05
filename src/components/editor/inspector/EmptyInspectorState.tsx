'use client';

/**
 * EmptyInspectorState.tsx
 * 선택된 프레임이 없을 때 인스펙터 패널에 표시되는 안내 상태
 */

import { MousePointerClick } from 'lucide-react';

const EmptyInspectorState: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <MousePointerClick
        size={32}
        style={{ color: '#926f6b', flexShrink: 0 }}
      />
      <p
        style={{
          fontSize: '13px',
          lineHeight: '1.6',
          color: '#926f6b',
          margin: 0,
        }}
      >
        왼쪽에서 프레임을 클릭하여
        <br />
        편집하세요
      </p>
    </div>
  );
};

export default EmptyInspectorState;
