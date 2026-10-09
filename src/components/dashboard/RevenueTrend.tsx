// src/components/dashboard/RevenueTrend.tsx
'use client';

/** A12 매출 추이 — 날짜별 막대를 채널별로 쌓는다. 출처 erp.order_lines(SOLD, 할인 차감) */
import React, { useState } from 'react';
import { E } from '@/lib/design-tokens';
import PeriodToggle from './PeriodToggle';
import type { Period } from '@/lib/dashboard/types';
import type { RevenueData } from '@/lib/erp/home/revenue';
import { CHANNEL_LABEL, SALE_CHANNELS, type SaleChannel } from '@/lib/erp/orders/types';

const COLOR: Record<SaleChannel, string> = {
  coupang_wing: '#d9480f', coupang_rg: '#1c7ed6', naver: '#2b8a3e', toss: '#5f3dc4', karrot: '#c2255c',
};
const pct = (v: number, total: number) => { const r = (v / total) * 100; return r < 0.5 ? '<1%' : `${Math.round(r)}%`; };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD'(KST 날짜) → 'MM-DD (요일)'. 날짜만 보고 요일을 셈한다(시간대 무관) */
const dayLabel = (day: string) => `${day.slice(5)} (${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]})`;

interface Props {
  data: RevenueData | null;
  period: Period;
  onPeriodChange: (p: Period) => void;
  loading: boolean;
  error: string | null;
}

export default function RevenueTrend({ data, period, onPeriodChange, loading, error }: Props) {
  const max = Math.max(1, ...(data?.days ?? []).map((d) => d.total));
  const [hover, setHover] = useState<number | null>(null);
  const days = data?.days ?? [];
  const tip = hover !== null ? days[hover] : undefined;
  return (
    <section aria-label="매출 추이" style={{ background: E.surface, border: `1px solid ${E.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, opacity: loading && data ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: E.ink }}>매출 추이</h2>
        <div style={{ flex: 1 }} />
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </div>
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: E.loss }}>매출을 불러오지 못했다 — 새로고침으로 다시 시도</div>
      ) : !data ? (
        <div style={{ fontSize: 12, color: E.inkMute }}>{loading ? '집계하는 중…' : ''}</div>
      ) : data.totals.revenue === 0 ? (
        <div style={{ fontSize: 14, color: E.inkMute }}>매출 없음</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: E.ink }}>{won(data.totals.revenue)}</span>
            <span style={{ fontSize: 12, color: E.inkSub }}>{data.totals.orders}건</span>
            {SALE_CHANNELS.filter((c) => (data.totals.byChannel[c]?.revenue ?? 0) > 0).map((c) => (
              <span key={c} style={{ fontSize: 11, color: COLOR[c] }}>
                {`${CHANNEL_LABEL[c]} ${pct(data.totals.byChannel[c]?.revenue ?? 0, data.totals.revenue)}`}
              </span>
            ))}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 2, height: 140 }} onMouseLeave={() => setHover(null)}>
            {tip && hover !== null && (
              <div role="tooltip" style={{
                position: 'absolute', bottom: '100%', marginBottom: 6, zIndex: 2, pointerEvents: 'none', whiteSpace: 'nowrap',
                // 양 끝 막대는 상자가 잘리지 않게 안쪽으로 붙인다
                ...(hover < days.length * 0.2 ? { left: `${(hover / days.length) * 100}%` }
                  : hover > days.length * 0.8 ? { right: `${((days.length - hover - 1) / days.length) * 100}%` }
                  : { left: `${((hover + 0.5) / days.length) * 100}%`, transform: 'translateX(-50%)' }),
                background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 2px 8px rgba(0,0,0,.12)', padding: '6px 8px', fontSize: 11, color: E.ink,
              }}>
                <div style={{ fontWeight: 700 }}>{`${dayLabel(tip.day)} · ${won(tip.total)} · ${tip.orders}건`}</div>
                {SALE_CHANNELS.filter((c) => (tip.byChannel[c] ?? 0) > 0).map((c) => (
                  <div key={c} style={{ color: COLOR[c] }}>{`${CHANNEL_LABEL[c]} ${won(tip.byChannel[c] ?? 0)}`}</div>
                ))}
              </div>
            )}
            {data.days.map((d, i) => (
              <div key={d.day} role="img" aria-label={`${d.day.slice(5)} 매출 ${won(d.total)}`} tabIndex={0}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%', cursor: 'default', outline: 'none',
                  opacity: hover === null || hover === i ? 1 : 0.55 }}>
                {SALE_CHANNELS.map((c) => {
                  const v = d.byChannel[c] ?? 0;
                  return v > 0 ? <div key={c} style={{ height: `${(v / max) * 100}%`, background: COLOR[c] }} /> : null;
                })}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: E.inkMute }}>
            <span>{data.days[0]?.day.slice(5)}</span>
            <span>{data.days[data.days.length - 1]?.day.slice(5)}</span>
          </div>
        </>
      )}
      <div style={{ fontSize: 10, color: E.inkMute }}>
        주문 기준(취소·반품 완료 제외 · 쿠폰 할인 차감). RG 매출은 취소·반품만큼 크게 잡힌다 — 쿠팡 RG API에 취소 표시가 없다(약 1~2%).
      </div>
    </section>
  );
}
