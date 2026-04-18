'use client';

/**
 * Badge.tsx
 * 공통 뱃지 컴포넌트 — variant별 색상을 인라인 style로 적용 (기존 컴포넌트 패턴과 일관성 유지)
 */

import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  /** 뱃지 색상 테마 */
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'purple';
  /** 뱃지 크기 */
  size?: 'sm' | 'md';
}

// variant별 색상 정의
const VARIANT_STYLES: Record<
  NonNullable<BadgeProps['variant']>,
  { color: string; backgroundColor: string; border: string }
> = {
  default: {
    color:           '#1a1c1c',
    backgroundColor: '#f3f3f3',
    border:          '1px solid #eeeeee',
  },
  accent: {
    color:           '#ffffff',
    backgroundColor: '#be0014',
    border:          '1px solid #be0014',
  },
  success: {
    color:           '#16a34a',
    backgroundColor: '#f0fdf4',
    border:          '1px solid #bbf7d0',
  },
  warning: {
    color:           '#d97706',
    backgroundColor: '#fffbeb',
    border:          '1px solid #fde68a',
  },
  danger: {
    color:           '#dc2626',
    backgroundColor: '#fef2f2',
    border:          '1px solid #fecaca',
  },
  purple: {
    color:           '#7c3aed',
    backgroundColor: '#f5f3ff',
    border:          '1px solid #ddd6fe',
  },
};

// size별 패딩/폰트 정의
const SIZE_STYLES: Record<NonNullable<BadgeProps['size']>, React.CSSProperties> = {
  sm: {
    padding:    '2px 8px',
    fontSize:   '11px',
    fontWeight: 600,
    lineHeight: '1.6',
  },
  md: {
    padding:    '4px 10px',
    fontSize:   '12px',
    fontWeight: 600,
    lineHeight: '1.6',
  },
};

export function Badge({ children, variant = 'default', size = 'sm' }: BadgeProps) {
  const variantStyle = VARIANT_STYLES[variant];
  const sizeStyle    = SIZE_STYLES[size];

  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        borderRadius: '4px',
        whiteSpace:   'nowrap',
        ...variantStyle,
        ...sizeStyle,
      }}
    >
      {children}
    </span>
  );
}
