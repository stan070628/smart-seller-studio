'use client';

import React from 'react';

/** 판매 수량이 입고 수량을 초과해 FIFO 계산이 불가능한 상품 경고 배지. */
export function OverstockBadge() {
  return (
    <span
      title="판매 수량이 입고 수량을 초과했습니다"
      style={{
        fontSize: 11,
        background: '#dc2626',
        color: '#fff',
        padding: '2px 6px',
        borderRadius: 20,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ 재고초과
    </span>
  );
}
