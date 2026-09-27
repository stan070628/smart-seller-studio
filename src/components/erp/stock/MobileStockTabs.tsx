// src/components/erp/stock/MobileStockTabs.tsx
'use client';

/** /m/stock 위 탭: 재고 수정(기존 MobileStock) · 당근 판매(1-C2b ③) */
import { useState } from 'react';
import MobileStock from './MobileStock';
import KarrotSaleForm from './KarrotSaleForm';

export default function MobileStockTabs() {
  const [tab, setTab] = useState<'stock' | 'karrot'>('stock');
  const btn = (on: boolean) => ({ flex: 1, height: 40, border: 'none', borderBottom: on ? '3px solid #111827' : '3px solid transparent', backgroundColor: '#fff', color: on ? '#111827' : '#6b7280', fontSize: 14, fontWeight: 700 }) as const;
  return (
    <div>
      <div role="tablist" style={{ display: 'flex', position: 'sticky', top: 52, zIndex: 5, backgroundColor: '#fff' }}>
        <button type="button" role="tab" aria-selected={tab === 'stock'} onClick={() => setTab('stock')} style={btn(tab === 'stock')}>재고 수정</button>
        <button type="button" role="tab" aria-selected={tab === 'karrot'} onClick={() => setTab('karrot')} style={btn(tab === 'karrot')}>당근 판매</button>
      </div>
      {tab === 'stock' ? <MobileStock /> : <div style={{ padding: '12px 16px', paddingBottom: 96 }}><KarrotSaleForm variant="mobile" /></div>}
    </div>
  );
}
