'use client';

import React, { useState, useEffect } from 'react';
import { X, Package, ChevronLeft } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { useDraftPersist, loadDraft } from '@/hooks/useDraftPersist';
import { ADD_PRODUCT_DRAFT_KEY } from './draft-keys';

/**
 * 2단계(원가 단위 설정)에서 입력하는 값만 초안으로 남긴다.
 * 1단계(쿠팡 등록상품 선택)는 매 마운트마다 새로 fetch하는 목록에서 클릭 한 번으로
 * 고르는 동작이라 되돌리는 비용이 거의 없고, 오래된 로컬 선택을 최신 목록과
 * 맞춰 복원하려 하면 already_registered 같은 표시가 어긋날 수 있다 — 그래서 뺐다.
 * selectedCoupang은 표시에 필요한 최소 정보(id·이름)만 남긴다.
 */
interface AddProductDraft {
  productName: string;
  feeRate: string;
  subdivisionUnit: string;
  selectedCoupangId: number | null;
  selectedCoupangName: string | null;
}

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
  already_registered?: boolean;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

type Step = 1 | 2;

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 상태
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [loadingCoupang, setLoadingCoupang] = useState(true);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  // undefined = 아직 선택 안 함, null = "쿠팡 없이 등록" 선택, 값 = 선택된 상품
  const [selectedCoupang, setSelectedCoupang] = useState<CoupangProduct | null | undefined>(undefined);

  // Step 2 상태
  const [productName, setProductName] = useState('');
  const [feeRate, setFeeRate] = useState('10.8');
  const [subdivisionUnit, setSubdivisionUnit] = useState('');
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

  // 2단계 입력 초안 복원 — 1단계 선택 목록(coupangProducts) fetch를 기다리지 않는다.
  // selectedCoupang은 표시용 최소 객체로 재구성한다.
  useEffect(() => {
    const saved = loadDraft<AddProductDraft>(ADD_PRODUCT_DRAFT_KEY);
    if (saved.productName === undefined) return;
    setProductName(saved.productName);
    if (saved.feeRate !== undefined) setFeeRate(saved.feeRate);
    if (saved.subdivisionUnit !== undefined) setSubdivisionUnit(saved.subdivisionUnit);
    setSelectedCoupang(
      saved.selectedCoupangId != null
        ? { seller_product_id: saved.selectedCoupangId, seller_product_name: saved.selectedCoupangName ?? '' }
        : null,
    );
    setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { clearNow: clearAddProductDraftNow } = useDraftPersist(
    ADD_PRODUCT_DRAFT_KEY,
    {
      productName,
      feeRate,
      subdivisionUnit,
      selectedCoupangId: selectedCoupang?.seller_product_id ?? null,
      selectedCoupangName: selectedCoupang?.seller_product_name ?? null,
    },
    step === 2,
  );

  function goToStep2(coupang: CoupangProduct | null) {
    setSelectedCoupang(coupang);
    setProductName(coupang?.seller_product_name ?? '');
    setFeeRate(coupang ? '10.8' : '');
    setStep(2);
  }

  async function add() {
    if (!productName.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        product_name: productName.trim(),
        ...(feeRate.trim() !== '' && { platform_fee_rate: Number(feeRate) / 100 }),
        ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        // selectedCoupang이 null이면 seller_product_id 생략 → DB DEFAULT(음수 가상 ID) 자동 부여
        ...(selectedCoupang != null && { seller_product_id: selectedCoupang.seller_product_id }),
      };

      const res = await fetch('/api/cost-management/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        clearAddProductDraftNow();
        onAdded();
        onClose();
      } else {
        toast.error(json.error ?? '상품 추가에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  const canSave = productName.trim().length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '420px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>

        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: '#52525b', display: 'flex', alignItems: 'center' }}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#18181b' }}>
              {step === 1
                ? '상품 추가'
                : selectedCoupang
                  ? selectedCoupang.seller_product_name
                  : '쿠팡 없이 등록'}
            </div>
            <div style={{ fontSize: '11px', color: '#52525b' }}>
              {step === 1 ? '쿠팡 등록상품을 선택하세요' : '원가 단위 설정'}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
            <X size={16} color="#52525b" />
          </button>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>

          {/* ── Step 1: 쿠팡 등록상품 선택 ── */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '8px' }}>
                쿠팡 등록상품 선택
              </div>
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #d4d4d8', borderRadius: '8px', marginBottom: '12px' }}>
                {loadingCoupang ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>로딩 중...</div>
                ) : coupangError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>상품 목록 로드 실패</div>
                    <div style={{ color: '#52525b', fontSize: '11px' }}>{coupangError}</div>
                  </div>
                ) : coupangProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>연동 가능한 상품이 없습니다</div>
                ) : coupangProducts.map((p) => {
                  const isSelected = selectedCoupang?.seller_product_id === p.seller_product_id;
                  return (
                    <div
                      key={p.seller_product_id}
                      onClick={() => setSelectedCoupang(p)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', fontSize: '12px',
                        borderBottom: '1px solid #f0f0f0',
                        background: isSelected ? '#fef2f2' : '#fff',
                        color: isSelected ? '#be0014' : '#18181b',
                        fontWeight: isSelected ? 600 : 400,
                        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>{p.seller_product_name}</span>
                      <span style={{ fontSize: '10px', color: '#71717a', flexShrink: 0 }}>
                        #{p.seller_product_id}
                      </span>
                      {p.already_registered && (
                        <span style={{ fontSize: '9px', color: '#f59e0b', background: '#fef3c7', padding: '1px 4px', borderRadius: 2, flexShrink: 0 }}>
                          추가 등록
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 쿠팡 없이 등록 링크 */}
              <div style={{ fontSize: '11px', color: '#71717a', textAlign: 'center', marginBottom: '16px' }}>
                또는{' '}
                <button
                  onClick={() => goToStep2(null)}
                  style={{ color: '#52525b', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                >
                  쿠팡 없이 등록 (가상 ID 자동 부여)
                </button>
              </div>

              <button
                onClick={() => selectedCoupang != null && goToStep2(selectedCoupang)}
                disabled={selectedCoupang == null}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: selectedCoupang != null ? '#be0014' : '#d4d4d4',
                  color: selectedCoupang != null ? '#fff' : '#525252',
                  fontSize: '13px', fontWeight: 600,
                  cursor: selectedCoupang != null ? 'pointer' : 'not-allowed',
                }}
              >
                다음 →
              </button>
            </div>
          )}

          {/* ── Step 2: 원가 단위 설정 ── */}
          {step === 2 && (
            <div>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>상품명</div>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="상품명을 입력하세요"
                  autoFocus
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>
                  플랫폼 수수료율 (%)
                </div>
                <input
                  type="number"
                  value={feeRate}
                  onChange={(e) => setFeeRate(e.target.value)}
                  step="0.1"
                  min="0"
                  max="50"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
                <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>
                  {selectedCoupang
                    ? '로켓그로스 기본 10.8% — 필요 시 수정하세요'
                    : '플랫폼 수수료율을 입력하세요'}
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>소분 갯수 (선택)</div>
                <input
                  type="number"
                  value={subdivisionUnit}
                  onChange={(e) => setSubdivisionUnit(e.target.value)}
                  step="1"
                  min="2"
                  placeholder="비워두면 소분 없음"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                />
                <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>
                  입력하면 입고 시 개당 원가를 자동 계산합니다
                </div>
              </div>

              <button
                onClick={add}
                disabled={saving || !canSave}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: canSave ? '#be0014' : '#d4d4d4',
                  color: canSave ? '#fff' : '#525252',
                  fontSize: '13px', fontWeight: 600,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? '추가 중...' : '추가'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
