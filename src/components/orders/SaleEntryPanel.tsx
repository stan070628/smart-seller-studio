'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, CloudDownload } from 'lucide-react';
import { buildSalePayload } from './sale-payload';

interface DownloadCouponPolicy {
  rate: number;
  max_discount: number;
  min_price: number;
}

interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  coupon_discount: number;
  channel: string;
  coupang_order_item_id: string | null;
  variant_name?: string | null;
  shipping_fee: number;
}

interface SaleForm {
  sold_at: string;
  quantity: string;
  selling_price: string;
  shipping_fee: string;
  coupon_discount: string;
  channel: string;
}

function emptyForm(): SaleForm {
  return {
    sold_at: new Date().toISOString().slice(0, 10),
    quantity: '',
    selling_price: '',
    shipping_fee: '0',
    coupon_discount: '0',
    channel: 'manual',
  };
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface ImportForm {
  from: string;
  to: string;
}

interface Props {
  productId: string;
  sellerProductId: number | null;
  vendorItemId?: number | null;
  naverChannelProductNo?: number | null;
  downloadCouponPolicy?: DownloadCouponPolicy | null;
  onChanged: () => void;
}

export default function SaleEntryPanel({ productId, sellerProductId, vendorItemId, naverChannelProductNo, downloadCouponPolicy, onChanged }: Props) {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<SaleForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importForm, setImportForm] = useState<ImportForm>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  const [couponPolicy, setCouponPolicy] = useState<DownloadCouponPolicy | null>(
    downloadCouponPolicy ?? null
  );
  const [couponPolicyForm, setCouponPolicyForm] = useState({
    rate: String(Math.round((downloadCouponPolicy?.rate ?? 0.10) * 100)),
    max_discount: String(downloadCouponPolicy?.max_discount ?? 1000),
    min_price: String(downloadCouponPolicy?.min_price ?? 30000),
  });
  const [showCouponPolicyForm, setShowCouponPolicyForm] = useState(false);
  const [savingCouponPolicy, setSavingCouponPolicy] = useState(false);

  // 쿠폰 자동완성
  type CouponItem = { couponId: number; promotionName: string; type: string; discount: number; endAt: string };
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [coupons, setCoupons] = useState<{ matched: CouponItem[]; all: CouponItem[] } | null>(null);

  async function loadCoupons() {
    if (loadingCoupons) return;
    setLoadingCoupons(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/coupang-coupons`);
      const json = await res.json();
      if (json.success) setCoupons(json.data);
      else alert(json.error ?? '쿠폰 조회 실패');
    } catch {
      alert('쿠폰 조회 중 오류가 발생했습니다.');
    } finally {
      setLoadingCoupons(false);
    }
  }

  function applyCoupon(c: CouponItem) {
    if (c.type === 'PRICE') {
      // 정액 쿠폰: rate=100%(=1)로 고정, max_discount=할인금액, min_price는 직접 입력
      setCouponPolicyForm((f) => ({ ...f, rate: '100', max_discount: String(c.discount) }));
    } else {
      // RATE 쿠폰: 이름만 표시, 사용자가 직접 % 입력
      alert(`"${c.promotionName}" — 정률 쿠폰입니다.\n할인율(%)과 최소구매금액을 직접 입력해 주세요.`);
    }
    setCoupons(null);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/sales`);
      const json = await res.json();
      if (json.success) setSales(json.data);
    } catch (e) {
      console.error('판매 내역 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  // downloadCouponPolicy prop이 변경될 때 내부 상태 동기화
  useEffect(() => {
    setCouponPolicy(downloadCouponPolicy ?? null);
    setCouponPolicyForm({
      rate: String(Math.round((downloadCouponPolicy?.rate ?? 0.10) * 100)),
      max_discount: String(downloadCouponPolicy?.max_discount ?? 1000),
      min_price: String(downloadCouponPolicy?.min_price ?? 30000),
    });
  }, [downloadCouponPolicy]);

  async function save() {
    const payload = buildSalePayload(form);
    if (!form.sold_at || payload.quantity <= 0) { alert('판매일과 수량을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const url = editingId
        ? `/api/cost-management/sales/${editingId}`
        : `/api/cost-management/products/${productId}/sales`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        await load();
        onChanged();
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

  async function deleteSale(id: string) {
    if (!confirm('이 판매 건을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/cost-management/sales/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { await load(); onChanged(); }
      else alert(json.error ?? '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(s: SaleRecord) {
    setEditingId(s.id);
    setAddingNew(false);
    setForm({
      sold_at: s.sold_at.slice(0, 10),
      quantity: String(s.quantity),
      selling_price: String(s.selling_price),
      shipping_fee: String(s.shipping_fee),
      coupon_discount: String(s.coupon_discount ?? 0),
      channel: s.channel ?? 'manual',
    });
  }

  async function saveCouponPolicy() {
    const rate = Number(couponPolicyForm.rate) / 100;
    const max_discount = Math.round(Number(couponPolicyForm.max_discount));
    const min_price = Math.round(Number(couponPolicyForm.min_price));
    if (rate <= 0 || rate > 1 || max_discount <= 0 || min_price < 0) {
      alert('다운로드쿠폰 정책 값이 올바르지 않습니다.');
      return;
    }
    setSavingCouponPolicy(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ download_coupon_policy: { rate, max_discount, min_price } }),
      });
      const json = await res.json();
      if (json.success) {
        setCouponPolicy({ rate, max_discount, min_price });
        setShowCouponPolicyForm(false);
        alert('다운로드쿠폰 정책이 저장되었습니다. 재임포트 시 적용됩니다.');
      } else {
        alert(json.error ?? '저장 실패');
      }
    } finally {
      setSavingCouponPolicy(false);
    }
  }

  async function runImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/coupang-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importForm),
      });
      const json = await res.json();
      if (json.success) {
        const { imported, skipped } = json.data;
        alert(`${imported}건 가져옴, ${skipped}건 중복 스킵`);
        await load();
        onChanged();
        setShowImportForm(false);
      } else {
        alert(json.error ?? '가져오기에 실패했습니다.');
      }
    } finally {
      setImporting(false);
    }
  }

  const canSave = !!form.sold_at && Number(form.quantity) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 헤더: 타이틀 + 쿠팡 가져오기 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#18181b' }}>💰 판매 내역</span>
        {(sellerProductId || vendorItemId || naverChannelProductNo) && (
          <button
            onClick={() => setShowImportForm((v) => !v)}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: '11px', cursor: 'pointer' }}
          >
            <CloudDownload size={12} /> 판매 가져오기
          </button>
        )}
      </div>

      {/* 쿠팡 날짜 범위 입력 폼 */}
      {showImportForm && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', padding: '10px', marginBottom: '8px', fontSize: '11px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={importForm.from} onChange={(e) => setImportForm((f) => ({ ...f, from: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <span style={{ color: '#64748b' }}>~</span>
            <input type="date" value={importForm.to} onChange={(e) => setImportForm((f) => ({ ...f, to: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <button onClick={runImport} disabled={importing}
              style={{ padding: '3px 10px', borderRadius: '4px', background: '#1d4ed8', color: '#fff', border: 'none', fontSize: '11px', cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? '가져오는 중...' : '실행'}
            </button>
          </div>
        </div>
      )}

      {/* 다운로드쿠폰 정책 설정 */}
      {(sellerProductId || vendorItemId) && (
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={() => setShowCouponPolicyForm((v) => !v)}
            style={{ fontSize: '10px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
          >
            🏷️ 다운로드쿠폰 정책 {couponPolicy ? `(${Math.round(couponPolicy.rate * 100)}%, 최대 ${fmt(couponPolicy.max_discount)}원)` : '(미설정)'}
          </button>
          {showCouponPolicyForm && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '6px', padding: '8px', fontSize: '11px', marginTop: '4px' }}>
              {/* 쿠폰 불러오기 */}
              <div style={{ marginBottom: '6px' }}>
                <button
                  onClick={loadCoupons}
                  disabled={loadingCoupons}
                  style={{ padding: '3px 10px', borderRadius: '4px', background: '#fff', border: '1px solid #fcd34d', fontSize: '10px', cursor: loadingCoupons ? 'not-allowed' : 'pointer', color: '#92400e' }}
                >
                  {loadingCoupons ? '조회 중...' : '🔍 쿠팡 쿠폰 불러오기'}
                </button>
              </div>

              {/* 쿠폰 목록 */}
              {coupons && (
                <div style={{ marginBottom: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid #fcd34d', borderRadius: '4px', background: '#fff' }}>
                  {(coupons.matched.length > 0 ? coupons.matched : coupons.all).length === 0 ? (
                    <div style={{ padding: '8px', color: '#92400e', fontSize: '10px' }}>활성 쿠폰 없음</div>
                  ) : (
                    <>
                      {coupons.matched.length > 0 && (
                        <div style={{ padding: '4px 8px', background: '#fef9c3', fontSize: '9px', color: '#713f12' }}>상품명 매칭 쿠폰</div>
                      )}
                      {(coupons.matched.length > 0 ? coupons.matched : coupons.all).map((c) => (
                        <div
                          key={c.couponId}
                          onClick={() => applyCoupon(c)}
                          style={{ padding: '6px 8px', borderBottom: '1px solid #fef9c3', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: '#18181b', fontSize: '10px' }}>{c.promotionName}</span>
                            <span style={{ marginLeft: '6px', fontSize: '9px', color: c.type === 'PRICE' ? '#16a34a' : '#2563eb', background: c.type === 'PRICE' ? '#dcfce7' : '#dbeafe', padding: '1px 4px', borderRadius: '2px' }}>
                              {c.type === 'PRICE' ? `${c.discount.toLocaleString()}원 정액` : '정률(%)'}
                            </span>
                          </div>
                          <span style={{ fontSize: '9px', color: '#9ca3af' }}>~{c.endAt.slice(0, 10)}</span>
                        </div>
                      ))}
                      {coupons.matched.length > 0 && coupons.all.length > coupons.matched.length && (
                        <div
                          onClick={() => setCoupons((prev) => prev ? { matched: [], all: prev.all } : null)}
                          style={{ padding: '4px 8px', fontSize: '9px', color: '#6b7280', cursor: 'pointer', textAlign: 'center' }}
                        >
                          전체 쿠폰 보기 ({coupons.all.length}개) ▼
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 입력 필드 */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label>할인율(%)<input type="number" value={couponPolicyForm.rate} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, rate: e.target.value }))}
                  style={{ width: '50px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
                <label>최대할인(원)<input type="number" value={couponPolicyForm.max_discount} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, max_discount: e.target.value }))}
                  style={{ width: '70px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
                <label>최소구매(원)<input type="number" value={couponPolicyForm.min_price} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, min_price: e.target.value }))}
                  style={{ width: '70px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
                <button onClick={saveCouponPolicy} disabled={savingCouponPolicy}
                  style={{ padding: '3px 10px', borderRadius: '4px', background: '#d97706', color: '#fff', border: 'none', fontSize: '11px', cursor: savingCouponPolicy ? 'not-allowed' : 'pointer' }}>
                  {savingCouponPolicy ? '저장중...' : '저장'}
                </button>
              </div>
              <p style={{ margin: '4px 0 0', color: '#92400e', fontSize: '10px' }}>
                정액 쿠폰 선택 시 할인율 100% 자동설정 · 최소구매금액은 직접 입력 · 저장 후 재임포트 시 적용
              </p>
            </div>
          )}
        </div>
      )}

      {/* 판매 목록 테이블 */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              {['판매일', '수량', '판매가', '쿠폰할인', '채널', '사이즈', '택배비', ''].map((h, i) => (
                <th key={`${h}-${i}`} style={{ padding: '6px 8px', textAlign: h === '판매일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: '#52525b' }}>불러오는 중...</td></tr>
            ) : sales.map((s) => (
              editingId === s.id ? (
                // 인라인 편집 행
                <tr key={s.id} style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="date" value={form.sold_at} onChange={(e) => setForm((f) => ({ ...f, sold_at: e.target.value }))}
                      style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                      style={{ width: '60px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
                      style={{ width: '80px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" min="0" value={form.coupon_discount}
                      onChange={(e) => setForm((f) => ({ ...f, coupon_discount: e.target.value }))}
                      style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select value={form.channel}
                      onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                      style={{ padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}>
                      <option value="coupang">쿠팡윙</option>
                      <option value="rocket_growth">로켓그로스</option>
                      <option value="naver">네이버</option>
                      <option value="manual">수동</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }} />
                  <td style={{ padding: '4px 6px' }}>
                    <input
                      type="number"
                      value={form.shipping_fee}
                      onChange={(e) => setForm((f) => ({ ...f, shipping_fee: e.target.value }))}
                      style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}
                    />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={save} disabled={saving || !canSave}
                        style={{ padding: '3px 8px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '11px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                        {saving ? '저장중' : '저장'}
                      </button>
                      <button onClick={() => { setEditingId(null); setForm(emptyForm()); }}
                        style={{ padding: '3px 8px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer', color: '#27272a' }}>
                        취소
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                // 일반 표시 행
                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px', color: '#27272a' }}>{s.sold_at.slice(0, 10)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#18181b' }}>{fmt(s.quantity)}개</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#2563eb' }}>{fmt(s.selling_price)}</td>
                  {/* 쿠폰할인 */}
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: (s.coupon_discount ?? 0) > 0 ? '#dc2626' : '#e5e5e5', fontSize: '11px' }}>
                    {(s.coupon_discount ?? 0) > 0 ? `-${fmt(s.coupon_discount)}` : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {s.channel === 'coupang'
                      ? <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>쿠팡</span>
                      : s.channel === 'rocket_growth'
                      ? <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>로켓그로스</span>
                      : s.channel === 'naver'
                      ? <span style={{ background: '#f0fff8', color: '#03c75a', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>네이버</span>
                      : <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>직접</span>}
                  </td>
                  {/* 사이즈(variant_name) 배지 */}
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {s.variant_name
                      ? <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{s.variant_name}</span>
                      : <span style={{ color: '#e5e5e5', fontSize: '10px' }}>—</span>}
                  </td>
                  {/* 택배비 */}
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: s.shipping_fee > 0 ? '#27272a' : '#e5e5e5', fontSize: '11px' }}>
                    {s.shipping_fee > 0 ? fmt(s.shipping_fee) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                      <button onClick={() => startEdit(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={12} color="#6b7280" /></button>
                      <button onClick={() => deleteSale(s.id)} disabled={deletingId === s.id} style={{ border: 'none', background: 'none', cursor: deletingId === s.id ? 'not-allowed' : 'pointer', padding: '2px', opacity: deletingId === s.id ? 0.4 : 1 }}><Trash2 size={12} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {/* 새 판매 추가 인라인 행 */}
            {addingNew && !editingId && (
              <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                <td style={{ padding: '4px 6px' }}>
                  <input type="date" value={form.sold_at} onChange={(e) => setForm((f) => ({ ...f, sold_at: e.target.value }))}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    style={{ width: '60px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
                    style={{ width: '80px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td colSpan={3} style={{ padding: '4px 6px' }}>
                  {/* 쿠폰할인/채널/사이즈는 새 추가 시 자동 지정 — 빈 셀 */}
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input
                    type="number"
                    value={form.shipping_fee}
                    onChange={(e) => setForm((f) => ({ ...f, shipping_fee: e.target.value }))}
                    style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}
                  />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={save} disabled={saving || !canSave}
                      style={{ padding: '3px 8px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '11px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                      {saving ? '저장중' : '저장'}
                    </button>
                    <button onClick={() => { setAddingNew(false); setForm(emptyForm()); }}
                      style={{ padding: '3px 8px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer', color: '#27272a' }}>
                      취소
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 판매 추가 버튼 — 편집/추가 모드가 아닐 때만 표시 */}
      {!addingNew && !editingId && (
        <button
          onClick={() => { setAddingNew(true); setForm(emptyForm()); }}
          style={{ width: '100%', marginTop: '8px', padding: '7px', borderRadius: '6px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '11px', color: '#27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
        >
          <Plus size={12} /> 판매 추가
        </button>
      )}
    </div>
  );
}
