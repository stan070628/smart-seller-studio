'use client';

/**
 * NicheRadarChart.tsx
 * 7요소 레이더 차트 — SVG 직접 구현, 외부 라이브러리 없음
 *
 * 각 축은 해당 항목의 만점 대비 비율(0~1)로 정규화되어 그려짐
 */

import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheRadarChartProps {
  breakdown: {
    rocketNonEntry: number;       // 만점 30
    competitionLevel: number;     // 만점 20
    sellerDiversity: number;      // 만점 15
    monopolyLevel: number;        // 만점 10
    brandRatio: number;           // 만점 10
    priceMarginViability: number; // 만점 10
    domesticRarity: number;       // 만점 5
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 축 메타 (순서 = 레이더 꼭짓점 순서)
// ─────────────────────────────────────────────────────────────────────────────
const AXES: { key: keyof NicheRadarChartProps['breakdown']; label: string; max: number }[] = [
  { key: 'rocketNonEntry',       label: '로켓비진출', max: 30 },
  { key: 'competitionLevel',     label: '경쟁도',     max: 20 },
  { key: 'sellerDiversity',      label: '판매자',     max: 15 },
  { key: 'monopolyLevel',        label: '독점도',     max: 10 },
  { key: 'brandRatio',           label: '브랜드',     max: 10 },
  { key: 'priceMarginViability', label: '마진',       max: 10 },
  { key: 'domesticRarity',       label: '희소성',     max: 5  },
];

// SVG 설정
const SVG_SIZE = 280;
const CX = 140;       // 중심 X
const CY = 140;       // 중심 Y
const RADIUS = 100;   // 최대 반지름
const N = AXES.length;

// 색상
const ACCENT     = 'rgba(190, 0, 20, 0.8)';
const ACCENT_BG  = 'rgba(190, 0, 20, 0.15)';
const GRID_COLOR = '#e5e7eb';
const AXIS_COLOR = '#d1d5db';
const LABEL_COLOR = '#6b7280';
const DOT_COLOR  = '#be0014';

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 계산 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * i번째 꼭짓점의 각도를 반환 (12시 방향 = -90도 기준)
 */
function getAngle(i: number): number {
  return (Math.PI * 2 * i) / N - Math.PI / 2;
}

/**
 * 정규화 비율(ratio)에 따라 i번째 축 위의 좌표를 반환
 */
function getPoint(i: number, ratio: number): { x: number; y: number } {
  const angle = getAngle(i);
  return {
    x: CX + RADIUS * ratio * Math.cos(angle),
    y: CY + RADIUS * ratio * Math.sin(angle),
  };
}

/**
 * 점 배열을 SVG polygon points 문자열로 변환
 */
function toPolyPoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

/**
 * 레이블 위치 보정 — 축 바깥으로 조금 더 밀어냄
 */
function getLabelOffset(angle: number): { dx: number; dy: number } {
  const MARGIN = 18;
  const dx = Math.cos(angle) * MARGIN;
  const dy = Math.sin(angle) * MARGIN;
  return { dx, dy };
}

/**
 * SVG text-anchor 결정
 */
function getTextAnchor(angle: number): 'middle' | 'start' | 'end' {
  const cos = Math.cos(angle);
  if (cos > 0.3) return 'start';
  if (cos < -0.3) return 'end';
  return 'middle';
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheRadarChart({ breakdown }: NicheRadarChartProps) {
  // 각 축의 정규화 비율 계산
  const ratios = AXES.map((axis) => {
    const raw = breakdown[axis.key] ?? 0;
    return Math.min(1, Math.max(0, raw / axis.max));
  });

  // 데이터 폴리곤 꼭짓점
  const dataPoints = ratios.map((ratio, i) => getPoint(i, ratio));

  // 그리드 동심 다각형 (3단계)
  const gridLevels = [0.33, 0.66, 1.0];

  // 각 축 끝점 (꼭짓점 외곽)
  const axisEndPoints = AXES.map((_, i) => getPoint(i, 1.0));

  return (
    <svg
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      width={SVG_SIZE}
      height={SVG_SIZE}
      style={{ display: 'block', overflow: 'visible' }}
      aria-label="레이더 차트"
    >
      {/* ── 그리드: 동심 다각형 3단계 ──────────────────────────────────────── */}
      {gridLevels.map((level, li) => {
        const pts = AXES.map((_, i) => getPoint(i, level));
        return (
          <polygon
            key={`grid-${li}`}
            points={toPolyPoints(pts)}
            fill="none"
            stroke={GRID_COLOR}
            strokeWidth={1}
          />
        );
      })}

      {/* ── 축 선 (중심 → 꼭짓점) ──────────────────────────────────────────── */}
      {axisEndPoints.map((pt, i) => (
        <line
          key={`axis-${i}`}
          x1={CX}
          y1={CY}
          x2={pt.x.toFixed(2)}
          y2={pt.y.toFixed(2)}
          stroke={AXIS_COLOR}
          strokeWidth={1}
        />
      ))}

      {/* ── 데이터 다각형 ────────────────────────────────────────────────────── */}
      <polygon
        points={toPolyPoints(dataPoints)}
        fill={ACCENT_BG}
        stroke={ACCENT}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* ── 꼭짓점 도트 ──────────────────────────────────────────────────────── */}
      {dataPoints.map((pt, i) => (
        <circle
          key={`dot-${i}`}
          cx={pt.x.toFixed(2)}
          cy={pt.y.toFixed(2)}
          r={4}
          fill={DOT_COLOR}
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      ))}

      {/* ── 축 레이블 ────────────────────────────────────────────────────────── */}
      {AXES.map((axis, i) => {
        const angle = getAngle(i);
        const outerPt = getPoint(i, 1.0);
        const { dx, dy } = getLabelOffset(angle);
        const labelX = outerPt.x + dx;
        const labelY = outerPt.y + dy;
        const anchor = getTextAnchor(angle);

        return (
          <text
            key={`label-${i}`}
            x={labelX.toFixed(2)}
            y={labelY.toFixed(2)}
            textAnchor={anchor}
            dominantBaseline="central"
            style={{
              fontSize: '10px',
              fill: LABEL_COLOR,
              fontWeight: 500,
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            {axis.label}
            {/* 만점 표시 (작은 글씨) */}
            <tspan
              style={{ fontSize: '9px', fill: '#9ca3af' }}
            >
              ({axis.max})
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
