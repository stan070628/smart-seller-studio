'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import SaleEntryPanel from './SaleEntryPanel';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { useDraftPersist, loadDraft } from '@/hooks/useDraftPersist';
import { costEntryDraftKey } from './draft-keys';

interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
  purchase_quantity: number | null;   // 소분: 사입 총량
  subdivision_unit: number | null;    // 소분: 소분 단위
  variant_name?: string | null;
}

interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
  variant_name: string;
}

function emptyForm(): EntryForm {
  return { received_at: new Date().toISOString().slice(0, 10), quantity: '', unit_cost: '', unit_shipping_fee: '0', variant_name: '' };
}

interface SubForm {
  received_at: string;
  boxPrice: string;       // 포장당 가격(원)
  itemsPerBox: string;    // 포장당 개수(개)
  boxQuantity: string;    // 포장 수량(개)
  subUnit: string;
  unit_shipping_fee: string;
  unit_rg_shipping_fee: string;
}

function emptySubForm(subdivisionUnit?: number | null): SubForm {
  return {
    received_at: new Date().toISOString().slice(0, 10),
    boxPrice: '',
    itemsPerBox: '',
    boxQuantity: '1',
    subUnit: subdivisionUnit ? String(subdivisionUnit) : '',
    unit_shipping_fee: '0',
    unit_rg_shipping_fee: '0',
  };
}

/** localStorage에 저장·복원하는 초안 — "새 입고 건 추가" 진행 중일 때만 의미가 있다.
 *  기존 건 수정(editingId)은 담지 않는다: 수정은 이미 값이 채워진 행을 잠깐 고치는
 *  작업이라 되돌리는 비용이 낮고, 서버에서 그 사이 삭제된 건을 가리킬 위험까지
 *  감수할 이유가 없다. */
interface CostEntryDraft {
  entryType: 'normal' | 'subdivision';
  form: EntryForm;
  subForm: SubForm;
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
  naverChannelProductNo?: number | null;
  subdivisionUnit?: number | null;   // 소분 단위 (>0 이면 소분 상품)
  variants?: Record<string, string> | null;
  downloadCouponPolicy?: { rate: number; max_discount: number; min_price: number; } | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function CostEntryDrawer({ productId, productName, sellerProductId, vendorItemId, naverChannelProductNo, subdivisionUnit, variants, downloadCouponPolicy, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [entryType, setEntryType] = useState<'normal' | 'subdivision'>('normal');
  const [form, setForm] = useState<EntryForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [fifo, setFifo] = useState<FifoSummary>({ current_stock: 0, stock_value: 0, total_realized_profit: 0 });
  const [fifoVersion, setFifoVersion] = useState(0);

  const [carryoverWarning, setCarryoverWarning] = useState(false);

  // 소분 모드 전용 상태
  const [subForm, setSubForm] = useState<SubForm>(emptySubForm(subdivisionUnit));
  const [carryoverMeta, setCarryoverMeta] = useState({ quantity: 0, unitCost: 0 });

  const isSubdivisionProduct = (subdivisionUnit ?? 0) > 0;

  // ── 초안 저장/복원 ──────────────────────────────────────────────
  // 드로어 자체(열림 상태)는 CostManagementTab의 drawerProductId가 관리하고,
  // 그 값은 일부러 복원하지 않는다(모달이 갑자기 뜨면 놀란다) — 여기서는
  // "addingNew=true로 새 입고 건을 쓰던 중" 그 내용만 살린다.
  const draftKey = costEntryDraftKey(productId);

  useEffect(() => {
    const saved = loadDraft<CostEntryDraft>(draftKey);
    if (saved.form || saved.subForm) {
      setAddingNew(true);
      setEntryType(isSubdivisionProduct ? (saved.entryType ?? 'subdivision') : (saved.entryType ?? 'normal'));
      if (saved.form) setForm(saved.form);
      if (saved.subForm) setSubForm(saved.subForm);
    }
    // 마운트 시 한 번만 복원 — 지연 초기화(useState(() => ...))를 쓰지 않고
    // 마운트 후 effect에서 복원한다(계산기 작업 82de74fe에서 지연 초기화가
    // 하이드레이션을 깬 교훈).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const { clearNow: clearDraftNow } = useDraftPersist(draftKey, { entryType, form, subForm }, addingNew);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/entries`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data);
        if (json.meta) {
          setCarryoverMeta({
            quantity: json.meta.subdivision_carryover ?? 0,
            unitCost: json.meta.subdivision_carryover_unit_cost ?? 0,
          });
        }
      }
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

  function refreshAll() {
    loadEntries();
    setFifoVersion((v) => v + 1);
    onChanged();
  }

  // 소분 미리보기 계산 (실시간)
  const subPreview = (() => {
    const bp = Number(subForm.boxPrice);
    const ipb = Number(subForm.itemsPerBox);
    const bq = Number(subForm.boxQuantity) || 1;
    const su = Number(subForm.subUnit);
    if (bp > 0 && ipb > 0 && bq > 0 && su >= 1) {
      return calculateSubdivision({
        purchaseQuantity: ipb * bq,
        totalPurchaseCost: bp * bq,
        subdivisionUnit: su,
        carryoverQuantity: carryoverMeta.quantity,
        carryoverUnitCost: carryoverMeta.unitCost,
      });
    }
    return null;
  })();

  async function save() {
    const qty = Math.round(Number(form.quantity) * 10) / 10;
    const cost = Math.round(Number(form.unit_cost));
    if (!form.received_at || qty <= 0) { toast.error('입고일과 수량을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const basePayload = {
        received_at: form.received_at,
        quantity: qty,
        unit_cost: cost,
        unit_shipping_fee: Math.round(Number(form.unit_shipping_fee)),
        ...(form.variant_name ? { variant_name: form.variant_name } : {}),
      };
      const payload = basePayload;
      const url = editingId
        ? `/api/cost-management/entries/${editingId}`
        : `/api/cost-management/products/${productId}/entries`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        if (json.warning === 'subdivision_carryover_stale') setCarryoverWarning(true);
        refreshAll();
        setEditingId(null);
        setAddingNew(false);
        setEntryType('normal');
        setForm(emptyForm());
        clearDraftNow();
      } else {
        toast.error(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveSubdivision() {
    const bp = Number(subForm.boxPrice);
    const ipb = Number(subForm.itemsPerBox);
    const bq = Number(subForm.boxQuantity) || 1;
    const su = Number(subForm.subUnit);
    if (!subForm.received_at || !subPreview || subPreview.sellablePacks === 0) {
      toast.error('입고일, 포장당 가격/개수, 소분 갯수를 올바르게 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        received_at: subForm.received_at,
        unit_cost: Math.round(bp * bq),
        purchase_quantity: Math.round(ipb * bq),
        subdivision_unit: Math.round(su),
        unit_shipping_fee: Math.round(Number(subForm.unit_shipping_fee)),
        unit_rg_shipping_fee: Math.round(Number(subForm.unit_rg_shipping_fee)),
      };
      const res = await fetch(`/api/cost-management/products/${productId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        refreshAll();
        setAddingNew(false);
        setEntryType('normal');
        setSubForm(emptySubForm(subdivisionUnit));
        clearDraftNow();
      } else {
        toast.error(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!(await confirmDialog({ message: '이 입고 건을 삭제할까요?', danger: true }))) return;
    const res = await fetch(`/api/cost-management/entries/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      if (json.warning === 'subdivision_carryover_stale') setCarryoverWarning(true);
      refreshAll();
    } else {
      toast.error(json.error ?? '삭제에 실패했습니다.');
    }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setAddingNew(false);
    setForm({ received_at: e.received_at.slice(0, 10), quantity: String(e.quantity), unit_cost: String(e.unit_cost), unit_shipping_fee: String(e.unit_shipping_fee), variant_name: e.variant_name ?? '' });
  }

  const canSave = !!form.received_at && Number(form.quantity) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ width: '1100px', height: '100vh', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: '#18181b' }}>{productName}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={18} color="#52525b" />
          </button>
        </div>

        {/* 소분 이월 경고 배너 */}
        {carryoverWarning && (
          <div style={{ padding: '8px 24px', background: '#fef3c7', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: '12px', color: '#92400e' }}>소분 입고 건을 수정/삭제하면 이월 잔여가 부정확해질 수 있습니다. 이월값을 확인하세요.</span>
            <button onClick={() => setCarryoverWarning(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '12px', color: '#92400e', padding: '0 4px' }}>✕</button>
          </div>
        )}

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
        <div style={{ display: 'grid', gridTemplateColumns: '560px 1fr', gap: '0', flex: 1, overflow: 'hidden', borderTop: '1px solid #e5e5e5' }}>
          {/* 좌: 입고 내역 */}
          <div style={{ padding: '14px 16px 14px 24px', borderRight: '1px solid #e5e5e5', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#18181b', marginBottom: '8px' }}>📦 입고 내역</div>
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                    {['입고일', '수량', '단가', '배송비', 'RG배송비', ...(variants ? ['사이즈'] : []), ''].map((h) => (
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
                            <button onClick={() => { setEditingId(null); setAddingNew(false); setEntryType('normal'); setForm(emptyForm()); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 8px', color: '#27272a' }}>{e.received_at.slice(0, 10)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#18181b' }}>
                          {e.quantity.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{e.purchase_quantity ? '팩' : '개'}
                          {e.purchase_quantity && <div style={{ fontSize: '9px', color: '#92400e', fontWeight: 400 }}>사입{e.purchase_quantity}/소분{e.subdivision_unit}</div>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>{fmt(e.unit_cost)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f97316' }}>
                          {fmt(e.unit_shipping_fee)}
                          {e.shipping_group_name && <span style={{ marginLeft: '3px', fontSize: '9px', color: '#999' }}>({e.shipping_group_name})</span>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: (e.unit_rg_shipping_fee ?? 0) > 0 ? '#0369a1' : '#ccc' }}>
                          {(e.unit_rg_shipping_fee ?? 0) > 0 ? fmt(e.unit_rg_shipping_fee) : '—'}
                        </td>
                        {variants && (
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {e.variant_name
                              ? <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '1px 5px', borderRadius: '4px', fontSize: '9px' }}>{e.variant_name}</span>
                              : <span style={{ color: '#e5e5e5', fontSize: '9px' }}>—</span>}
                          </td>
                        )}
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
                    <tr>
                      <td colSpan={6} style={{ padding: '6px 10px 2px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {(['normal', 'subdivision'] as const).map((t) => (
                            <button
                              key={t}
                              onClick={() => setEntryType(t)}
                              style={{
                                padding: '3px 10px',
                                borderRadius: '4px',
                                border: `1px solid ${entryType === t ? (t === 'subdivision' ? '#fb923c' : '#86efac') : '#e5e5e5'}`,
                                background: entryType === t ? (t === 'subdivision' ? '#fff7ed' : '#f0fdf4') : '#fff',
                                color: entryType === t ? (t === 'subdivision' ? '#c2410c' : '#16a34a') : '#71717a',
                                fontSize: '10px',
                                fontWeight: entryType === t ? 700 : 400,
                                cursor: 'pointer',
                              }}
                            >
                              {t === 'normal' ? '일반 입고' : '소분 입고'}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  {addingNew && !editingId && entryType === 'subdivision' && (
                    <tr style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
                      <td colSpan={6} style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>입고일</div>
                            <input type="date" value={subForm.received_at} onChange={(e) => setSubForm((f) => ({ ...f, received_at: e.target.value }))} style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>포장당 가격(원)</div>
                            <input type="number" value={subForm.boxPrice} onChange={(e) => setSubForm((f) => ({ ...f, boxPrice: e.target.value }))} placeholder="예: 21490" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>포장당 개수(개)</div>
                            <input type="number" value={subForm.itemsPerBox} onChange={(e) => setSubForm((f) => ({ ...f, itemsPerBox: e.target.value }))} placeholder="예: 36" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>포장 수량(개)</div>
                            <input type="number" value={subForm.boxQuantity} onChange={(e) => setSubForm((f) => ({ ...f, boxQuantity: e.target.value }))} placeholder="1" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>소분 갯수(개)</div>
                            <input type="number" value={subForm.subUnit} onChange={(e) => setSubForm((f) => ({ ...f, subUnit: e.target.value }))} placeholder="예: 10" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>배송비(원)</div>
                            <input type="number" value={subForm.unit_shipping_fee} onChange={(e) => setSubForm((f) => ({ ...f, unit_shipping_fee: e.target.value }))} style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>RG 배송비(원)</div>
                            <input type="number" value={subForm.unit_rg_shipping_fee} onChange={(e) => setSubForm((f) => ({ ...f, unit_rg_shipping_fee: e.target.value }))} style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                        </div>
                        {Number(subForm.boxPrice) > 0 && Number(subForm.itemsPerBox) > 0 && (
                          <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '4px' }}>
                            총 구매가 {fmt(Number(subForm.boxPrice) * (Number(subForm.boxQuantity) || 1))}원 / 총 {Number(subForm.itemsPerBox) * (Number(subForm.boxQuantity) || 1)}개
                          </div>
                        )}
                        {subPreview && (
                          <div style={{ background: '#fff', borderRadius: '6px', padding: '6px 8px', fontSize: '10px', color: '#27272a', border: '1px solid #fed7aa', marginBottom: '6px' }}>
                            {carryoverMeta.quantity > 0 && (
                              <span style={{ color: '#92400e', marginRight: '10px' }}>이월 {carryoverMeta.quantity}개 포함 →</span>
                            )}
                            <span>총 {subPreview.totalAvailable}개</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>판매 {subPreview.sellablePacks}팩</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span>팩당 {fmt(subPreview.packUnitCost)}원</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span style={{ color: '#f97316' }}>새 이월 {subPreview.newCarryoverQuantity}개</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <button onClick={saveSubdivision} disabled={saving || !subPreview || subPreview.sellablePacks === 0} style={{ padding: '3px 10px', borderRadius: '4px', background: subPreview && subPreview.sellablePacks > 0 ? '#16a34a' : '#d4d4d4', color: subPreview && subPreview.sellablePacks > 0 ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: 'pointer' }}>
                            {saving ? '...' : '저장'}
                          </button>
                          <button onClick={() => { setAddingNew(false); setEntryType('normal'); clearDraftNow(); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {addingNew && !editingId && entryType === 'normal' && (
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
                      {variants && Object.keys(variants).length > 0 && (
                        <td style={{ padding: '4px 6px' }}>
                          <select
                            value={form.variant_name}
                            onChange={(ev) => setForm((f) => ({ ...f, variant_name: ev.target.value }))}
                            style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
                          >
                            <option value="">미분류</option>
                            {Object.values(variants).map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td style={{ padding: '4px 6px' }}>
                        <div style={{ display: 'flex', gap: '3px' }}>
                          <button onClick={save} disabled={saving || !canSave} style={{ padding: '3px 7px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                            {saving ? '...' : '저장'}
                          </button>
                          <button onClick={() => { setAddingNew(false); setForm(emptyForm()); clearDraftNow(); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!addingNew && !editingId && (
              <button onClick={() => { setAddingNew(true); setForm(emptyForm()); setEntryType(isSubdivisionProduct ? 'subdivision' : 'normal'); }}
                style={{ width: '100%', marginTop: '8px', padding: '6px', borderRadius: '6px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '11px', color: '#27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <Plus size={11} /> 새 입고 건 추가
              </button>
            )}
          </div>

          {/* 우: 판매 내역 */}
          <div style={{ padding: '14px 24px 14px 16px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <SaleEntryPanel
              productId={productId}
              sellerProductId={sellerProductId}
              vendorItemId={vendorItemId}
              naverChannelProductNo={naverChannelProductNo}
              downloadCouponPolicy={downloadCouponPolicy ?? null}
              onChanged={() => { setFifoVersion((v) => v + 1); onChanged(); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
