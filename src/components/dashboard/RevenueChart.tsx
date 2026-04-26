'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

interface RevenueChartProps {
  weeks: number[];
  target: number[];                  // 누적 목표 (만원)
  actual: (number | null)[];         // 누적 실제 (만원, null = 미래)
  currentWeek: number;               // 1..12
}

const W = 720;       // 뷰박스 폭
const H = 240;       // 뷰박스 높이
const PAD_L = 36;    // 좌측 여백 (Y축 라벨)
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;    // 하단 여백 (X축 라벨)

export default function RevenueChart({ weeks, target, actual, currentWeek }: RevenueChartProps) {
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const yMax = 1000; // 만원 — 12주 최종 목표
  const x = (idx: number) => PAD_L + (innerW * idx) / (weeks.length - 1);
  const y = (val: number) => PAD_T + innerH - (innerH * val) / yMax;

  // path 생성 — null 값은 path에서 끊김
  const targetPath = target.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');

  let actualPath = '';
  let started = false;
  for (let i = 0; i < actual.length; i++) {
    const v = actual[i];
    if (v == null) continue;
    actualPath += `${started ? ' L' : 'M'} ${x(i)} ${y(v)}`;
    started = true;
  }

  // 현재 주차 표시 점
  const currentIdx = Math.min(Math.max(currentWeek - 1, 0), weeks.length - 1);
  const currentVal = actual[currentIdx];

  return (
    <section
      aria-label="12주 매출 차트"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.text }}>
        12주 누적 매출 추세
      </h2>

      <svg
        role="img"
        aria-label="매출 추세 차트"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto', maxHeight: H * 1.5 }}
      >
        {/* Y축 grid + 라벨 */}
        {[0, 250, 500, 750, 1000].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(v)}
              y2={y(v)}
              stroke="#f0f0f0"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 4}
              fontSize={10}
              fill="#a1a1aa"
              textAnchor="end"
            >
              {v}
            </text>
          </g>
        ))}

        {/* 목표 라인 (점선) */}
        <path d={targetPath} fill="none" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 4" />

        {/* 실제 라인 (실선, accent) */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {/* 현재 주차 점 */}
        {currentVal != null && (
          <circle cx={x(currentIdx)} cy={y(currentVal)} r={4} fill={C.accent} />
        )}

        {/* X축 라벨 */}
        {weeks.map((w, i) => (
          <text
            key={w}
            x={x(i)}
            y={H - 8}
            fontSize={10}
            fill="#a1a1aa"
            textAnchor="middle"
          >
            W{w}
          </text>
        ))}
      </svg>

      {/* 범례 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: '#71717a' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 14, height: 0, borderTop: '1.5px dashed #a1a1aa' }} /> 목표
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 14, height: 0, borderTop: `2.5px solid ${C.accent}` }} /> 실제
        </span>
        <span style={{ marginLeft: 'auto', color: '#a1a1aa' }}>단위: 만원</span>
      </div>
    </section>
  );
}
