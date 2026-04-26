'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

export interface PlanProgressCardProps {
  weekNumber: number;
  weekTitle: string;
  weekTargetMan: number;   // 만원
  weekActualMan: number;   // 만원
  daysIntoWeek: number;    // 1..7
  keyMission: string | null;
}

export default function PlanProgressCard({
  weekNumber,
  weekTitle,
  weekTargetMan,
  weekActualMan,
  daysIntoWeek,
  keyMission,
}: PlanProgressCardProps) {
  const progressPct =
    weekTargetMan > 0 ? Math.min(Math.round((weekActualMan / weekTargetMan) * 100), 999) : 0;

  return (
    <section
      aria-label="플랜 진행 카드"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 100,
              backgroundColor: 'rgba(190,0,20,0.08)',
              color: C.accent,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Week {weekNumber}
          </span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
            {weekTitle}
          </h2>
        </div>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 500 }}>
          D+{daysIntoWeek}/7
        </span>
      </div>

      {/* 매출 진행 */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
            fontSize: 12,
          }}
        >
          <span style={{ color: '#71717a' }}>
            매출 목표 <strong style={{ color: C.text }}>{weekTargetMan}만원</strong>
          </span>
          <span style={{ color: progressPct >= 100 ? '#16a34a' : C.accent, fontWeight: 600 }}>
            {progressPct}%
          </span>
        </div>
        <div
          style={{
            height: 10,
            borderRadius: 5,
            backgroundColor: '#f0f0f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(progressPct, 100)}%`,
              backgroundColor: progressPct >= 100 ? '#16a34a' : C.accent,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#a1a1aa' }}>
          현재 {weekActualMan}만원 / {weekTargetMan}만원
        </div>
      </div>

      {/* 핵심 미션 */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          backgroundColor: '#fafafa',
          border: `1px solid ${C.border}`,
        }}
      >
        {keyMission ? (
          <>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4, fontWeight: 600 }}>
              🎯 이번주 핵심 미션
            </div>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{keyMission}</div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
            🎉 이번주 미션 완료
          </div>
        )}
      </div>
    </section>
  );
}
