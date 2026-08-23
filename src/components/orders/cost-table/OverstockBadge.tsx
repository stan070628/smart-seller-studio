'use client';

import React from 'react';
import { E } from '@/lib/design-tokens';

/** 판매 수량이 입고 수량을 초과해 FIFO 계산이 불가능한 상품 경고 배지. */
export function OverstockBadge() {
  return (
    <span
      title="판매 수량이 입고 수량을 초과했습니다"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        padding: '1px 4px',
        border: `1px solid ${E.loss}`,
        color: E.loss,
        background: 'transparent',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      재고초과
    </span>
  );
}
