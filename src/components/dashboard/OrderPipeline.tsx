'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import PeriodToggle from './PeriodToggle';
import PipelineStageCard from './PipelineStageCard';
import type { ChannelPipeline, Period } from '@/lib/dashboard/types';

const STAGE_ORDER: Array<keyof Pick<ChannelPipeline, '주문' | '배송중' | '배송완료' | '구매확정' | '정산완료'>> =
  ['주문', '배송중', '배송완료', '구매확정', '정산완료'];

const STAGE_COLORS: Record<string, string> = {
  주문:     '#a1a1aa',
  배송중:   '#2563eb',
  배송완료: '#7c3aed',
  구매확정: '#16a34a',
  정산완료: '#be0014',
};

interface OrderPipelineProps {
  coupang: ChannelPipeline;
  naver: ChannelPipeline;
  period: Period;
  onPeriodChange: (p: Period) => void;
  /** true이면 해당 채널 행을 opacity 0.5로 흐리게 표시 (예: 등록 상품 0개) */
  coupangDimmed?: boolean;
  naverDimmed?: boolean;
}

export default function OrderPipeline({
  coupang, naver, period, onPeriodChange, coupangDimmed = false, naverDimmed = false,
}: OrderPipelineProps) {
  return (
    <section
      aria-label="주문 파이프라인"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>
          주문 파이프라인
        </h2>
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </header>

      <ChannelRow label="쿠팡" color={C.accent} pipeline={coupang} dimmed={coupangDimmed} />
      <div style={{ height: 12 }} />
      <ChannelRow label="네이버" color="#16a34a" pipeline={naver} dimmed={naverDimmed} />
    </section>
  );
}

function ChannelRow({
  label, color, pipeline, dimmed,
}: {
  label: string; color: string; pipeline: ChannelPipeline; dimmed: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: dimmed ? 0.5 : 1 }}>
      <div
        style={{
          minWidth: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: C.text,
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, display: 'inline-block' }}
        />
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        {STAGE_ORDER.map((stage, idx) => {
          const metric = pipeline[stage];
          const isSettlement = stage === '정산완료';
          const available = isSettlement ? (metric as { available: boolean }).available : true;
          return (
            <React.Fragment key={stage}>
              <PipelineStageCard
                label={stage}
                count={metric.count}
                amount={metric.amount}
                available={available}
                color={STAGE_COLORS[stage]}
              />
              {idx < STAGE_ORDER.length - 1 && (
                <ChevronRight size={14} aria-hidden style={{ color: '#d4d4d8', flexShrink: 0 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
