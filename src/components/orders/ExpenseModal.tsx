'use client';

import React, { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';

interface Props {
  date: string;      // YYYY-MM-DD
  purchase: number;  // 매입(cost_entries 기준, 읽기전용)
  onClose: () => void;
  onSaved: () => void;
}

const won = (n: number) => n.toLocaleString('ko-KR');

export default function ExpenseModal({ date, purchase, onClose, onSaved }: Props) {
  const [parcelCost, setParcelCost] = useState('');
  const [boxCost, setBoxCost] = useState('');
  const [boxMemo, setBoxMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 그날 기존 비용 로드 (박스메모까지 정확히 복원)
  useEffect(() => {
    let alive = true;
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
  }, [date]);

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
      if (json.success) { toast.success('비용 저장됨'); onSaved(); }
      else toast.error(json.error ?? '저장 실패');
    } catch {
      toast.error('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const [, mm, dd] = date.split('-');
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#3f3f46', marginBottom: 4, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#18181b', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: 420, background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#18181b', margin: '0 0 16px' }}>{Number(mm)}월 {Number(dd)}일 비용</h2>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f4f4f5', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#3f3f46' }}>매입</div>
            <div style={{ fontSize: 10, color: '#a1a1aa' }}>수익·원가 탭에서 입력</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#3f3f46', fontVariantNumeric: 'tabular-nums' }}>{won(purchase)}원</div>
        </div>

        {loading ? (
          <div style={{ color: '#a1a1aa', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>불러오는 중…</div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>택배비</label>
              <input type="number" value={parcelCost} onChange={(e) => setParcelCost(e.target.value)} placeholder="0" style={input} />
            </div>
            <div style={{ marginBottom: 12, fontSize: 11, color: '#a1a1aa', lineHeight: 1.5 }}>
              광고비는 <b>수익·원가</b> 탭에서 상품별·날짜별로 입력합니다.
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>박스비</label>
              <input type="number" value={boxCost} onChange={(e) => setBoxCost(e.target.value)} placeholder="0" style={input} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={label}>박스 메모 (선택)</label>
              <input type="text" value={boxMemo} onChange={(e) => setBoxMemo(e.target.value)} placeholder="예: 중박스 500개" style={input} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', fontSize: 13 }}>취소</button>
          <button onClick={save} disabled={saving || loading} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#be0014', color: '#fff', cursor: saving || loading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving || loading ? 0.6 : 1 }}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
