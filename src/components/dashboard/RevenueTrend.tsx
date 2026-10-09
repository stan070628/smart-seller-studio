// src/components/dashboard/RevenueTrend.tsx
'use client';

/** A12 매출 추이 — 날짜별 막대를 채널별로 쌓는다. 출처 erp.order_lines(SOLD, 할인 차감) */
import React from 'react';
import { E } from '@/lib/design-tokens';
import PeriodToggle from './PeriodToggle';
import type { Period } from '@/lib/dashboard/types';
import type { RevenueData } from '@/lib/erp/home/revenue';
import { CHANNEL_LABEL, SALE_CHANNELS, type SaleChannel } from '@/lib/erp/orders/types';

const COLOR: Record<SaleChannel, string> = {
  coupang_wing: '#d9480f', coupang_rg: '#1c7ed6', naver: '#2b8a3e', toss: '#5f3dc4', karrot: '#e67700',
};
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

interface Props {
  data: RevenueData | null;
  period: Period;
  onPeriodChange: (p: Period) => void;
  loading: boolean;
  error: string | null;
}

export default function RevenueTrend({ data, period, onPeriodChange, loading, error }: Props) {
  const max = Math.max(1, ...(data?.days ?? []).map((d) => d.total));
  return (
    <section aria-label="매출 추이" style={{ background: E.surface, border: `1px solid ${E.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: E.ink }}>매출 추이</h2>
        <div style={{ flex: 1 }} />
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </div>
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: E.loss }}>매출을 불러오지 못했다: {error}</div>
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
                {`${CHANNEL_LABEL[c]} ${Math.round(((data.totals.byChannel[c]?.revenue ?? 0) / data.totals.revenue) * 100)}%`}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140 }}>
            {data.days.map((d) => (
              <div key={d.day} role="img" aria-label={`${d.day.slice(5)} 매출 ${won(d.total)}`} title={`${d.day} ${won(d.total)}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%' }}>
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
