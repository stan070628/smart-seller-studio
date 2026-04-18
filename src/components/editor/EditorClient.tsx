'use client';

/**
 * EditorClient.tsx
 * 에디터 전체 레이아웃을 담당하는 Client Component
 *
 * FrameGrid의 ref를 DownloadAllButton에 연결하기 위해
 * 두 컴포넌트의 공통 부모로서 ref를 관리한다.
 */

import React, { useRef } from 'react';
import Link from 'next/link';
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
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: '#f9f9f9',
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
          borderBottom: '1px solid #eeeeee',
          backgroundColor: '#ffffff',
          zIndex: 50,
        }}
      >
        {/* 로고 + 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '16px',
                fontWeight: '700',
                letterSpacing: '-0.3px',
                color: '#1a1c1c',
              }}
            >
              Smart
              <span style={{ color: '#be0014' }}>Seller</span>
              Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190, 0, 20, 0.08)',
                color: '#be0014',
                fontSize: '11px',
                fontWeight: '600',
                padding: '2px 9px',
                borderRadius: '100px',
                border: '1px solid rgba(190, 0, 20, 0.2)',
              }}
            >
              Beta
            </span>
          </div>

          {/* 네비게이션 탭 */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { href: '/dashboard', label: '대시보드' },
              { href: '/sourcing', label: '소싱' },
              { href: '/editor', label: '에디터', active: true },
              { href: '/detail', label: '상세페이지' },
              { href: '/listing', label: '상품등록' },
              { href: '/orders', label: '주문/매출' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: item.active ? '600' : '500',
                  color: item.active ? '#be0014' : '#71717a',
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190, 0, 20, 0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190, 0, 20, 0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 우측 버튼 영역 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <DownloadAllButton frameGridRef={frameGridRef} />
        </div>
      </header>

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
