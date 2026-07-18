'use client';

import React, { useCallback, useEffect, useState } from 'react';
import ExpenseModal, { ExpenseInitial } from './ExpenseModal';

interface Item {
  date: string;
  adSpend: number;
  boxCost: number;
  parcelCost: number;
  boxMemo: string;
  memo: string;
}

const won = (n: number) => n.toLocaleString('ko-KR');

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  return { from, to };
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExpensesTab() {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const [ym, setYm] = useState(`${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}`);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; initial?: ExpenseInitial }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = monthRange(ym);
    try {
      const res = await fetch(`/api/settlement/expenses?from=${from}&to=${to}`);
      const json = await res.json();
      setItems(json.success ? json.items : []);
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#27272a', fontSize: 12, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontSize: 12, color: '#3f3f46', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

  return (
    <div>
      <div style={{ background: '#fff8f6', border: '1px solid #f3d4cc', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#7c2d12', marginBottom: 14 }}>
        택배비·광고비·박스비를 날짜별로 입력합니다. 여기 입력한 값이 <b>정산</b> 탭 손익에 반영됩니다.
        박스비는 구매한 날에, 택배비는 실제 청구 기준으로 입력하세요.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setYm((m) => shiftMonth(m, -1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>‹ 이전달</button>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{ym}</span>
        <button onClick={() => setYm((m) => shiftMonth(m, 1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>다음달 ›</button>
        {loading && <span style={{ color: '#a1a1aa', fontSize: 12 }}>불러오는 중…</span>}
        <button onClick={() => setModal({ open: true })} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 8, border: 'none', background: '#be0014', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ 비용 입력</button>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ ...th, textAlign: 'left' }}>날짜</th>
              <th style={th}>택배비</th><th style={th}>광고비</th><th style={th}>박스비</th>
              <th style={{ ...th, textAlign: 'left' }}>박스 메모</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#a1a1aa', padding: 20 }}>이 달 입력된 비용이 없습니다</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.date} onClick={() => setModal({ open: true, initial: { date: it.date, parcelCost: it.parcelCost, adSpend: it.adSpend, boxCost: it.boxCost, boxMemo: it.boxMemo } })}
                  style={{ borderBottom: '1px solid #f4f4f5', cursor: 'pointer' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{it.date.slice(5)}</td>
                <td style={td}>{won(it.parcelCost)}</td>
                <td style={td}>{won(it.adSpend)}</td>
                <td style={td}>{won(it.boxCost)}</td>
                <td style={{ ...td, textAlign: 'left', color: '#71717a' }}>{it.boxMemo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal.open && (
        <ExpenseModal initial={modal.initial} onClose={() => setModal({ open: false })} onSaved={load} />
      )}
    </div>
  );
}
