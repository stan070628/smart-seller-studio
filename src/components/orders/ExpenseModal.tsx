'use client';

import React, { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { useDraftPersist, loadDraft } from '@/hooks/useDraftPersist';
import { expenseDraftKey } from './draft-keys';
import { E } from '@/lib/design-tokens';
import { btnStyle, primaryBtnStyle, disabledBtnStyle } from './erp-ui';

interface ExpenseDraft {
  parcelCost: string;
  boxCost: string;
  boxMemo: string;
}

interface Props {
  date: string;      // YYYY-MM-DD
  purchase: number;  // 매입(cost_entries 기준, 읽기전용)
  adSpend: number;   // 광고비(product_ad_spend_daily 합계, 읽기전용)
  onClose: () => void;
  onSaved: () => void;
}

const won = (n: number) => n.toLocaleString('ko-KR');

export default function ExpenseModal({ date, purchase, adSpend, onClose, onSaved }: Props) {
  const [parcelCost, setParcelCost] = useState('');
  const [boxCost, setBoxCost] = useState('');
  const [boxMemo, setBoxMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const draftKey = expenseDraftKey(date);

  // 그날 기존 비용 로드 (박스메모까지 정확히 복원)
  // localStorage에 제출 전 초안이 남아있으면 그것을 우선한다 — 그렇지 않으면
  // 비동기 서버 응답이 나중에 도착해 방금 복원한 초안을 덮어써 버린다
  // (초안이 곧 아직 저장하지 않은 더 최근 입력이라는 전제).
  useEffect(() => {
    let alive = true;
    const draft = loadDraft<ExpenseDraft>(draftKey);
    const hasDraftValues =
      draft.parcelCost !== undefined || draft.boxCost !== undefined || draft.boxMemo !== undefined;
    if (hasDraftValues) {
      setParcelCost(draft.parcelCost ?? '');
      setBoxCost(draft.boxCost ?? '');
      setBoxMemo(draft.boxMemo ?? '');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/settlement/expenses?from=${date}&to=${date}`);
        const json = await res.json();
        const it = json.success && json.items?.[0];
        if (alive && it) {
          setParcelCost(it.parcelCost ? String(it.parcelCost) : '');
          setBoxCost(it.boxCost ? String(it.boxCost) : '');
          setBoxMemo(it.boxMemo ?? '');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [date, draftKey]);

  // 로딩 중(서버/초안 확인 전)이거나 세 필드가 모두 비어있으면 초안을 남기지 않는다.
  const { clearNow: clearExpenseDraftNow } = useDraftPersist(
    draftKey,
    { parcelCost, boxCost, boxMemo },
    !loading && (parcelCost !== '' || boxCost !== '' || boxMemo !== ''),
  );

  const num = (s: string) => Math.trunc(Number(s) || 0);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/settlement/expenses/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcelCost: num(parcelCost), boxCost: num(boxCost), boxMemo }),
      });
      const json = await res.json();
      if (json.success) { clearExpenseDraftNow(); toast.success('비용 저장됨'); onSaved(); }
      else toast.error(json.error ?? '저장 실패');
    } catch {
      toast.error('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const [, mm, dd] = date.split('-');

  const label: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, color: E.inkSub, marginBottom: 5, display: 'block',
  };
  const input: React.CSSProperties = {
    width: '100%', font: 'inherit', fontSize: 12, color: E.ink, background: E.surface,
    border: `1px solid ${E.line}`, padding: '4px 8px', height: 27, boxSizing: 'border-box',
  };
  /** 읽기전용 값 한 줄 — 어디서 들어온 숫자인지 밝힌다 */
  const readonlyRow = (title: string, source: string, value: number, first?: boolean) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', borderTop: first ? 'none' : `1px solid ${E.lineSoft}`,
    }}>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: E.inkSub }}>{title}</div>
        <div style={{ fontSize: 10, color: E.inkMute }}>{source}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: E.ink, fontFamily: E.mono, fontVariantNumeric: 'tabular-nums' }}>
        {won(value)}원
      </div>
    </div>
  );

  const canSave = !saving && !loading;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,32,42,0.45)' }} />
      <div style={{
        position: 'relative', width: 'min(420px, 94vw)',
        background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 16px 48px rgba(22,32,42,.28)',
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: E.chrome, borderBottom: `1px solid ${E.line}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: E.ink }}>{Number(mm)}월 {Number(dd)}일 비용</div>
            <div style={{ fontSize: 11, color: E.inkSub }}>택배비·박스비를 입력합니다</div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ ...btnStyle, width: 22, height: 22, padding: 0, justifyContent: 'center' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '12px 12px 4px' }}>
          {/* 자동으로 들어오는 값 — 여기서는 고칠 수 없다 */}
          <div style={{ border: `1px solid ${E.line}`, background: E.chrome2, marginBottom: 12 }}>
            {readonlyRow('매입', '수익·원가 탭의 입고 내역', purchase, true)}
            {readonlyRow('광고비', '수익·원가 탭의 상품별·날짜별 입력', adSpend)}
          </div>

          {loading ? (
            <div style={{ color: E.inkSub, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>불러오는 중…</div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="ex-parcel" style={label}>택배비</label>
                <input
                  id="ex-parcel" type="number" value={parcelCost}
                  onChange={(e) => setParcelCost(e.target.value)} placeholder="0"
                  style={{ ...input, fontFamily: E.mono, textAlign: 'right' }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="ex-box" style={label}>박스비</label>
                <input
                  id="ex-box" type="number" value={boxCost}
                  onChange={(e) => setBoxCost(e.target.value)} placeholder="0"
                  style={{ ...input, fontFamily: E.mono, textAlign: 'right' }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="ex-memo" style={label}>박스 메모 (선택)</label>
                <input
                  id="ex-memo" type="text" value={boxMemo}
                  onChange={(e) => setBoxMemo(e.target.value)} placeholder="예: 중박스 500개"
                  style={input}
                />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: E.chrome2, borderTop: `1px solid ${E.line}` }}>
          <span style={{ fontSize: 11, color: E.inkMute }}>매입·광고비는 수익·원가 탭에서 고칩니다</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={btnStyle}>취소</button>
            <button onClick={save} disabled={!canSave} style={canSave ? primaryBtnStyle : disabledBtnStyle}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
