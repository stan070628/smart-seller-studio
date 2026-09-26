'use client';

/** 그날(KST 주문일) 한 채널의 주문 라인. 구매자 정보는 서버에도 없다. 재고 부족·미귀속 줄은 색으로 구분한다 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { bandStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import type { DayLine } from '@/lib/erp/orders/queries';
import { fetchDayLines } from './api';
import { fmtKst, won } from './stock-view';

const REASON: Record<string, string> = {
  no_listing: '리스팅 없음', any_of: '옵션 여럿(any_of)', option_unmatched: '옵션 불일치', no_sku_link: 'SKU 연결 없음',
};
const STATE: Record<string, string> = {
  pending: '대기(꺼짐)', posted: '차감', skipped_short: '재고 부족', reversed: '되돌림', none: '대상 아님',
};
const NOTE: Record<string, string> = {
  pre_cutover: '기초 이전', not_paid: '미결제', voided: '취소·반품', unattributed: '미귀속', unknown_status: '모르는 상태',
};
const td: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 6px', fontSize: 11.5, whiteSpace: 'nowrap',
};

interface Props {
  channel: string;
  label: string;
  date: string;
  onClose: () => void;
}

export default function OrderLinesDialog({ channel, label, date, onClose }: Props) {
  const [items, setItems] = useState<DayLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchDayLines(channel, date).then((r) => {
      if (!alive) return;
      if (!r.ok) setError(r.error);
      else setItems(r.data);
    });
    return () => {
      alive = false;
    };
  }, [channel, date]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label={`${label} ${date} 주문 라인`}
        style={{ position: 'relative', width: 'min(1200px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>{label} — {date} 주문 라인{items ? ` ${items.length}줄` : ''}</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        {error && <div role="alert" style={{ padding: 10, color: E.loss }}>{error}</div>}
        {!items && !error && <div style={{ padding: 10, color: E.inkMute }}>불러오는 중…</div>}
        {items && items.length === 0 && <div style={{ padding: 10, color: E.inkMute }}>이날 수집한 라인이 없습니다</div>}
        {items && items.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['주문 시각', '주문번호', '상품', '수량', 'SKU', '금액', '채널 상태', '연결', '차감'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const tone = l.deductionState === 'skipped_short' ? E.loss : l.attribution === 'unattributed' ? E.warn : E.ink;
                return (
                  <tr key={l.id} style={{ color: tone }}>
                    <td style={td}>{fmtKst(l.orderedAt)}</td>
                    <td style={{ ...td, fontFamily: E.mono }}>{l.externalOrderId}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 280 }}>{l.productLabel}</td>
                    <td style={{ ...numTdStyle, fontSize: 11.5 }}>{won(l.orderQty)}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>{l.skuLabels || '—'}</td>
                    <td style={{ ...numTdStyle, fontSize: 11.5 }}>{won(l.amount)}</td>
                    <td style={td}>{l.rawStatus}</td>
                    <td style={td}>{l.attribution === 'mapped' ? '연결' : REASON[l.unattributedReason ?? ''] ?? '미귀속'}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>
                      {STATE[l.deductionState] ?? l.deductionState}
                      {l.deductionNote ? ` · ${NOTE[l.deductionNote] ?? l.deductionNote}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
