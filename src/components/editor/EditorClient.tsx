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

const EditorClient: React.FC = () => {
  // FrameGrid의 핸들 (activeFrames + getTemplateNode)
  const frameGridRef = useRef<FrameGridHandle>(null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: '#09090b',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* 헤더                                                                */}
      {/* ------------------------------------------------------------------ */}
      <header
        style={{
          flexShrink: 0,
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid #27272a',
          backgroundColor: '#18181b',
          zIndex: 50,
        }}
      >
        {/* 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              fontSize: '16px',
              fontWeight: '700',
              letterSpacing: '-0.3px',
              color: '#ffffff',
            }}
          >
            Smart
            <span style={{ color: '#818cf8' }}>Seller</span>
            Studio
          </span>
          <span
            style={{
              backgroundColor: 'rgba(79, 70, 229, 0.25)',
              color: '#a5b4fc',
              fontSize: '11px',
              fontWeight: '600',
              padding: '2px 9px',
              borderRadius: '100px',
              border: '1px solid rgba(99, 102, 241, 0.3)',
            }}
          >
            Beta
          </span>
        </div>

        {/* 우측 버튼 영역 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <DownloadAllButton frameGridRef={frameGridRef} />
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* 본문: Sidebar + FrameGrid                                          */}
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

        {/* 메인 프레임 그리드 (스크롤 가능) */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            backgroundColor: '#09090b',
          }}
        >
          <FrameGrid ref={frameGridRef} />
        </main>
      </div>
    </div>
  );
};

export default EditorClient;
