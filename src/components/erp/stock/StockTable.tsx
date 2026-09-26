'use client';

/**
 * 재고 표 — 상품 단위로 묶는다(결정 5). 옵션이 여러 개인 상품은 합계 한 줄(누르면 펼침), 옵션 1개 상품은 그대로 한 줄.
 * 고치는 칸(집·RG입고중)은 옵션 행에만 있다. 옵션 행을 누르면 우측 이력. RG 차이가 있으면 옵션 행마다 「반영」.
 * RG 실재고가 원장보다 많고 입고중이 남았으면 그 앞에 「입고 완료 m개 옮기기」(입고중 → RG, 먼저 누를 것).
 * 조회조건이 걸리면(forceOpen) 묶음을 모두 펼쳐 맞는 옵션을 바로 보인다.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { Tag, bandStyle, btnStyle, numTdStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import EditCell from './EditCell';
import {
  defaultCost, editDiff, rgActual, rgArriveQty, rgDiff, stageKey, won,
  type EditLocation, type GroupView, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';
import { kstDate } from '@/lib/erp/stock/count-queue';

interface Props {
  views: GroupView[];
  /** 조회조건이 걸려 있다 — 묶음을 모두 펼친다 */
  forceOpen: boolean;
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
  /** 입고중 → RG로 qty개 옮긴다(RG 입고 완료). qty = rgArriveQty */
  onRgArrive: (row: StockRow, qty: number) => void;
}

const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액', '마지막 실사'];

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};
const smallBtn: React.CSSProperties = { ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 };
const smallPrimaryBtn: React.CSSProperties = { ...primaryBtnStyle, height: 20, padding: '0 6px', fontSize: 10.5 };

export default function StockTable({
  views, forceOpen, recon, staged, countMode, editing, selected, busy, onEdit, onCancelEdit, onSubmitEdit, onSelect, onRgApply, onRgArrive,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const multi = views.filter((v) => v.group.options.length > 1);
  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  // 줄무늬는 화면에 보이는 줄 순서로 센다(묶음·옵션 줄 공통)
  let stripe = 0;

  const optionRow = (r: StockRow, child: boolean) => {
    const i = stripe++;
    const diff = rgDiff(r, recon);
    const actual = rgActual(r, recon);
    const cost = defaultCost(r);
    const arrive = rgArriveQty(r, recon);
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
            editDiff(s) === 0 ? (
              <b title="차이 없음 — 센 기록만 남깁니다">{won(value)} ✓</b>
            ) : (
              <>
                <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
                {' → '}
                <b>{won(value + editDiff(s))}</b>
              </>
            )
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
          {child ? <span style={{ color: E.inkMute, paddingLeft: 14 }}>└</span> : <span>{r.name}</span>}{' '}
          {!r.hasLedger && <Tag tone={E.inkMute} title="원장 전표가 아직 없습니다 — 첫 「지금 개수」가 기초재고가 됩니다">원장 없음</Tag>}
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
              {arrive > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  title="보낸 물건이 RG에 들어갔습니다 — RG입고중에서 RG로 옮깁니다. 남은 차이만 「반영」하세요"
                  onClick={(e) => { e.stopPropagation(); onRgArrive(r, arrive); }}
                  style={smallPrimaryBtn}
                >
                  입고 완료 {won(arrive)}개 옮기기
                </button>
              )}
              <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRgApply(r); }} style={smallBtn}>
                반영
              </button>
            </span>
          )}
        </td>
        <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
        <td style={numTdStyle}>{won(r.value)}</td>
        <td style={{ ...numTdStyle, color: r.lastCountedAt ? E.ink : E.inkMute }}>{r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}</td>
      </tr>
    );
  };

  const groupRow = (v: GroupView, open: boolean) => {
    const g = v.group;
    const i = stripe++;
    const stagedN = g.options.filter((r) => staged.has(stageKey(r.skuId, 'self')) || staged.has(stageKey(r.skuId, 'rg_inbound'))).length;
    const neverCounted = g.options.filter((r) => !r.lastCountedAt).length;
    const oldest = g.options.map((r) => r.lastCountedAt).filter((x): x is string => x !== null).sort()[0] ?? null;
    return (
      <tr
        key={`g:${g.name}`}
        aria-expanded={open}
        onClick={() => { if (!forceOpen) toggle(g.name); }}
        style={{ height: E.rowH, cursor: forceOpen ? 'default' : 'pointer', background: i % 2 ? E.chrome2 : E.surface, fontWeight: 600 }}
      >
        <td style={textTd}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{g.name}</span>
            <Tag tone={E.inkSub}>{v.shown.length < g.options.length ? `옵션 ${v.shown.length}/${g.options.length}` : `옵션 ${g.options.length}`}</Tag>
            {stagedN > 0 && <Tag tone={E.warn}>담김 {stagedN}</Tag>}
          </span>
        </td>
        <td style={{ ...textTd, color: E.inkMute }}>합계</td>
        <td style={numTdStyle}>{won(g.self)}</td>
        <td style={numTdStyle}>{won(g.rgInbound)}</td>
        <td style={numTdStyle}>{won(g.rg)}</td>
        <td style={numTdStyle}>{g.rgActual === null ? '—' : won(g.rgActual)}</td>
        <td style={{ ...numTdStyle, color: g.rgMismatch ? E.loss : E.inkMute }}>
          {g.rgMismatch === null ? '—' : g.rgMismatch === 0 ? '0' : `불일치 ${g.rgMismatch}옵션`}
        </td>
        <td style={numTdStyle}>—</td>
        <td style={numTdStyle}>{won(g.value)}</td>
        <td style={{ ...numTdStyle, color: neverCounted ? E.inkMute : E.ink }} title={neverCounted ? undefined : '가장 오래된 옵션의 실사 날짜'}>
          {neverCounted ? `안 셈 ${neverCounted}` : oldest ? kstDate(oldest) : '—'}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
      <div style={bandStyle}>
        <span style={{ flex: 1 }}>
          상품별 재고 — 원장 기준 · 상품 줄을 누르면 옵션이 펼쳐집니다 · 집·RG입고중 칸을 누르면 고칩니다(개수가 같아도 저장하면 실사로 남습니다) · 옵션 줄을 누르면 입출 이력
        </span>
        <button type="button" disabled={forceOpen} onClick={() => setExpanded(new Set(multi.map((v) => v.group.name)))} style={smallBtn}>
          전체 펼치기
        </button>
        <button type="button" disabled={forceOpen} onClick={() => setExpanded(new Set())} style={smallBtn}>
          전체 접기
        </button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>{HEADERS.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {views.map((v) => {
            if (v.group.options.length === 1) return optionRow(v.shown[0], false);
            const open = forceOpen || expanded.has(v.group.name);
            return (
              <React.Fragment key={`g:${v.group.name}`}>
                {groupRow(v, open)}
                {open && v.shown.map((r) => optionRow(r, true))}
              </React.Fragment>
            );
          })}
          {views.length === 0 && (
            <tr><td colSpan={HEADERS.length} style={{ padding: 24, textAlign: 'center', color: E.inkMute, fontSize: 12 }}>표시할 SKU가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
