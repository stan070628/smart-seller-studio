'use client';

/** SKU 검색 선택(대기열 연결 · 당근 판매 공용). 재고 목록(/api/erp/stock)을 한 번 받아 화면에서 거른다(SKU 수백 개 규모) */
import React, { useEffect, useState } from 'react';
import { E } from '@/lib/design-tokens';
import type { StockListRow } from '@/lib/erp/stock/queries';
import { fetchStock } from './api';

export function matchSkus(rows: StockListRow[], q: string): StockListRow[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return rows.filter((r) => { const t = `${r.name} ${r.option} ${r.key}`.toLowerCase(); return words.every((w) => t.includes(w)); }).slice(0, 30);
}

interface Props {
  value: StockListRow | null;
  onChange: (r: StockListRow | null) => void;
  /** 휴대폰 화면은 큰 글씨·밝은 배경 */
  variant?: 'pc' | 'mobile';
  initialQuery?: string;
}

export default function SkuPicker({ value, onChange, variant = 'pc', initialQuery = '' }: Props) {
  const [rows, setRows] = useState<StockListRow[]>([]);
  const [q, setQ] = useState(initialQuery);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchStock().then((r) => { if (!alive) return; if (r.ok) setRows(r.data); else setErr(r.error); });
    return () => { alive = false; };
  }, []);
  const mobile = variant === 'mobile';
  const input: React.CSSProperties = mobile
    ? { width: '100%', height: 40, borderRadius: 8, border: '1px solid #d1d5db', padding: '0 10px', fontSize: 14, boxSizing: 'border-box', backgroundColor: '#fff', color: '#111827' }
    : { width: '100%', height: 26, border: `1px solid ${E.line}`, padding: '0 6px', fontSize: 12, boxSizing: 'border-box' };
  if (value) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: mobile ? 14 : 12, color: mobile ? '#111827' : E.ink }}>
        <b>{value.name}{value.option ? ` · ${value.option}` : ''}</b>
        <span style={{ color: mobile ? '#6b7280' : E.inkSub }}>집 {value.self} · RG {value.rg}</span>
        <button type="button" onClick={() => onChange(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: mobile ? '#2563eb' : E.accent }}>바꾸기</button>
      </div>
    );
  }
  const hits = matchSkus(rows, q);
  return (
    <div>
      <input aria-label="SKU 검색" placeholder="상품명·옵션으로 검색" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
      {err && <div role="alert" style={{ color: mobile ? '#b91c1c' : E.loss, fontSize: 12 }}>{err}</div>}
      <div style={{ maxHeight: mobile ? 260 : 200, overflow: 'auto', marginTop: 4 }}>
        {hits.map((r) => (
          <button key={r.skuId} type="button" onClick={() => onChange(r)}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: `1px solid ${mobile ? '#f3f4f6' : E.lineSoft}`, background: 'none', padding: mobile ? '10px 4px' : '4px', cursor: 'pointer', fontSize: mobile ? 14 : 12, color: mobile ? '#111827' : E.ink }}>
            {r.name}{r.option ? ` · ${r.option}` : ''} <span style={{ color: mobile ? '#6b7280' : E.inkSub }}>(SKU {r.skuId} · 집 {r.self} · RG {r.rg})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
