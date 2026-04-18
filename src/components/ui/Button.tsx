'use client';

/**
 * Button.tsx
 * 공통 버튼 컴포넌트 — loading 시 Loader2 아이콘 표시, disabled + loading 처리
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 버튼 색상 테마 */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** 버튼 크기 */
  size?: 'sm' | 'md' | 'lg';
  /** 로딩 상태 — true 시 Loader2 스피너 표시 및 비활성화 */
  loading?: boolean;
}

// variant별 색상 정의 (인라인 style 방식, 기존 컴포넌트 패턴 준수)
const VARIANT_STYLES: Record<
  NonNullable<ButtonProps['variant']>,
  React.CSSProperties
> = {
  primary: {
    backgroundColor: '#be0014',
    color:           '#ffffff',
    border:          '1px solid #be0014',
  },
  secondary: {
    backgroundColor: '#f3f3f3',
    color:           '#1a1c1c',
    border:          '1px solid #eeeeee',
  },
  ghost: {
    backgroundColor: 'transparent',
    color:           '#1a1c1c',
    border:          '1px solid transparent',
  },
  danger: {
    backgroundColor: '#fef2f2',
    color:           '#dc2626',
    border:          '1px solid #fecaca',
  },
};

// size별 패딩/폰트 정의
const SIZE_STYLES: Record<NonNullable<ButtonProps['size']>, React.CSSProperties> = {
  sm: {
    padding:    '5px 12px',
    fontSize:   '12px',
    fontWeight: 600,
    gap:        '4px',
  },
  md: {
    padding:    '8px 16px',
    fontSize:   '13px',
    fontWeight: 600,
    gap:        '6px',
  },
  lg: {
    padding:    '11px 20px',
    fontSize:   '14px',
    fontWeight: 600,
    gap:        '8px',
  },
};

export function Button({
  variant  = 'primary',
  size     = 'md',
  loading  = false,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        borderRadius:   '6px',
        cursor:         isDisabled ? 'not-allowed' : 'pointer',
        opacity:        isDisabled ? 0.6 : 1,
        transition:     'opacity 0.15s, background-color 0.15s',
        lineHeight:     '1',
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        // 호출부에서 style prop으로 추가 오버라이드 가능
        ...style,
      }}
      {...props}
    >
      {/* 로딩 스피너 */}
      {loading && (
        <Loader2
          size={size === 'sm' ? 12 : size === 'lg' ? 16 : 14}
          style={{ animation: 'spin 1s linear infinite' }}
        />
      )}
      {children}
    </button>
  );
}
