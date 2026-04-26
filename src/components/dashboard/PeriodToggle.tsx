'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';
import { type Period, PERIOD_LABELS } from '@/lib/dashboard/types';

const ORDER: Period[] = ['today', '7d', '30d', 'month'];

interface PeriodToggleProps {
  value: Period;
  onChange: (period: Period) => void;
}

export default function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="기간 선택"
      style={{
        display: 'inline-flex',
        gap: 0,
        padding: 3,
        borderRadius: 8,
        backgroundColor: '#f0f0f0',
      }}
    >
      {ORDER.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: active ? C.card : 'transparent',
              color: active ? C.text : '#71717a',
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              transition: 'background-color 0.15s',
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
