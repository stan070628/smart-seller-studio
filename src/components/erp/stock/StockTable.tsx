'use client';

/** 재고 표. 집·RG입고중 칸을 누르면 편집, 행을 누르면 우측 이력. RG 차이가 있으면 행마다 「반영」 */
import React from 'react';
import { E } from '@/lib/design-tokens';
import { Tag, bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import EditCell from './EditCell';
import {
  defaultCost, editDiff, rgActual, rgDiff, stageKey, won,
  type EditLocation, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';

interface Props {
  rows: StockRow[];
  recon: RgRecon | null;
  staged: Map<string, StagedEdit>;
  countMode: boolean;
  editing: { skuId: number; location: EditLocation } | null;
  selected: number | null;
  busy: boolean;
  onEdit: (skuId: number, location: EditLocation) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (e: StagedEdit) => void;
  onSelect: (skuId: number) => void;
  onRgApply: (row: StockRow) => void;
}

const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};

export default function StockTable({
  rows, recon, staged, countMode, editing, selected, busy, onEdit, onCancelEdit, onSubmitEdit, onSelect, onRgApply,
}: Props) {
  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
      <div style={bandStyle}>SKU별 재고 — 원장 기준 · 집·RG입고중 칸을 누르면 고칩니다 · 행을 누르면 입출 이력</div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>{HEADERS.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const diff = rgDiff(r, recon);
            const actual = rgActual(r, recon);
            const cost = defaultCost(r);
            const cell = (loc: EditLocation) => {
              const s = staged.get(stageKey(r.skuId, loc));
              const value = loc === 'self' ? r.self : r.rgInbound;
              const isEditing = editing?.skuId === r.skuId && editing.location === loc;
              return (
                <td
                  title="눌러서 고칩니다"
                  onClick={(e) => { e.stopPropagation(); if (!isEditing) onEdit(r.skuId, loc); }}
                  style={{ ...numTdStyle, position: 'relative', cursor: 'pointer', background: s ? E.warnSoft : undefined }}
                >
                  {s ? (
                    <>
                      <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
                      {' → '}
                      <b>{won(value + editDiff(s))}</b>
                    </>
                  ) : won(value)}
                  {isEditing && (
                    <EditCell row={r} location={loc} staged={s} countMode={countMode} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
                  )}
                </td>
              );
            };
            return (
              <tr
                key={r.skuId}
                onClick={() => onSelect(r.skuId)}
                style={{ height: E.rowH, cursor: 'pointer', background: selected === r.skuId ? E.infoSoft : i % 2 ? E.chrome2 : E.surface }}
              >
                <td style={textTd} title={r.key}>
                  {r.name} {!r.hasLedger && <Tag tone={E.inkMute} title="원장 전표가 아직 없습니다 — 첫 「지금 개수」가 기초재고가 됩니다">원장 없음</Tag>}
                </td>
                <td style={textTd}>{r.option || '—'}</td>
                {cell('self')}
                {cell('rg_inbound')}
                <td style={numTdStyle}>{won(r.rg)}</td>
                <td style={numTdStyle}>{actual === null ? '—' : won(actual)}</td>
                <td style={{ ...numTdStyle, color: diff ? E.loss : E.inkMute }}>
                  {diff === null ? '—' : diff === 0 ? '0' : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {diff > 0 ? '+' : ''}{won(diff)}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); onRgApply(r); }}
                        style={{ ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 }}
                      >
                        반영
                      </button>
                    </span>
                  )}
                </td>
                <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
                <td style={numTdStyle}>{won(r.value)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={HEADERS.length} style={{ padding: 24, textAlign: 'center', color: E.inkMute, fontSize: 12 }}>표시할 SKU가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
