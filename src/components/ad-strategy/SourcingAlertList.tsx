'use client';

import React from 'react';
import type { SourcingAlert } from '@/lib/ad-strategy/types';

const ISSUE_LABEL: Record<SourcingAlert['issue'], string> = {
  LOW_STOCK: '재고 부족',
  NO_WINNER: '위너 없음',
  CAMPAIGN_ENDING: '캠페인 종료 임박',
  ZERO_SALES_30D: '30일 무판매',
};

export default function SourcingAlertList({ alerts }: { alerts: SourcingAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>소싱 경보 없음</p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {alerts.map((a, i) => (
        <div
          key={a.product + i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '10px 14px',
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#b45309',
              background: '#fef3c7',
              padding: '2px 8px',
              borderRadius: '4px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {ISSUE_LABEL[a.issue]}
          </span>
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: '13px', color: '#111' }}>
              {a.product}
            </p>
            <p style={{ margin: '0 0 2px', fontSize: '12px', color: '#6b7280' }}>{a.detail}</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#374151' }}>{a.action}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
