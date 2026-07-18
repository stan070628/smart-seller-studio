'use client';

import React, { useCallback, useEffect, useState } from 'react';
import ExpenseModal from './ExpenseModal';

interface Row {
  date: string;
  revenue: number; couponDiscount: number; platformFee: number;
  purchase: number; parcelFee: number;
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
  const [modal, setModal] = useState<{ date: string; purchase: number } | null>(null);

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

  const rows = data?.rows ?? [];
  const total = data?.monthTotal;

  // 비용 = 매입 + 택배비 + 광고비 + 박스비
  const cost = (r: { purchase: number; parcelFee: number; adSpend: number; boxCost: number }) =>
    r.purchase + r.parcelFee + r.adSpend + r.boxCost;

  // 최근 며칠은 쿠팡 확정(윙 인식 ~3~4일, RG API 반영 ~1~2일) 전이라 실제보다 낮게 잡힌다.
  // 트레일링 4일(오늘 포함)을 "미확정"으로 표시한다.
  const todayKst = nowKst.toISOString().slice(0, 10);
  const PROVISIONAL_DAYS = 4;
  const isProvisional = (d: string) => {
    const diff = Math.round((Date.parse(todayKst) - Date.parse(d)) / 86400000);
    return diff >= 0 && diff < PROVISIONAL_DAYS;
  };

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#27272a', fontSize: 12, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontSize: 12, color: '#3f3f46', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const costTd: React.CSSProperties = { ...td, cursor: 'pointer', background: '#eaf3ff', color: '#1d4ed8', fontWeight: 600 };

  return (
    <div>
      <div style={{ background: '#fff8f6', border: '1px solid #f3d4cc', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#7c2d12', marginBottom: 14 }}>
        현금 기준 — 물건 산 날 비용을 인식합니다. 쿠팡 윙·로켓그로스 판매만 집계하며, 수기 입력분은 제외됩니다.
        일괄 임포트분은 쿠폰이 반영되지 않을 수 있습니다. 상품별 손익은 <b>수익·원가</b> 탭을 보세요.
        <br />
        <b>비용</b> 열을 클릭하면 매입·택배·광고·박스비 내역을 보고 입력할 수 있습니다. 매입은 <b>수익·원가</b> 탭 기준(자동)입니다.
        <br />
        <b>미확정</b> 표시된 최근 며칠은 쿠팡 확정 전이라 실제보다 낮게 보일 수 있습니다.
        며칠 뒤 <b>수익·원가</b> 탭의 &lsquo;판매 가져오기&rsquo;를 다시 누르면 채워집니다.
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
              <th style={th}>비용</th><th style={th}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a1a1aa', padding: 20 }}>이 달 데이터가 없습니다</td></tr>
            )}
            {rows.map((r) => {
              const prov = isProvisional(r.date);
              return (
              <tr key={r.date} style={{ borderBottom: '1px solid #f4f4f5', background: prov ? '#f4f4f5' : undefined }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                  {r.date.slice(5)}
                  {prov && <span style={{ marginLeft: 6, fontSize: 10, color: '#c2410c', background: '#ffedd5', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>미확정</span>}
                </td>
                <td style={td}>{won(r.revenue)}</td>
                <td style={td}>{r.couponDiscount ? `-${won(r.couponDiscount)}` : '0'}</td>
                <td style={td}>{r.platformFee ? `-${won(r.platformFee)}` : '0'}</td>
                <td style={costTd} onClick={() => setModal({ date: r.date, purchase: r.purchase })} title="클릭해 비용 내역 보기·입력">
                  {cost(r) ? `-${won(cost(r))}` : '0'}
                </td>
                <td style={{ ...td, fontWeight: 700, color: r.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(r.netProfit)}</td>
              </tr>
              );
            })}
          </tbody>
          {total && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: '#fffbe6', borderTop: '2px solid #e5e5e5', fontWeight: 700 }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>월 합계</td>
                <td style={td}>{won(total.revenue)}</td>
                <td style={td}>-{won(total.couponDiscount)}</td>
                <td style={td}>-{won(total.platformFee)}</td>
                <td style={{ ...td, fontWeight: 700 }}>-{won(cost(total))}</td>
                <td style={{ ...td, fontWeight: 700, color: total.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(total.netProfit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modal && (
        <ExpenseModal
          date={modal.date}
          purchase={modal.purchase}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
