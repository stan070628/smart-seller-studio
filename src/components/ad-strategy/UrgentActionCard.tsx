'use client';

import React from 'react';
import type { UrgentAction, UrgentActionType } from '@/lib/ad-strategy/types';

const TYPE_LABEL: Record<UrgentActionType, string> = {
  IMAGE_FIX: '이미지 수정',
  BUDGET_INCREASE: '예산 증액',
  CAMPAIGN_EXTEND: '캠페인 연장',
  RESTOCK: '긴급 재입고',
  CAMPAIGN_CREATE: '신규 캠페인',
};

const TYPE_COLOR: Record<UrgentActionType, string> = {
  IMAGE_FIX: '#dc2626',
  BUDGET_INCREASE: '#2563eb',
  CAMPAIGN_EXTEND: '#d97706',
  RESTOCK: '#7c3aed',
  CAMPAIGN_CREATE: '#059669',
};

export default function UrgentActionCard({ action }: { action: UrgentAction }) {
  const color = TYPE_COLOR[action.type] ?? '#6b7280';
  return (
    <div
      style={{
        border: `1px solid ${color}33`,
        borderLeft: `4px solid ${color}`,
        borderRadius: '8px',
        padding: '14px 16px',
        background: '#fff',
        minWidth: '220px',
        flex: '1 1 220px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color,
            background: `${color}18`,
            padding: '2px 8px',
            borderRadius: '4px',
          }}
        >
          {TYPE_LABEL[action.type]}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111' }}>{action.product}</span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#6b7280' }}>{action.reason}</p>
      <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#374151', fontWeight: 500 }}>
        {action.action}
      </p>
      {action.deepLink && (
        <a
          href={action.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '12px',
            color,
            textDecoration: 'none',
            border: `1px solid ${color}44`,
            borderRadius: '4px',
            padding: '4px 10px',
          }}
        >
          바로가기 →
        </a>
      )}
    </div>
  );
}
