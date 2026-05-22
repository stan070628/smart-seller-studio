'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import SaleEntryPanel from './SaleEntryPanel';

interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
}

interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
}

function emptyForm(): EntryForm {
  return { received_at: new Date().toISOString().slice(0, 10), quantity: '', unit_cost: '', unit_shipping_fee: '0' };
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface FifoSummary {
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
}

interface Props {
  productId: string;
  productName: string;
  sellerProductId: number | null;
  vendorItemId?: number | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function CostEntryDrawer({ productId, productName, sellerProductId, vendorItemId, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<EntryForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [fifo, setFifo] = useState<FifoSummary>({ current_stock: 0, stock_value: 0, total_realized_profit: 0 });
  const [fifoVersion, setFifoVersion] = useState(0);
  // 입고 채널 선택 (윙+RG 동시 연결 상품에서만 사용)
  const [entryChannel, setEntryChannel] = useState<'rg' | 'wing'>('wing');

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/entries`);
      const json = await res.json();
      if (json.success) setEntries(json.data);
    } catch (e) {
      console.error('입고 내역 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const loadFifo = useCallback(async () => {
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/fifo-summary`);
      const json = await res.json();
      if (json.success) setFifo(json.data);
    } catch (e) {
      console.error('FIFO 요약 로드 실패:', e);
    }
  }, [productId, fifoVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { loadFifo(); }, [loadFifo]);

  // 상품 채널 연결 상태에 따라 기본 입고 채널 결정
  useEffect(() => {
    if (vendorItemId && !sellerProductId) setEntryChannel('rg');
    else setEntryChannel('wing');
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshAll() {
    loadEntries();
    setFifoVersion((v) => v + 1);
    onChanged();
  }

  async function save() {
    const qty = Math.round(Number(form.quantity) * 10) / 10;
    const cost = Math.round(Number(form.unit_cost));
    if (!form.received_at || qty <= 0) { alert('입고일과 수량을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const basePayload = { received_at: form.received_at, quantity: qty, unit_cost: cost, unit_shipping_fee: Math.round(Number(form.unit_shipping_fee)) };
      // 신규 입고 등록 시 채널 정보 포함
      const payload = editingId ? basePayload : { ...basePayload, channel: entryChannel };
      const url = editingId
        ? `/api/cost-management/entries/${editingId}`
        : `/api/cost-management/products/${productId}/entries`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        refreshAll();
        setEditingId(null);
        setAddingNew(false);
        setForm(emptyForm());
      } else {
        alert(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('이 입고 건을 삭제할까요?')) return;
    const res = await fetch(`/api/cost-management/entries/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) refreshAll();
    else alert(json.error ?? '삭제에 실패했습니다.');
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setAddingNew(false);
    setForm({ received_at: e.received_at.slice(0, 10), quantity: String(e.quantity), unit_cost: String(e.unit_cost), unit_shipping_fee: String(e.unit_shipping_fee) });
  }

  const canSave = !!form.received_at && Number(form.quantity) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ width: '900px', height: '100vh', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: '#18181b' }}>{productName}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={18} color="#52525b" />
          </button>
        </div>

        {/* FIFO 요약 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', padding: '14px 24px', flexShrink: 0 }}>
          {[
            { label: '현재 재고', value: `${fmt(fifo.current_stock)}개`, color: '#18181b' },
            { label: '실현손익', value: `${fmt(fifo.total_realized_profit)}원`, color: fifo.total_realized_profit >= 0 ? '#16a34a' : '#ef4444' },
            { label: '재고가치', value: `${fmt(fifo.stock_value)}원`, color: '#18181b' },
          ].map((c) => (
            <div key={c.label} style={{ background: '#f5f5f7', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#52525b', marginBottom: '3px' }}>{c.label}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* 좌우 분할 패널 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', flex: 1, overflow: 'hidden', borderTop: '1px solid #e5e5e5' }}>
          {/* 좌: 입고 내역 */}
          <div style={{ padding: '14px 16px 14px 24px', borderRight: '1px solid #e5e5e5', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#18181b', marginBottom: '8px' }}>📦 입고 내역</div>
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                    {['입고일', '수량', '단가', '배송비', 'RG배송비', ''].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: h === '입고일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: '#52525b' }}>불러오는 중...</td></tr>
                  ) : entries.map((e) => (
                    editingId === e.id ? (
                      <tr key={e.id} style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                        {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee'] as (keyof EntryForm)[]).map((field) => (
                          <td key={field} style={{ padding: '4px 6px' }}>
                            <input
                              type={field === 'received_at' ? 'date' : 'number'}
                              step={field === 'quantity' ? '0.1' : '1'}
                              value={form[field]}
                              onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                              style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
                            />
                          </td>
                        ))}
                        <td style={{ padding: '4px 6px' }}>
                          <div style={{ display: 'flex', gap: '3px' }}>
                            <button onClick={save} disabled={saving || !canSave} style={{ padding: '3px 7px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                              {saving ? '...' : '저장'}
                            </button>
                            <button onClick={() => { setEditingId(null); setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 8px', color: '#27272a' }}>{e.received_at.slice(0, 10)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#18181b' }}>{e.quantity.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}개</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>{fmt(e.unit_cost)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f97316' }}>
                          {fmt(e.unit_shipping_fee)}
                          {e.shipping_group_name && <span style={{ marginLeft: '3px', fontSize: '9px', color: '#999' }}>({e.shipping_group_name})</span>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: (e.unit_rg_shipping_fee ?? 0) > 0 ? '#0369a1' : '#ccc' }}>
                          {(e.unit_rg_shipping_fee ?? 0) > 0 ? fmt(e.unit_rg_shipping_fee) : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
                            <button onClick={() => startEdit(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={11} color="#6b7280" /></button>
                            <button onClick={() => deleteEntry(e.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={11} color="#ef4444" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                  {addingNew && !editingId && (
                    <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                      {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee'] as (keyof EntryForm)[]).map((field) => (
                        <td key={field} style={{ padding: '4px 6px' }}>
                          <input
                            type={field === 'received_at' ? 'date' : 'number'}
                            step={field === 'quantity' ? '0.1' : '1'}
                            value={form[field]}
                            onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                            style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '4px 6px' }}>
                        <div style={{ display: 'flex', gap: '3px' }}>
                          <button onClick={save} disabled={saving || !canSave} style={{ padding: '3px 7px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                            {saving ? '...' : '저장'}
                          </button>
                          <button onClick={() => { setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!addingNew && !editingId && (
              <button onClick={() => { setAddingNew(true); setForm(emptyForm()); }}
                style={{ width: '100%', marginTop: '8px', padding: '6px', borderRadius: '6px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '11px', color: '#27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <Plus size={11} /> 새 입고 건 추가
              </button>
            )}
            {/* 윙+RG 동시 연결 상품에서 새 입고 추가 시 입고 채널 선택 */}
            {addingNew && !editingId && sellerProductId && vendorItemId && (
              <div style={{ marginTop: 8, marginBottom: 4 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>입고 채널</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(['wing', 'rg'] as const).map((ch) => (
                    <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="radio"
                        name="entryChannel"
                        value={ch}
                        checked={entryChannel === ch}
                        onChange={() => setEntryChannel(ch)}
                      />
                      {ch === 'wing' ? '윙 보관 입고' : 'RG 창고 입고'}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 우: 판매 내역 */}
          <div style={{ padding: '14px 24px 14px 16px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <SaleEntryPanel
              productId={productId}
              sellerProductId={sellerProductId}
              vendorItemId={vendorItemId}
              onChanged={() => { setFifoVersion((v) => v + 1); onChanged(); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
