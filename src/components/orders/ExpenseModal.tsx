'use client';

import React, { useState } from 'react';
import { toast } from '@/components/ui/toast';

export interface ExpenseInitial {
  date: string;
  parcelCost: number;
  adSpend: number;
  boxCost: number;
  boxMemo: string;
}

interface Props {
  initial?: ExpenseInitial;
  onClose: () => void;
  onSaved: () => void;
}

const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export default function ExpenseModal({ initial, onClose, onSaved }: Props) {
  const [date, setDate] = useState(initial?.date ?? todayKst());
  const [parcelCost, setParcelCost] = useState(String(initial?.parcelCost ?? ''));
  const [adSpend, setAdSpend] = useState(String(initial?.adSpend ?? ''));
  const [boxCost, setBoxCost] = useState(String(initial?.boxCost ?? ''));
  const [boxMemo, setBoxMemo] = useState(initial?.boxMemo ?? '');
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  const num = (s: string) => Math.trunc(Number(s) || 0);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error('날짜를 선택하세요'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/settlement/expenses/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcelCost: num(parcelCost), adSpend: num(adSpend), boxCost: num(boxCost), boxMemo }),
      });
      const json = await res.json();
      if (json.success) { toast.success('비용 저장됨'); onSaved(); onClose(); }
      else toast.error(json.error ?? '저장 실패');
    } catch {
      toast.error('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#3f3f46', marginBottom: 4, display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#18181b', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: 420, background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#18181b', margin: '0 0 16px' }}>{isEdit ? '비용 수정' : '비용 입력'}</h2>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>날짜</label>
          <input type="date" value={date} disabled={isEdit} onChange={(e) => setDate(e.target.value)} style={{ ...input, background: isEdit ? '#f4f4f5' : '#fff' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>택배비</label>
          <input type="number" value={parcelCost} onChange={(e) => setParcelCost(e.target.value)} placeholder="0" style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>광고비</label>
          <input type="number" value={adSpend} onChange={(e) => setAdSpend(e.target.value)} placeholder="0" style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>박스비</label>
          <input type="number" value={boxCost} onChange={(e) => setBoxCost(e.target.value)} placeholder="0" style={input} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={label}>박스 메모 (선택)</label>
          <input type="text" value={boxMemo} onChange={(e) => setBoxMemo(e.target.value)} placeholder="예: 중박스 500개" style={input} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', fontSize: 13 }}>취소</button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#be0014', color: '#fff', cursor: saving ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
