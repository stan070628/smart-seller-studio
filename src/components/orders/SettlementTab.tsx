'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Row {
  date: string;
  revenue: number; couponDiscount: number; platformFee: number;
  purchase: number; parcelFee: number; parcelAdjustment: number;
  adSpend: number; boxCost: number; netProfit: number; orderCount: number;
}
interface DailyResponse {
  success: boolean;
  rows: Row[];
  monthTotal: Omit<Row, 'date'>;
  error?: string;
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

export default function SettlementTab() {
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const [ym, setYm] = useState(`${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}`);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<{ date: string; field: 'adSpend' | 'boxCost'; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = monthRange(ym);
    try {
      const res = await fetch(`/api/settlement/daily?from=${from}&to=${to}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const saveExpense = async (date: string, field: 'adSpend' | 'boxCost', value: number) => {
    const existing = data?.rows.find((r) => r.date === date);
    const body = {
      adSpend: field === 'adSpend' ? value : existing?.adSpend ?? 0,
      boxCost: field === 'boxCost' ? value : existing?.boxCost ?? 0,
      parcelAdjustment: existing?.parcelAdjustment ?? 0,
    };
    await fetch(`/api/settlement/expenses/${date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  };

  const rows = data?.rows ?? [];
  const total = data?.monthTotal;

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#27272a', fontSize: 12, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontSize: 12, color: '#3f3f46', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const editable: React.CSSProperties = { ...td, background: '#eaf3ff', cursor: 'pointer' };

  return (
    <div>
      <div style={{ background: '#fff8f6', border: '1px solid #f3d4cc', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#7c2d12', marginBottom: 14 }}>
        현금 기준 — 물건 산 날 비용을 인식합니다. 쿠팡 윙·로켓그로스 판매만 집계하며, 수기 입력분은 제외됩니다.
        일괄 임포트분은 쿠폰이 반영되지 않을 수 있습니다. 상품별 손익은 <b>수익·원가</b> 탭을 보세요.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setYm((m) => shiftMonth(m, -1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>‹ 이전달</button>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{ym}</span>
        <button onClick={() => setYm((m) => shiftMonth(m, 1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>다음달 ›</button>
        {loading && <span style={{ color: '#a1a1aa', fontSize: 12 }}>불러오는 중…</span>}
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ ...th, textAlign: 'left' }}>날짜</th>
              <th style={th}>매출</th><th style={th}>쿠폰</th><th style={th}>수수료</th>
              <th style={th}>매입</th><th style={th}>택배비</th>
              <th style={th}>광고비</th><th style={th}>박스비</th><th style={th}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a1a1aa', padding: 20 }}>이 달 데이터가 없습니다</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.date} style={{ borderBottom: '1px solid #f4f4f5' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.date.slice(5)}</td>
                <td style={td}>{won(r.revenue)}</td>
                <td style={td}>{r.couponDiscount ? `-${won(r.couponDiscount)}` : '0'}</td>
                <td style={td}>{r.platformFee ? `-${won(r.platformFee)}` : '0'}</td>
                <td style={td}>{r.purchase ? `-${won(r.purchase)}` : '0'}</td>
                <td style={td}>{r.parcelFee ? `-${won(r.parcelFee)}` : '0'}</td>
                {(['adSpend', 'boxCost'] as const).map((f) => (
                  <td key={f} style={editable}
                      onClick={() => setEdit({ date: r.date, field: f, value: String(r[f]) })}>
                    {edit && edit.date === r.date && edit.field === f ? (
                      <input autoFocus type="number" value={edit.value}
                        onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveExpense(r.date, f, Math.trunc(Number(edit.value) || 0)); setEdit(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        style={{ width: 72, textAlign: 'right', border: '1px solid #86b7fe', borderRadius: 4, fontSize: 12, color: '#18181b' }} />
                    ) : (r[f] ? `-${won(r[f])}` : '0')}
                  </td>
                ))}
                <td style={{ ...td, fontWeight: 700, color: r.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(r.netProfit)}</td>
              </tr>
            ))}
          </tbody>
          {total && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: '#fffbe6', borderTop: '2px solid #e5e5e5', fontWeight: 700 }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>월 합계</td>
                <td style={td}>{won(total.revenue)}</td>
                <td style={td}>-{won(total.couponDiscount)}</td>
                <td style={td}>-{won(total.platformFee)}</td>
                <td style={td}>-{won(total.purchase)}</td>
                <td style={td}>-{won(total.parcelFee)}</td>
                <td style={td}>-{won(total.adSpend)}</td>
                <td style={td}>-{won(total.boxCost)}</td>
                <td style={{ ...td, fontWeight: 700, color: total.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(total.netProfit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
