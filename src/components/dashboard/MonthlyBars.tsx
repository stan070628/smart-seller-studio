'use client';

/** 최근 월 매출 막대 — 이번 달 누적 그래프 왼쪽. 9월 전은 옛 장부 기준이라 빗금과 문구로 구분한다(monthly.ts) */
import React, { useState } from 'react';
import { E } from '@/lib/design-tokens';
import type { MonthTotal } from '@/lib/erp/home/monthly';

const ERP_COLOR = '#1c7ed6';
const LEGACY_BG = 'repeating-linear-gradient(135deg, #a5c8ef 0 4px, #d0e2f6 4px 8px)';
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const monthNum = (ym: string) => `${Number(ym.slice(5))}월`;

export default function MonthlyBars({ months }: { months: MonthTotal[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.revenue));
  const tip = hover !== null ? months[hover] : undefined;
  const hasLegacy = months.some((m) => m.source === 'legacy');
  return (
    <section role="region" aria-label="최근 월 매출" style={{ flex: '0 1 300px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: E.ink }}>최근 {months.length}개월</div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }} onMouseLeave={() => setHover(null)}>
        {tip && hover !== null && (
          <div role="tooltip" style={{
            position: 'absolute', bottom: '100%', marginBottom: 6, zIndex: 2, pointerEvents: 'none', whiteSpace: 'nowrap',
            ...(hover < months.length / 2 ? { left: `${(hover / months.length) * 100}%` } : { right: `${((months.length - hover - 1) / months.length) * 100}%` }),
            background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 2px 8px rgba(0,0,0,.12)', padding: '6px 8px', fontSize: 11, color: E.ink,
          }}>
            <div style={{ fontWeight: 700 }}>{`${tip.month.slice(0, 4)}년 ${monthNum(tip.month)} · ${won(tip.revenue)} · ${tip.orders}건`}</div>
            {tip.source === 'legacy' && <div style={{ color: E.warn }}>옛 장부 기준 — 실제보다 적을 수 있음</div>}
          </div>
        )}
        {months.map((m, i) => (
          <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }}>
            <div role="img" tabIndex={0}
              aria-label={`${monthNum(m.month)} 매출 ${won(m.revenue)}${m.source === 'legacy' ? ' (옛 장부 기준)' : ''}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              style={{
                height: `${(m.revenue / max) * 100}%`, minHeight: m.revenue > 0 ? 2 : 0, outline: 'none',
                background: m.source === 'legacy' ? LEGACY_BG : ERP_COLOR, opacity: hover === null || hover === i ? 1 : 0.55,
              }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 10, color: E.inkMute }}>
        {months.map((m) => <span key={m.month} style={{ flex: 1, textAlign: 'center' }}>{monthNum(m.month)}</span>)}
      </div>
      {hasLegacy && <div style={{ fontSize: 10, color: E.warn }}>빗금 = 옛 장부 기준 · 실제보다 적을 수 있음</div>}
    </section>
  );
}
