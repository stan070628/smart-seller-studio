'use client';

/**
 * 재고 칸 편집 팝오버. 기본은 「지금 개수」(원장과의 차이를 계산), 보조는 ±수량.
 * 늘어나면 새 lot 단가를 받는다 — 최근 lot → 옛 입고 단가를 미리 채우고 고칠 수 있다.
 * `row.costNeedsInput`이면(최근 lot도, 쓸 수 있는 옛 입고도 없다) 미리 채울 값이 없어 사람이 반드시 적어야 한다 — 안내를 다르게 보인다.
 * 실사 모드에서는 저장하지 않고 담는다(StockClient가 한 번에 저장한다).
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
  onSubmit: (e: StagedEdit) => void;
  onCancel: () => void;
}

export default function EditCell({ row, location, staged, countMode, onSubmit, onCancel }: Props) {
  const onHand = onHandAt(row, location);
  const initialCost = staged?.unitCost ?? defaultCost(row);
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
  const canSubmit = valid && diff !== 0 && !needsCost;

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
      <input
        autoFocus
        aria-label={mode === 'count' ? '지금 개수' : '±수량'}
        inputMode="numeric"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{ ...inputStyle, width: '100%', fontFamily: E.mono }}
      />
      <div style={{ fontSize: 11, margin: '4px 0 6px', color: diff > 0 ? E.profit : diff < 0 ? E.loss : E.inkMute }}>
        {valid
          ? diff === 0 ? '차이 없음' : `${won(onHand)} → ${won(onHand + diff)} (${diff > 0 ? '+' : ''}${won(diff)})`
          : mode === 'count' ? '0 이상 정수' : '0이 아닌 정수(예: -2)'}
      </div>
      <select
        aria-label="사유"
        value={reason}
        onChange={(e) => setReason(e.target.value as UserReason)}
        style={{ ...inputStyle, width: '100%', marginBottom: 6 }}
      >
        {USER_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
      </select>
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
