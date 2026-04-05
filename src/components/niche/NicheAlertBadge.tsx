'use client';

/**
 * NicheAlertBadge.tsx
 * 니치소싱 탭 라벨 옆에 표시되는 읽지 않은 알림 수 배지
 */

import React from 'react';

interface NicheAlertBadgeProps {
  count: number;
}

export default function NicheAlertBadge({ count }: NicheAlertBadgeProps) {
  // count가 0이면 렌더링하지 않음
  if (count <= 0) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: '#be0014',
        color: '#ffffff',
        fontSize: '10px',
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
