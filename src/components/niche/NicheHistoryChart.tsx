'use client';

/**
 * NicheHistoryChart.tsx
 * 니치점수 변동 추이 라인 차트 — SVG 직접 구현
 *
 * 마운트 시 useNicheStore.fetchHistory를 호출하여 최근 30일 이력을 렌더링
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNicheStore } from '@/store/useNicheStore';
import type { NicheScoreSnapshot } from '@/types/niche';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheHistoryChartProps {
  keyword: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────
const CHART_HEIGHT    = 200;   // SVG 전체 높이 (px)
const PADDING_TOP     = 16;
const PADDING_BOTTOM  = 32;    // X축 레이블 공간
const PADDING_LEFT    = 36;    // Y축 레이블 공간
const PADDING_RIGHT   = 12;

const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

const Y_MIN   = 0;
const Y_MAX   = 100;
const Y_STEPS = [0, 20, 40, 60, 80, 100]; // 그리드 라인

const ACCENT       = '#be0014';
const GRID_COLOR   = '#f0f0f0';
const AXIS_COLOR   = '#e5e7eb';
const LABEL_COLOR  = '#9ca3af';
const DOT_FILL     = '#be0014';

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 포맷 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
function toMMDD(dateStr: string): string {
  // snapshotDate: "YYYY-MM-DD" 또는 ISO 형식
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 변환
// ─────────────────────────────────────────────────────────────────────────────
function toChartX(index: number, total: number, plotWidth: number): number {
  if (total <= 1) return PADDING_LEFT + plotWidth / 2;
  return PADDING_LEFT + (index / (total - 1)) * plotWidth;
}

function toChartY(score: number): number {
  const ratio = (score - Y_MIN) / (Y_MAX - Y_MIN);
  return PADDING_TOP + PLOT_HEIGHT * (1 - ratio);
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheHistoryChart({ keyword }: NicheHistoryChartProps) {
  const { history, isHistoryLoading, fetchHistory } = useNicheStore();

  // 컨테이너 실제 너비를 측정하여 SVG 너비를 결정
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setSvgWidth(w);
    });
    ro.observe(el);

    // 초기값 직접 반영
    setSvgWidth(el.clientWidth || 480);

    return () => ro.disconnect();
  }, []);

  // 마운트 시 이력 조회
  useEffect(() => {
    if (keyword) {
      fetchHistory(keyword);
    }
  }, [keyword, fetchHistory]);

  // ── 렌더링 분기 ────────────────────────────────────────────────────────────
  if (isHistoryLoading) {
    return (
      <div
        ref={containerRef}
        style={{
          height: `${CHART_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: '13px', color: LABEL_COLOR }}>이력 로드 중…</span>
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          height: `${CHART_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: LABEL_COLOR,
          fontSize: '13px',
        }}
      >
        아직 이력이 없습니다
      </div>
    );
  }

  // ── 차트 계산 ──────────────────────────────────────────────────────────────
  const plotWidth  = svgWidth - PADDING_LEFT - PADDING_RIGHT;
  const total      = history.length;

  // X축 레이블: 7일 간격으로 표시
  const labelIndices: number[] = [];
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || i % 7 === 0) {
      labelIndices.push(i);
    }
  }

  // 라인 패스 생성
  const pathD = history
    .map((snap: NicheScoreSnapshot, i: number) => {
      const x = toChartX(i, total, plotWidth).toFixed(2);
      const y = toChartY(snap.totalScore).toFixed(2);
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
    .join(' ');

  // 영역 채우기 패스
  const firstX = toChartX(0, total, plotWidth).toFixed(2);
  const lastX  = toChartX(total - 1, total, plotWidth).toFixed(2);
  const baseY  = toChartY(Y_MIN).toFixed(2);
  const areaD  = `${pathD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        width={svgWidth}
        height={CHART_HEIGHT}
        style={{ display: 'block', overflow: 'visible' }}
        aria-label="점수 변동 추이 차트"
      >
        {/* ── Y축 그리드 라인 + 레이블 ────────────────────────────────────── */}
        {Y_STEPS.map((yVal) => {
          const y = toChartY(yVal).toFixed(2);
          return (
            <g key={`grid-y-${yVal}`}>
              <line
                x1={PADDING_LEFT}
                y1={y}
                x2={PADDING_LEFT + plotWidth}
                y2={y}
                stroke={yVal === 0 ? AXIS_COLOR : GRID_COLOR}
                strokeWidth={yVal === 0 ? 1.5 : 1}
              />
              <text
                x={PADDING_LEFT - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                style={{ fontSize: '10px', fill: LABEL_COLOR, fontFamily: 'monospace' }}
              >
                {yVal}
              </text>
            </g>
          );
        })}

        {/* ── 영역 그라데이션 채우기 ───────────────────────────────────────── */}
        <defs>
          <linearGradient id="history-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={ACCENT} stopOpacity={0.18} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#history-area-grad)" />

        {/* ── 라인 ─────────────────────────────────────────────────────────── */}
        <path
          d={pathD}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* ── 포인트 도트 ───────────────────────────────────────────────────── */}
        {history.map((snap: NicheScoreSnapshot, i: number) => {
          const x = toChartX(i, total, plotWidth);
          const y = toChartY(snap.totalScore);
          return (
            <circle
              key={`dot-${i}`}
              cx={x.toFixed(2)}
              cy={y.toFixed(2)}
              r={total <= 10 ? 3.5 : 2.5}
              fill={DOT_FILL}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          );
        })}

        {/* ── X축 날짜 레이블 ───────────────────────────────────────────────── */}
        {labelIndices.map((idx) => {
          const snap = history[idx];
          const x    = toChartX(idx, total, plotWidth);
          const y    = PADDING_TOP + PLOT_HEIGHT + 18;
          return (
            <text
              key={`xlabel-${idx}`}
              x={x.toFixed(2)}
              y={y.toFixed(2)}
              textAnchor="middle"
              style={{ fontSize: '10px', fill: LABEL_COLOR, fontFamily: 'monospace' }}
            >
              {toMMDD(snap.snapshotDate)}
            </text>
          );
        })}

        {/* ── X축 기준선 ───────────────────────────────────────────────────── */}
        <line
          x1={PADDING_LEFT}
          y1={toChartY(Y_MIN).toFixed(2)}
          x2={PADDING_LEFT + plotWidth}
          y2={toChartY(Y_MIN).toFixed(2)}
          stroke={AXIS_COLOR}
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
