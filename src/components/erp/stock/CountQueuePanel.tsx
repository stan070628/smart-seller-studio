'use client';

/**
 * 「오늘 셀 목록」(PC) — 집에서 오늘 셀 SKU N개(결정 5). 「세기」를 누르면 칸 편집(EditCell)이 지금 개수로만 열리고,
 * 저장하면(차이가 없어도 센 기록이 남는다) 그 줄이 목록에서 빠진다.
 * 목록은 화면을 열 때 한 번 받는다 — 다시 받으면 센 만큼 다음 SKU가 채워져 「오늘 N개」가 끝나지 않는다.
 */
import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import { DEFAULT_QUEUE_N, kstDate } from '@/lib/erp/stock/count-queue';
import EditCell from './EditCell';
import { fetchCountQueue } from './api';
import { won, type StagedEdit, type StockRow } from './stock-view';

interface Props {
  /** 최신 목록 행 — 세는 사이 원장이 바뀌었으면(저장 뒤 다시 불러온 값) 이 값으로 편집을 연다 */
  rowById: Map<number, StockRow>;
  busy: boolean;
  /** 저장. 성공하면 true — 그 줄을 목록에서 뺀다 */
  onSave: (e: StagedEdit) => Promise<boolean>;
}

const HEADERS = ['상품', '옵션', '집(원장)', '집 평가액', '마지막 실사', ''];
const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};
const smallBtn: React.CSSProperties = { ...btnStyle, height: 20, padding: '0 8px', fontSize: 10.5 };

export default function CountQueuePanel({ rowById, busy, onSave }: Props) {
  const [items, setItems] = useState<StockRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchCountQueue(DEFAULT_QUEUE_N).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setItems(r.data.items);
      setTotal(r.data.items.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: StagedEdit) {
    if (!(await onSave(e))) return;
    setItems((list) => (list ?? []).filter((r) => r.skuId !== e.skuId));
    setEditing(null);
  }

  const left = items?.length ?? 0;
  const status =
    items === null ? (error ? '불러오지 못했습니다' : '불러오는 중…')
      : total === 0 ? '셀 SKU가 없습니다(원장 전표가 있는 SKU만 고릅니다)'
        : left === 0 ? `오늘 ${total}개를 다 셌습니다`
          : `남은 ${left} / ${total}개`;

  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
      <div style={bandStyle}>
        <ClipboardList size={12} />
        <span style={{ flex: 1 }}>오늘 셀 목록 — 집 · {status}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} style={smallBtn}>{open ? '접기' : '펼치기'}</button>
      </div>
      {error && <div role="alert" style={{ padding: '6px 10px', color: E.loss, fontSize: 11.5 }}>{error}</div>}
      {open && items && items.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{HEADERS.map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const r = rowById.get(item.skuId) ?? item;
              return (
                <tr key={r.skuId} style={{ height: E.rowH }}>
                  <td style={textTd} title={r.key}>{r.name}</td>
                  <td style={textTd}>{r.option || '—'}</td>
                  <td style={numTdStyle}>{won(r.self)}</td>
                  <td style={numTdStyle}>{won(r.selfValue)}</td>
                  <td style={{ ...numTdStyle, color: r.lastCountedAt ? E.ink : E.inkMute }}>{r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}</td>
                  <td style={{ ...numTdStyle, position: 'relative', textAlign: 'center' }}>
                    <button type="button" disabled={busy} onClick={() => setEditing(r.skuId)} style={smallBtn}>세기</button>
                    {editing === r.skuId && (
                      <EditCell row={r} location="self" countMode={false} countOnly onSubmit={(e) => void submit(e)} onCancel={() => setEditing(null)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
