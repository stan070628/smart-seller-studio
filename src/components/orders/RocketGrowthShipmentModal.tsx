'use client';

import React, { useState } from 'react';
import { X, Package } from 'lucide-react';
import { distributeRgFee } from '@/lib/cost-management/rg-shipment';

interface ProductForRg {
  id: string;
  product_name: string;
  current_stock: number;
}

interface Props {
  products: ProductForRg[];
  onClose: () => void;
  onCreated: () => void;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function RocketGrowthShipmentModal({ products, onClose, onCreated }: Props) {
  const [shippedAt, setShippedAt] = useState(new Date().toISOString().slice(0, 10));
  const [totalFee, setTotalFee] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const feeNum = Number(totalFee.replace(/,/g, '')) || 0;

  function setQty(productId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [productId]: value }));
  }

  const activeItems = products
    .map((p) => ({ ...p, qty: parseInt(quantities[p.id] ?? '0') || 0 }))
    .filter((p) => p.qty > 0);

  const totalQty = activeItems.reduce((s, i) => s + i.qty, 0);

  const unitFees = distributeRgFee(activeItems, feeNum);
  const canSubmit = activeItems.length > 0 && feeNum > 0 && !!shippedAt;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const items = activeItems.map((item) => ({
        product_cost_id: item.id,
        quantity: item.qty,
        unit_rg_fee: unitFees.get(item.id) ?? 0,
      }));

      const res = await fetch('/api/cost-management/rg-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipped_at: shippedAt, total_shipping_fee: feeNum, items }),
      });
      const json = await res.json();
      if (json.success) {
        onCreated();
        onClose();
      } else {
        alert(json.error ?? '등록에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '520px', maxHeight: '85vh', background: '#fff', color: '#111111', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(3,105,161,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#0369a1" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>로켓그로스 입고 등록</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>배송비를 수량 비례로 자동 배분합니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* 입고일 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>입고일</div>
            <input
              type="date"
              value={shippedAt}
              onChange={(e) => setShippedAt(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', color: '#18181b' }}
            />
          </div>

          {/* 총 배송비 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>총 배송비 (원)</div>
            <input
              type="number"
              value={totalFee}
              onChange={(e) => setTotalFee(e.target.value)}
              placeholder="예: 22750"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
            />
          </div>

          {/* 상품 목록 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>보낼 수량 입력</div>
            <div style={{ background: '#f9f9f9', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e5e5' }}>
              {/* 헤더 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', fontSize: '10px', color: '#999', fontWeight: 600, borderBottom: '1px solid #e5e5e5', background: '#f5f5f7' }}>
                <span>상품명</span>
                <span style={{ textAlign: 'right' }}>재고</span>
                <span style={{ textAlign: 'right' }}>이번 수량</span>
                <span style={{ textAlign: 'right' }}>unit배송비</span>
              </div>
              {products.map((p) => {
                const qtyStr = quantities[p.id] ?? '';
                const qty = parseInt(qtyStr) || 0;
                const unitFee = qty > 0 ? (unitFees.get(p.id) ?? 0) : null;
                const overStock = qty > p.current_stock;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
                    <span style={{ fontSize: '11px', color: '#18181b', fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#71717a' }}>{fmt(p.current_stock)}개</span>
                    <div style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={p.current_stock}
                        value={qtyStr}
                        onChange={(e) => setQty(p.id, e.target.value)}
                        placeholder="0"
                        style={{
                          width: '60px', padding: '4px 6px', borderRadius: '6px', textAlign: 'right',
                          border: `1px solid ${overStock ? '#ef4444' : '#e5e5e5'}`,
                          fontSize: '12px', fontWeight: 600, color: overStock ? '#ef4444' : '#18181b',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#0369a1', fontWeight: unitFee ? 600 : 400 }}>
                      {unitFee !== null ? `${fmt(unitFee)}원` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 미리보기 합계 */}
          {activeItems.length > 0 && feeNum > 0 && (
            <div style={{ background: '#f0f9ff', borderRadius: '8px', padding: '12px', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', marginBottom: '6px' }}>배분 미리보기</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1' }}>
                <span>합계 수량</span>
                <span style={{ fontWeight: 600 }}>{fmt(totalQty)}개</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1', marginTop: '4px' }}>
                <span>총 배송비</span>
                <span style={{ fontWeight: 600 }}>{fmt(feeNum)}원</span>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e5e5' }}>
          <button
            onClick={submit}
            disabled={saving || !canSubmit}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: canSubmit ? '#0369a1' : '#e5e5e5', color: canSubmit ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '등록 중...' : '로켓그로스 입고 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
