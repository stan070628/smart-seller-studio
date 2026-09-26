'use client';

/**
 * 재고 칸 편집 팝오버. 기본은 「지금 개수」(원장과의 차이를 계산), 보조는 ±수량.
 * 늘어나면 새 lot 단가를 받는다 — 최근 lot → 옛 입고 단가를 미리 채우고 고칠 수 있다.
 * `row.costNeedsInput`이면(최근 lot도, 쓸 수 있는 옛 입고도 없다) 미리 채울 값이 없어 사람이 반드시 적어야 한다 — 안내를 다르게 보인다.
 * 실사 모드에서는 저장하지 않고 담는다(StockClient가 한 번에 저장한다).
 * 지금 개수는 원장과 같아도 저장·담기가 된다 — 원장 전표 없이 센 기록(erp.stock_counts)만 남는다(결정 5).
 * `countOnly`면 ±수량 전환을 숨긴다(오늘 셀 목록 — 센 개수만 받는다).
 */
import React, { useState } from 'react';
import { E } from '@/lib/design-tokens';
import { btnStyle, inputStyle, primaryBtnStyle, segBtnStyle, segStyle } from '@/components/orders/erp-ui';
import { REASON_LABEL, USER_REASONS, type UserReason } from '@/lib/erp/ledger/adjust';
import { LOC_LABEL, defaultCost, editDiff, onHandAt, won, type EditLocation, type StagedEdit, type StockRow } from './stock-view';

interface Props {
  row: StockRow;
  location: EditLocation;
  staged?: StagedEdit;
  countMode: boolean;
  /** 지금 개수만(±수량 전환 없음) */
  countOnly?: boolean;
  onSubmit: (e: StagedEdit) => void;
  onCancel: () => void;
}

export default function EditCell({ row, location, staged, countMode, countOnly = false, onSubmit, onCancel }: Props) {
  const onHand = onHandAt(row, location);
  const initialCost = staged?.unitCost ?? defaultCost(row);
  // row.hasLedger는 SKU 전체 기준이라 그 위치가 정확히 비어 있는지 화면은 모른다 — 서버(adjust-store)가
  // (SKU·위치) 단위로 다시 확인한다. 여기서는 근사치로 안내와 ±수량 규칙만 보여준다.
  const locationEmpty = !row.hasLedger;
  const [mode, setMode] = useState<'count' | 'delta'>(staged?.mode ?? 'count');
  const [raw, setRaw] = useState(staged ? String(staged.value) : String(onHand));
  const [reason, setReason] = useState<UserReason>(staged?.reason ?? 'count_diff');
  const [note, setNote] = useState(staged?.note ?? '');
  const [costRaw, setCostRaw] = useState(initialCost === null ? '' : String(initialCost));

  const t = raw.trim();
  const value = /^-?\d+$/.test(t) ? Number(t) : null;
  const valid = value !== null && (mode === 'count' ? value >= 0 : value !== 0);
  const diff = valid ? editDiff({ mode, value: value as number, expected: onHand }) : 0;
  const cost = /^\d+$/.test(costRaw.trim()) ? Number(costRaw.trim()) : null;
  const needsCost = diff > 0 && cost === null;
  // 빈 위치의 ±수량은 늘리기(+)만 된다 — 줄이면(−) 뺄 재고가 없다(서버 400과 같은 규칙)
  const emptyDeltaBlocked = locationEmpty && mode === 'delta' && value !== null && value < 0;
  const canSubmit = valid && !needsCost && !emptyDeltaBlocked;

  function switchMode(m: 'count' | 'delta') {
    setMode(m);
    setRaw(m === 'count' ? String(onHand) : '');
  }

  function submit() {
    if (!canSubmit || value === null) return;
    onSubmit({ skuId: row.skuId, location, mode, value, expected: onHand, reason, note: note.trim(), unitCost: diff > 0 ? cost : null });
  }

  return (
    <div
      role="dialog"
      aria-label={`${row.name} ${LOC_LABEL[location]} 재고 고치기`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') submit();
      }}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 20, width: 260, padding: 10,
        background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 6px 18px rgba(0,0,0,.18)',
        textAlign: 'left', whiteSpace: 'normal', fontFamily: 'inherit', cursor: 'default', color: E.ink,
      }}
    >
      <div style={{ fontSize: 11, color: E.inkSub, marginBottom: 6 }}>
        {LOC_LABEL[location]} · 원장 {won(onHand)}개
      </div>
      {locationEmpty && (
        <div style={{ fontSize: 11, color: E.inkSub, background: E.chrome2, border: `1px solid ${E.lineSoft}`, padding: '4px 6px', marginBottom: 6 }}>
          원장 전표가 없는 위치입니다 — {mode === 'count' ? '이번 「지금 개수」가' : '늘리면(+)'} 기초재고로 기록됩니다
          {mode === 'delta' ? ' · 줄이기(−)는 할 수 없습니다' : ''}.
        </div>
      )}
      {!countOnly && (
        <div style={{ ...segStyle, marginBottom: 6 }}>
          {(['count', 'delta'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{ ...segBtnStyle, flex: 1, background: mode === m ? E.ink : E.surface, color: mode === m ? '#fff' : E.ink }}
            >
              {m === 'count' ? '지금 개수' : '±수량'}
            </button>
          ))}
        </div>
      )}
      <input
        autoFocus
        aria-label={mode === 'count' ? '지금 개수' : '±수량'}
        inputMode="numeric"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{ ...inputStyle, width: '100%', fontFamily: E.mono }}
      />
      <div style={{ fontSize: 11, margin: '4px 0 6px', color: emptyDeltaBlocked ? E.loss : diff > 0 ? E.profit : diff < 0 ? E.loss : E.inkMute }}>
        {emptyDeltaBlocked
          ? '비어 있는 위치에서는 뺄 수 없습니다(+ 만 기초재고로 기록됩니다)'
          : valid
            ? diff === 0 ? '차이 없음 — 센 기록만 남깁니다' : `${won(onHand)} → ${won(onHand + diff)} (${diff > 0 ? '+' : ''}${won(diff)})`
            : mode === 'count' ? '0 이상 정수' : '0이 아닌 정수(예: -2)'}
      </div>
      {!locationEmpty && (
        <select
          aria-label="사유"
          value={reason}
          onChange={(e) => setReason(e.target.value as UserReason)}
          style={{ ...inputStyle, width: '100%', marginBottom: 6 }}
        >
          {USER_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
        </select>
      )}
      {diff > 0 && (
        <label style={{ display: 'block', fontSize: 11, color: E.inkSub, marginBottom: 6 }}>
          늘어난 재고 단가(원){row.costNeedsInput ? ' — 최근 lot·옛 입고 단가가 없어 필수' : ''}
          <input
            aria-label="단가"
            inputMode="numeric"
            value={costRaw}
            onChange={(e) => setCostRaw(e.target.value)}
            style={{ ...inputStyle, width: '100%', fontFamily: E.mono, borderColor: needsCost ? E.loss : E.line }}
          />
        </label>
      )}
      <input
        aria-label="메모"
        placeholder="메모(선택)"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ ...inputStyle, width: '100%', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>취소</button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={canSubmit ? primaryBtnStyle : { ...btnStyle, opacity: 0.5, cursor: 'not-allowed' }}
        >
          {countMode ? '담기' : '저장'}
        </button>
      </div>
    </div>
  );
}
