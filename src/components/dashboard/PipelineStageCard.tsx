'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

interface PipelineStageCardProps {
  label: string;
  count: number;
  amount: number;
  /** 정산완료 stage에서만 사용. false면 "API 미연동" 배지 표시 */
  available?: boolean;
  /** stage 강조색 (좌→우 그라데이션) */
  color: string;
}

export default function PipelineStageCard({
  label, count, amount, available = true, color,
}: PipelineStageCardProps) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 92,
        padding: '12px 10px',
        borderRadius: 10,
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderTop: `3px solid ${color}`,
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </div>
      {available ? (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
            {count.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2 }}>
            {amount > 0 ? `${Math.round(amount / 10000).toLocaleString()}만원` : '—'}
          </div>
        </>
      ) : (
        <div
          style={{
            fontSize: 10,
            color: '#a1a1aa',
            padding: '8px 0',
            fontStyle: 'italic',
          }}
        >
          API 미연동
        </div>
      )}
    </div>
  );
}
