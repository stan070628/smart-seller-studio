'use client';

import React, { useState, useEffect } from 'react';
import { X, Truck } from 'lucide-react';
import { distributeShippingFee } from '@/lib/cost-management/calculations';

interface EntryForGroup {
  id: string;
  product_cost_id: string;
  quantity: number;
  shipping_group_id: string | null;
}

interface ProductForGroup {
  id: string;
  product_name: string;
  entry_count: number;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface Props {
  products: ProductForGroup[];
  onClose: () => void;
  onCreated: () => void;
}

export default function ShippingGroupModal({ products, onClose, onCreated }: Props) {
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [latestEntries, setLatestEntries] = useState<Map<string, EntryForGroup>>(new Map());
  const [groupName, setGroupName] = useState(`${new Date().toISOString().slice(0, 10)} 로켓그로스 입고`);
  const [totalFee, setTotalFee] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadEntries() {
      setLoading(true);
      const map = new Map<string, EntryForGroup>();
      await Promise.all(
        products.map(async (p) => {
          const res = await fetch(`/api/cost-management/products/${p.id}/entries`);
          const json = await res.json();
          if (json.success && json.data.length > 0) {
            const ungrouped = json.data.find((e: EntryForGroup) => !e.shipping_group_id);
            if (ungrouped) map.set(p.id, { ...ungrouped, product_cost_id: p.id });
          }
        }),
      );
      setLatestEntries(map);
      setLoading(false);
    }
    loadEntries();
  }, [products]);

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedEntries = [...selectedProductIds]
    .map((pid) => latestEntries.get(pid))
    .filter((e): e is EntryForGroup => e != null);

  const totalQty = selectedEntries.reduce((s, e) => s + e.quantity, 0);
  const feeNum = Number(totalFee.replace(/,/g, '')) || 0;

  function previewRows() {
    if (totalQty === 0 || !feeNum) return [];
    const distribution = distributeShippingFee(
      selectedEntries.map((e) => ({ id: e.id, quantity: e.quantity })),
      feeNum,
    );
    return selectedEntries.map((e) => {
      const product = products.find((p) => p.id === e.product_cost_id);
      const totalForEntry = distribution.get(e.id) ?? 0;
      const perUnit = e.quantity > 0 ? Math.round(totalForEntry / e.quantity) : 0;
      return { name: product?.product_name ?? '', qty: e.quantity, perUnit };
    });
  }

  async function create() {
    if (selectedEntries.length === 0 || !feeNum) return;
    setSaving(true);
    try {
      const res = await fetch('/api/cost-management/shipping-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName,
          total_shipping_fee: feeNum,
          entry_ids: selectedEntries.map((e) => e.id),
        }),
      });
      const json = await res.json();
      if (json.success) {
        onCreated();
        onClose();
      } else {
        alert(json.error ?? '그룹 생성에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  const rows = previewRows();
  const canSubmit = selectedEntries.length > 0 && feeNum > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '480px', maxHeight: '85vh', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Truck size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>배송비 그룹 생성</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>로켓그로스 공동 입고 배송비 자동 배분</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>그룹명</div>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>상품 선택 (그룹핑할 입고 건)</div>
            <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {loading ? (
                <div style={{ color: '#999', fontSize: '12px', textAlign: 'center', padding: '8px' }}>로딩중...</div>
              ) : products.map((p) => {
                const entry = latestEntries.get(p.id);
                const disabled = !entry;
                const selected = selectedProductIds.has(p.id);
                return (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: disabled ? 'not-allowed' : 'pointer', padding: '8px', borderRadius: '6px', background: '#fff', border: `1px solid ${selected ? '#93c5fd' : '#e5e5e5'}`, opacity: disabled ? 0.5 : 1 }}>
                    <input type="checkbox" checked={selected} disabled={disabled} onChange={() => toggleProduct(p.id)} />
                    <span style={{ flex: 1 }}>{p.product_name}</span>
                    {entry
                      ? <span style={{ fontSize: '11px', color: '#555' }}>수량: <strong>{fmt(entry.quantity)}</strong></span>
                      : <span style={{ fontSize: '11px', color: '#999' }}>미배치 입고 건 없음</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>총 배송비 (원)</div>
            <input
              type="number"
              value={totalFee}
              onChange={(e) => setTotalFee(e.target.value)}
              placeholder="예: 54000"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
            />
          </div>

          {rows.length > 0 && feeNum > 0 && (
            <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '12px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>자동 배분 미리보기</div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                  <span style={{ color: '#555' }}>{r.name} ({fmt(r.qty)}개)</span>
                  <span style={{ fontWeight: 600, color: '#16a34a' }}>개당 {fmt(r.perUnit)}원</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #bbf7d0', marginTop: '6px', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#166534', fontWeight: 600 }}>
                <span>합계 확인</span>
                <span>{fmt(feeNum)}원 ✓</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e5e5' }}>
          <button
            onClick={create}
            disabled={saving || !canSubmit}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: canSubmit ? '#be0014' : '#e5e5e5', color: canSubmit ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '생성 중...' : '그룹 생성 & 배분 적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
