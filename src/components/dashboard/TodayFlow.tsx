// src/components/dashboard/TodayFlow.tsx
'use client';

/** 최근 7일 직접발송 결제분의 주문 수를 표준 상태별로. ERP의 confirmed는 구매확정이다(발주확인 아님) */
import React from 'react';
import { E } from '@/lib/design-tokens';
import type { TodayData } from '@/lib/erp/home/today';

const MAIN = [['paid', '결제완료'], ['shipping', '배송중'], ['delivered', '배송완료'], ['confirmed', '구매확정']] as const;

export default function TodayFlow({ flow }: { flow: TodayData['flow'] }) {
  const f = flow.data;
  if (!f) return <div role="alert" style={{ fontSize: 12, color: E.loss }}>주문 흐름을 불러오지 못했다</div>;
  return (
    <section aria-label="오늘 흐름" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: E.ink }}>
      <span style={{ color: E.inkSub }}>최근 7일 직접발송 주문</span>
      {MAIN.map(([k, label], i) => (
        <React.Fragment key={k}>
          {i > 0 && <span aria-hidden style={{ color: E.inkMute }}>→</span>}
          <span style={{ fontFamily: E.mono }}>{`${label} ${f[k] ?? 0}`}</span>
        </React.Fragment>
      ))}
      <span style={{ marginLeft: 'auto', color: E.inkSub }}>
        {`취소요청 ${f.cancel_requested ?? 0} · 취소 ${f.canceled ?? 0} · 반품요청 ${f.return_requested ?? 0} · 반품 ${f.returned ?? 0}`}
      </span>
    </section>
  );
}
