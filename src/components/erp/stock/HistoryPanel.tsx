'use client';

/** 우측 입출 이력. 조정·기초·RG 입고 완료 묶음(같은 원 멱등키)마다 「되돌리기」 하나 — 역전표를 남긴다 */
import React, { useCallback, useEffect, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import { REASON_LABEL } from '@/lib/erp/ledger/adjust';
import type { HistoryRow } from '@/lib/erp/stock/queries';
import { fetchHistory, postReverse } from './api';
import { LOC_LABEL, fmtKst, won, type StockRow } from './stock-view';

const KIND_LABEL: Record<string, string> = {
  opening: '기초', receipt: '입고', transfer: '이동', sale: '판매', return: '반품', adjust: '조정', reversal: '되돌림',
};

const td: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 6px', fontSize: 11.5, whiteSpace: 'nowrap',
};

interface Props {
  row: StockRow;
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function HistoryPanel({ row, refreshKey, onClose, onChanged }: Props) {
  const [items, setItems] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchHistory(row.skuId);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setItems(r.data);
  }, [row.skuId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SKU·새로고침이 바뀌면 옛 이력을 버리고 다시 부른다
    setItems(null);
    void load();
  }, [load, refreshKey]);

  async function undo(h: HistoryRow) {
    const group = (items ?? []).filter((x) => x.baseKey === h.baseKey);
    const qty = group.reduce((s, x) => s + x.qty, 0);
    // 이동(RG 입고 완료 rgdone:)은 출발 −·도착 + 한 쌍이라 합이 0이다 — 어디서 어디로 몇 개인지 보인다
    const from = group.find((x) => x.qty < 0);
    const to = group.find((x) => x.qty > 0);
    const what = h.kind === 'transfer' && from && to
      ? `${LOC_LABEL[from.location]} → ${LOC_LABEL[to.location]} ${won(group.filter((x) => x.qty > 0).reduce((s, x) => s + x.qty, 0))}개`
      : `${LOC_LABEL[h.location]} ${qty > 0 ? '+' : ''}${won(qty)}개${h.reason ? ` · ${REASON_LABEL[h.reason]}` : ''}`;
    const ok = await confirmDialog({
      message: `이 ${KIND_LABEL[h.kind] ?? h.kind} 전표를 되돌립니다(지우지 않고 역전표를 남깁니다).\n\n${what}`,
      confirmLabel: '되돌리기',
      danger: true,
    });
    if (!ok) return;
    setBusyKey(h.baseKey);
    const r = await postReverse(h.baseKey);
    setBusyKey(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('되돌렸습니다');
    onChanged();
  }

  const shown = new Set<string>();
  return (
    <aside style={{ width: 420, flexShrink: 0, background: E.surface, border: `1px solid ${E.line}`, maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
      <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
        <span>입출 이력 — {row.name}{row.option ? ` · ${row.option}` : ''}</span>
        <button type="button" aria-label="이력 닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}>
          <X size={13} color={E.inkSub} />
        </button>
      </div>
      {error && <div role="alert" style={{ padding: 10, color: E.loss, fontSize: 12 }}>{error}</div>}
      {!items && !error && <div style={{ padding: 10, color: E.inkMute, fontSize: 12 }}>불러오는 중…</div>}
      {items && items.length === 0 && <div style={{ padding: 10, color: E.inkMute, fontSize: 12 }}>원장 전표가 없습니다</div>}
      {items && items.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{['시각', '위치', '종류', '수량', '단가', '사유 · 메모', ''].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((h) => {
              const first = !shown.has(h.baseKey);
              shown.add(h.baseKey);
              return (
                <tr key={h.id} style={{ color: h.kind === 'reversal' || h.reversed ? E.inkMute : E.ink }}>
                  <td style={td}>{fmtKst(h.occurredAt)}</td>
                  <td style={td}>{LOC_LABEL[h.location]}</td>
                  <td style={td}>{KIND_LABEL[h.kind] ?? h.kind}{h.reversed ? ' (되돌림)' : ''}</td>
                  <td style={{ ...numTdStyle, fontSize: 11.5, color: h.qty < 0 ? E.loss : E.profit }}>{h.qty > 0 ? '+' : ''}{won(h.qty)}</td>
                  <td style={{ ...numTdStyle, fontSize: 11.5 }}>{h.unitCost === null ? '—' : won(h.unitCost)}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 140 }}>
                    {h.reason ? REASON_LABEL[h.reason] : ''}{h.reason && h.note ? ' · ' : ''}{h.note ?? ''}
                  </td>
                  <td style={td}>
                    {h.reversible && first && (
                      <button
                        type="button"
                        disabled={busyKey === h.baseKey}
                        onClick={() => void undo(h)}
                        style={{ ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 }}
                      >
                        <Undo2 size={11} /> 되돌리기
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </aside>
  );
}
