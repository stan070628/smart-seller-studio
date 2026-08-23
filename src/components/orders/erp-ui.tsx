'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { E } from '@/lib/design-tokens';

/**
 * 주문/매출 탭들이 공유하는 ERP 격자 규격.
 *
 * 수익·원가와 정산이 같은 화면처럼 보여야 해서 값을 한 곳에 모았다 —
 * 탭마다 따로 두면 한쪽 행 높이만 바뀌어도 두 탭이 어긋난다.
 * 라운드 없음, 1px 실선, 행 높이 27px, 숫자는 tabular-nums.
 */

// ─── 조회조건 패널 ─────────────────────────────────────────────────────────

export const qFieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  borderRight: `1px solid ${E.lineSoft}`,
  borderBottom: `1px solid ${E.lineSoft}`,
};

export const qLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 10px',
  minWidth: 74,
  background: E.chrome,
  fontSize: 11.5,
  fontWeight: 600,
  color: E.inkSub,
  borderRight: `1px solid ${E.lineSoft}`,
  whiteSpace: 'nowrap',
};

export const qValStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  background: E.surface,
  fontSize: 12,
  flexWrap: 'wrap',
};

export const qTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 12px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.06em',
  color: E.inkSub,
  borderBottom: `1px solid ${E.lineSoft}`,
};

/** 조회조건 패널 바깥 테두리 */
export const queryPanelStyle: React.CSSProperties = {
  border: `1px solid ${E.line}`,
  background: E.chrome2,
  marginBottom: 10,
};

// ─── 컨트롤 ────────────────────────────────────────────────────────────────

export const segStyle: React.CSSProperties = {
  display: 'flex',
  border: `1px solid ${E.line}`,
};

export const segBtnStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11.5,
  padding: '2px 9px',
  height: 24,
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const inputStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  color: E.ink,
  background: E.surface,
  border: `1px solid ${E.line}`,
  padding: '2px 6px',
  height: 24,
  boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: E.ctrlH,
  padding: '0 11px',
  font: 'inherit',
  fontSize: 11.5,
  fontWeight: 500,
  color: E.ink,
  background: E.surface,
  border: `1px solid ${E.line}`,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** 주 동작 버튼 — 액센트를 채운다. 한 화면에 하나만 둔다. */
export const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: E.accent,
  borderColor: E.accent,
  color: '#fff',
  fontWeight: 600,
};

/** 비활성 버튼 — 눌리지 않는다는 것이 색으로 보여야 한다. */
export const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#c9d1d6',
  borderColor: '#c9d1d6',
  color: '#6b7780',
  cursor: 'not-allowed',
};

export const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: E.line,
  margin: '0 3px',
};

// ─── 그리드 ────────────────────────────────────────────────────────────────

/** 표 위의 구분 띠 — 무엇을 집계한 표인지 밝힌다 */
export const bandStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 12px',
  background: E.chrome,
  borderBottom: `1px solid ${E.line}`,
  fontSize: 11,
  fontWeight: 600,
  color: E.inkSub,
};

export const thStyle: React.CSSProperties = {
  background: E.chrome,
  borderBottom: `1px solid ${E.line}`,
  borderRight: `1px solid ${E.lineSoft}`,
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 600,
  color: E.inkSub,
  whiteSpace: 'nowrap',
  textAlign: 'center',
};

/** 숫자 셀 — 우측 정렬 + 자릿수 고정 */
export const numTdStyle: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`,
  borderRight: `1px solid ${E.lineSoft}`,
  padding: '4px 8px',
  textAlign: 'right',
  fontSize: 12,
  color: E.ink,
  whiteSpace: 'nowrap',
  fontFamily: E.mono,
  fontVariantNumeric: 'tabular-nums',
};

/** 상태바의 강조 숫자 */
export const statNumStyle: React.CSSProperties = {
  fontFamily: E.mono,
  fontVariantNumeric: 'tabular-nums',
  color: E.ink,
  fontWeight: 600,
};

export const statusBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  padding: '5px 12px',
  background: E.chrome,
  border: `1px solid ${E.line}`,
  borderTop: 'none',
  fontSize: 11,
  color: E.inkSub,
};

// ─── 지표 스트립 ───────────────────────────────────────────────────────────

/**
 * 지표 스트립의 한 칸. 카드가 아니라 구분선으로 나눈 셀이다 —
 * 카드 여백을 걷어내야 표가 첫 화면에 들어온다.
 */
export function Kpi({ label, value, unit, sub, delta, tone, last }: {
  label: React.ReactNode;
  value: string;
  unit?: string;
  sub?: string;
  /** 전기 대비 증감률(%). null이면 비교 데이터가 없다는 뜻이다. */
  delta?: number | null;
  tone?: string;
  last?: boolean;
}) {
  return (
    <div style={{ padding: '9px 12px', borderRight: last ? 'none' : `1px solid ${E.lineSoft}` }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', color: E.inkMute,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: E.mono,
        fontVariantNumeric: 'tabular-nums',
        fontSize: 19,
        fontWeight: 600,
        letterSpacing: '-.02em',
        marginTop: 1,
        color: tone ?? E.ink,
      }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: E.inkMute }}>{unit}</span>}
      </div>
      {delta !== undefined ? (
        delta === null ? (
          <div style={{ fontSize: 10.5, color: E.inkMute }}>비교 데이터 없음</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5 }}>
            {delta >= 0 ? <TrendingUp size={10} color={E.profit} /> : <TrendingDown size={10} color={E.loss} />}
            <span style={{ fontWeight: 600, color: delta >= 0 ? E.profit : E.loss }}>
              {delta >= 0 ? '+' : ''}{delta}%
            </span>
            <span style={{ color: E.inkMute }}>전기 대비</span>
          </div>
        )
      ) : sub ? (
        <div style={{ fontSize: 10.5, color: E.inkMute, fontVariantNumeric: 'tabular-nums' }}>{sub}</div>
      ) : null}
    </div>
  );
}

// ─── 배지 ──────────────────────────────────────────────────────────────────

/** 격자 안에 들어가는 작은 상태 표시. 27px 행을 넘지 않는다. */
export function Tag({ tone, filled, title, children }: {
  tone: string;
  /** 배경까지 채울지. 주의를 끌어야 할 때만 켠다 */
  filled?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        padding: '1px 4px',
        border: `1px solid ${tone}`,
        color: tone,
        background: filled ?? 'transparent',
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}
