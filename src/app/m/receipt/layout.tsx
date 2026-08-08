/**
 * 영수증 모바일 레이아웃 — 상단 고정 헤더 52px
 * src/app/m/costco/layout.tsx와 같은 구조다
 */
import React from 'react';

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f4f4f4' }}>
      <header
        style={{
          position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '480px', height: '52px',
          backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', padding: '0 16px',
          zIndex: 100, boxSizing: 'border-box',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#1a1c1c', letterSpacing: '-0.3px' }}>
          영수증 입고
        </span>
      </header>
      <main style={{ paddingTop: '52px' }}>{children}</main>
    </div>
  );
}
