/**
 * 모바일 전용 루트 레이아웃
 * 최대 480px, pinch-zoom 방지, 배경 #f4f4f4
 */
import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: '코스트코 소싱',
};

// viewport는 Next.js 13.4+ 에서 별도 export로 분리
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        maxWidth: '480px',
        margin: '0 auto',
        minHeight: '100dvh',
        backgroundColor: '#f4f4f4',
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}
