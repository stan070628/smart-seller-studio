'use client';

/**
 * v2 소싱 스코어 7개 항목 수평 진행 바 표시
 * COSTCO_SCORE_MAX 기준으로 퍼센트 계산
 */

import React from 'react';
import type { CostcoProductRow } from '@/types/costco';
import { COSTCO_SCORE_MAX, COSTCO_SCORE_LABELS } from '@/lib/sourcing/costco-scoring';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileScoreBreakdownProps {
  product: CostcoProductRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 컬럼 매핑
// ─────────────────────────────────────────────────────────────────────────────

const SCORE_DB_MAP: Record<string, keyof CostcoProductRow> = {
  legalIp:   'costco_score_legal',
  priceComp: 'costco_score_price',
  csSafety:  'costco_score_cs',
  margin:    'costco_score_margin',
  demand:    'costco_score_demand',
  turnover:  'costco_score_turnover',
  supply:    'costco_score_supply',
};

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 비율에 따라 막대 색상 반환 */
function getBarColor(ratio: number): string {
  if (ratio >= 0.7) return '#16a34a'; // green
  if (ratio >= 0.4) return '#d97706'; // amber
  return '#dc2626';                   // red
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileScoreBreakdown({ product }: MobileScoreBreakdownProps) {
  // COSTCO_SCORE_MAX 키 순서대로 렌더링
  const keys = Object.keys(COSTCO_SCORE_MAX);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {keys.map((key) => {
        const dbCol = SCORE_DB_MAP[key];
        const rawValue = dbCol ? product[dbCol] : null;
        const value = typeof rawValue === 'number' ? rawValue : null;
        const maxVal = COSTCO_SCORE_MAX[key] ?? 1;
        const label = COSTCO_SCORE_LABELS[key] ?? key;

        const ratio = value !== null ? Math.min(value / maxVal, 1) : 0;
        const barColor = value !== null ? getBarColor(ratio) : '#e5e7eb';
        const barWidth = value !== null ? `${Math.round(ratio * 100)}%` : '0%';

        return (
          <div key={key}>
            {/* 레이블 + 수치 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  color: '#374151',
                  fontWeight: 500,
                  minWidth: '72px',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: value !== null ? '#1a1c1c' : '#9ca3af',
                  fontWeight: 600,
                  minWidth: '48px',
                  textAlign: 'right',
                }}
              >
                {value !== null ? `${value} / ${maxVal}` : '—'}
              </span>
            </div>

            {/* 진행 바 */}
            <div
              style={{
                width: '100%',
                height: '6px',
                backgroundColor: '#e5e7eb',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: barWidth,
                  height: '100%',
                  backgroundColor: barColor,
                  borderRadius: '3px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
