// src/components/erp/stock/RgAutoPanel.tsx
'use client';

/** (1-C2b ④) 마지막 RG 자동 대조 — 옮김·옮길 예정·확인 필요. 사람의 「반영」은 재고 표의 RG 대조로 그대로 한다 */
import { useEffect, useState } from 'react';
import { E } from '@/lib/design-tokens';
import type { RgAutoLast } from '@/lib/erp/stock/rg-auto';
import { fetchRgAuto } from './api';
import { fmtKst } from './stock-view';

export default function RgAutoPanel() {
  const [d, setD] = useState<RgAutoLast | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchRgAuto().then((r) => { if (!alive) return; if (r.ok) setD(r.data); else setErr(r.error); });
    return () => { alive = false; };
  }, []);
  if (err) return <div role="alert" style={{ padding: '4px 10px', fontSize: 11, color: E.loss }}>RG 자동 대조 불러오기 실패: {err}</div>;
  if (!d) return null;
  if (d.rows.length === 0) return <div style={{ padding: '4px 10px', fontSize: 11, color: E.inkSub }}>RG 자동 대조 — 확인할 것 없음(매일 09:37)</div>;
  return (
    <div style={{ padding: '6px 10px', fontSize: 11.5, color: E.ink, border: `1px solid ${E.lineSoft}`, marginBottom: 8 }}>
      <b>RG 자동 대조 {d.runAt ? fmtKst(d.runAt) : ''}</b>
      {d.rows.map((r) => (
        <div key={`${r.skuId ?? r.vid}`}>
          {r.label} — 원장 {r.ledger} · 실재고 {r.actual} · 입고중 {r.inbound}
          {r.moved > 0 && <span style={{ color: E.profit }}> · 자동 이동 {r.moved}</span>}
          {r.moved === 0 && r.planned > 0 && <span style={{ color: E.warn }}> · 옮길 예정 {r.planned}</span>}
          {r.alert && <span style={{ color: E.loss }}> · {r.alert}</span>}
        </div>
      ))}
    </div>
  );
}
