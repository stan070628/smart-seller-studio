/**
 * 코스트코 모바일 전용 레이아웃
 * 상단 고정 헤더(52px) + children 렌더링
 */
import React from 'react';

export default function MobileCostcoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f4f4f4' }}>
      {/* 상단 고정 헤더 */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '480px',
          height: '52px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 100,
          boxSizing: 'border-box',
        }}
      >
        {/* 좌: 페이지 타이틀 */}
        <span
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#1a1c1c',
            letterSpacing: '-0.3px',
          }}
        >
          코스트코 소싱
        </span>

        {/* 우: 마지막 수집 시각 — 클라이언트에서 채울 예정 */}
        <span
          style={{
            fontSize: '12px',
            color: '#6b7280',
          }}
        >
          마지막 수집: —
        </span>
      </header>

      {/* 헤더 높이만큼 상단 패딩 */}
      <main style={{ paddingTop: '52px' }}>{children}</main>
    </div>
  );
}
