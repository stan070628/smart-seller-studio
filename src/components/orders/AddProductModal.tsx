'use client';

import React, { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
}

type Mode = 'coupang' | 'manual';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>('coupang');
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [loadingCoupang, setLoadingCoupang] = useState(true);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  const [selectedCoupang, setSelectedCoupang] = useState<CoupangProduct | null>(null);
  const [manualName, setManualName] = useState('');
  const [feeRate, setFeeRate] = useState('10.8');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/cost-management/coupang-products')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setCoupangProducts(j.data);
        else setCoupangError(j.error ?? '상품 목록을 불러오지 못했습니다.');
      })
      .catch(() => setCoupangError('네트워크 오류가 발생했습니다.'))
      .finally(() => setLoadingCoupang(false));
  }, []);

  async function add() {
    const isCoupang = mode === 'coupang' && selectedCoupang;
    const isManual = mode === 'manual' && manualName.trim();
    if (!isCoupang && !isManual) return;

    setSaving(true);
    try {
      const body = isCoupang
        ? { product_name: selectedCoupang!.seller_product_name, seller_product_id: selectedCoupang!.seller_product_id, platform_fee_rate: Number(feeRate) / 100 }
        : { product_name: manualName.trim(), platform_fee_rate: Number(feeRate) / 100 };

      const res = await fetch('/api/cost-management/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) { onAdded(); onClose(); } else { alert(json.error ?? '상품 추가에 실패했습니다.'); }
    } finally {
      setSaving(false);
    }
  }

  const canSave = mode === 'coupang' ? !!selectedCoupang : manualName.trim().length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '420px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>상품 추가</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>원가 관리할 상품을 선택하거나 직접 입력하세요</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>
          <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '10px', background: '#f5f5f7', marginBottom: '16px' }}>
            {(['coupang', 'manual'] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '8px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: mode === m ? 600 : 500, color: mode === m ? '#be0014' : '#71717a', background: mode === m ? '#fff' : 'transparent', cursor: 'pointer', boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                {m === 'coupang' ? '쿠팡 등록 상품' : '직접 입력'}
              </button>
            ))}
          </div>

          {mode === 'coupang' ? (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>쿠팡 등록 상품 선택</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: '8px' }}>
                {loadingCoupang ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>로딩중...</div>
                ) : coupangError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>상품 목록 로드 실패</div>
                    <div style={{ color: '#999', fontSize: '11px' }}>{coupangError}</div>
                  </div>
                ) : coupangProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>연동 가능한 상품이 없습니다</div>
                ) : coupangProducts.map((p) => (
                  <div
                    key={p.seller_product_id}
                    onClick={() => setSelectedCoupang(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f0f0f0', background: selectedCoupang?.seller_product_id === p.seller_product_id ? '#fef2f2' : '#fff', color: selectedCoupang?.seller_product_id === p.seller_product_id ? '#be0014' : '#18181b', fontWeight: selectedCoupang?.seller_product_id === p.seller_product_id ? 600 : 400 }}
                  >
                    {p.seller_product_name}
                    <span style={{ fontSize: '10px', color: '#999', marginLeft: '8px' }}>#{p.seller_product_id}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>상품명</div>
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="상품명을 입력하세요" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
            </div>
          )}

          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>플랫폼 수수료율 (%)</div>
            <input type="number" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} step="0.1" min="0" max="50" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>로켓그로스 기본 10.8% — 필요 시 수정하세요</div>
          </div>

          <button
            onClick={add}
            disabled={saving || !canSave}
            style={{ width: '100%', marginTop: '20px', padding: '10px', borderRadius: '8px', border: 'none', background: canSave ? '#be0014' : '#e5e5e5', color: canSave ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '추가 중...' : '상품 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}
