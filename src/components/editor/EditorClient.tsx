'use client';

/**
 * EditorClient.tsx
 * 에디터 전체 레이아웃을 담당하는 Client Component
 *
 * FrameGrid의 ref를 DownloadAllButton에 연결하기 위해
 * 두 컴포넌트의 공통 부모로서 ref를 관리한다.
 */

import React, { useRef } from 'react';
import Sidebar from './Sidebar';
import FrameGrid from './FrameGrid';
import DownloadAllButton from './DownloadAllButton';
import type { FrameGridHandle } from './FrameGrid';
import ReferenceLearnButton from './ReferenceLearnButton';
import InspectorPanel from './inspector/InspectorPanel';
import { TemplateRefProvider } from './inspector/TemplateRefContext';

const EditorClient: React.FC = () => {
  // FrameGrid의 핸들 (activeFrames + getTemplateNode)
  const frameGridRef = useRef<FrameGridHandle>(null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        backgroundColor: '#f9f9f9',
      }}
    >
      {/* ── 툴바 ── */}
      <div
        style={{
          flexShrink: 0,
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 20px',
          borderBottom: '1px solid #eeeeee',
          backgroundColor: '#ffffff',
          gap: '10px',
        }}
      >
        <DownloadAllButton frameGridRef={frameGridRef} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 본문: Sidebar + FrameGrid + InspectorPanel                        */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* 좌측 사이드바 */}
        <Sidebar />

        {/* 가운데 + 오른쪽: TemplateRefProvider로 공유 컨텍스트 제공 */}
        <TemplateRefProvider>
          {/* 가운데: 메인 프레임 그리드 (스크롤 가능) */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              backgroundColor: '#f9f9f9',
            }}
          >
            <FrameGrid ref={frameGridRef} />
          </main>

          {/* 오른쪽: 인스펙터 패널 */}
          <InspectorPanel />
        </TemplateRefProvider>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 레퍼런스 학습 플로팅 버튼                                           */}
      {/* ------------------------------------------------------------------ */}
      <ReferenceLearnButton />
    </div>
  );
};

export default EditorClient;
