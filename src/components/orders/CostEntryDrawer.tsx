'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';

interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  selling_price: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
}

interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
  selling_price: string;
}

function emptyForm(): EntryForm {
  return {
    received_at: new Date().toISOString().slice(0, 10),
    quantity: '',
    unit_cost: '',
    unit_shipping_fee: '0',
    selling_price: '',
  };
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function CostEntryDrawer({ productId, productName, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/cost-management/products/${productId}/entries`);
    const json = await res.json();
    if (json.success) setEntries(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [productId]);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        received_at: form.received_at,
        quantity: Number(form.quantity),
        unit_cost: Number(form.unit_cost),
        unit_shipping_fee: Number(form.unit_shipping_fee),
        selling_price: Number(form.selling_price),
      };
      const url = editingId
        ? `/api/cost-management/entries/${editingId}`
        : `/api/cost-management/products/${productId}/entries`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        await load();
        onChanged();
        setEditingId(null);
        setAddingNew(false);
        setForm(emptyForm());
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('이 입고 건을 삭제할까요?')) return;
    const res = await fetch(`/api/cost-management/entries/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { await load(); onChanged(); }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setAddingNew(false);
    setForm({
      received_at: e.received_at.slice(0, 10),
      quantity: String(e.quantity),
      unit_cost: String(e.unit_cost),
      unit_shipping_fee: String(e.unit_shipping_fee),
      selling_price: String(e.selling_price),
    });
  }

  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  const wavgCost = totalQty > 0 ? Math.round(entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0) / totalQty) : 0;
  const wavgShip = totalQty > 0 ? Math.round(entries.reduce((s, e) => s + e.unit_shipping_fee * e.quantity, 0) / totalQty) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ width: '720px', background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#18181b' }}>입고 내역</div>
            <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={18} color="#71717a" />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', padding: '16px 24px' }}>
          {[
            { label: '가중평균 원가', value: `${fmt(wavgCost)}원`, color: '#ef4444' },
            { label: '가중평균 배송비', value: `${fmt(wavgShip)}원`, color: '#f97316' },
            { label: '총 재고', value: `${fmt(totalQty)}개`, color: '#18181b' },
          ].map((c) => (
            <div key={c.label} style={{ background: '#f5f5f7', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#999', marginBottom: '4px' }}>{c.label}</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                  {['입고일', '수량', '단가(원가)', '배송비(배분)', '판매가', '배송그룹', ''].map((h) => (
                    <th key={h} style={{ padding: '8px', textAlign: h === '입고일' ? 'left' : 'right', fontWeight: 600, color: '#555' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#71717a' }}>불러오는 중...</td></tr>
                ) : entries.map((e) => (
                  editingId === e.id ? (
                    <tr key={e.id} style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                      {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee', 'selling_price'] as (keyof EntryForm)[]).map((field) => (
                        <td key={field} style={{ padding: '6px 8px' }}>
                          <input
                            type={field === 'received_at' ? 'date' : 'number'}
                            value={form[field]}
                            onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                            style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid #86efac', fontSize: '11px', boxSizing: 'border-box' }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '6px 8px' }} colSpan={2}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={save} disabled={saving} style={{ padding: '4px 10px', borderRadius: '6px', background: '#16a34a', color: '#fff', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
                            {saving ? '저장중' : '저장'}
                          </button>
                          <button onClick={() => { setEditingId(null); setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '4px 8px', borderRadius: '6px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
                            취소
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px', color: '#555' }}>{e.received_at.slice(0, 10)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{fmt(e.quantity)}개</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#ef4444' }}>{fmt(e.unit_cost)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#f97316' }}>
                        {fmt(e.unit_shipping_fee)}
                        {e.shipping_group_name && <span style={{ marginLeft: '4px', fontSize: '9px', color: '#999' }}>({e.shipping_group_name})</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{fmt(e.selling_price)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {e.shipping_group_id
                          ? <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>그룹</span>
                          : <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>개별</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button onClick={() => startEdit(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={12} color="#999" /></button>
                          <button onClick={() => deleteEntry(e.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={12} color="#ef4444" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
                {addingNew && !editingId && (
                  <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                    {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee', 'selling_price'] as (keyof EntryForm)[]).map((field) => (
                      <td key={field} style={{ padding: '6px 8px' }}>
                        <input
                          type={field === 'received_at' ? 'date' : 'number'}
                          value={form[field]}
                          onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                          style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid #86efac', fontSize: '11px', boxSizing: 'border-box' }}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '6px 8px' }} colSpan={2}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={save} disabled={saving} style={{ padding: '4px 10px', borderRadius: '6px', background: '#16a34a', color: '#fff', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
                          {saving ? '저장중' : '저장'}
                        </button>
                        <button onClick={() => { setEditingId(null); setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '4px 8px', borderRadius: '6px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!addingNew && !editingId && (
            <button
              onClick={() => { setAddingNew(true); setForm(emptyForm()); }}
              style={{ width: '100%', marginTop: '12px', padding: '8px', borderRadius: '8px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '12px', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <Plus size={13} /> 새 입고 건 추가
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
