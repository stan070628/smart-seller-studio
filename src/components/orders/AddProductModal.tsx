'use client';

import React, { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
}

interface CoupangOption {
  vendorItemId: string;   // Task 2에서 string으로 변경됨
  itemName: string;
  salePrice: number;
  alreadyAdded: boolean;  // 이미 추가된 옵션 여부
}

interface RgProduct {
  vendor_item_id: number;
  product_name: string;
}

interface NaverProduct {
  originProductNo: number;
  name: string;
}

type Mode = 'coupang' | 'rg' | 'naver' | 'manual';

function loadTabProducts<T>(
  url: string,
  extract: (json: Record<string, unknown>) => T[],
  setItems: (items: T[]) => void,
  setLoading: (v: boolean) => void,
  setError: (v: string | null) => void,
  fallbackError: string,
): void {
  setLoading(true);
  fetch(url)
    .then((r) => r.json())
    .then((j: Record<string, unknown>) => {
      if (j.success) setItems(extract(j));
      else setError((j.error as string | undefined) ?? fallbackError);
    })
    .catch(() => setError('네트워크 오류가 발생했습니다.'))
    .finally(() => setLoading(false));
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

const TAB_LABELS: Record<Mode, string> = {
  coupang: '쿠팡 등록 상품',
  rg: 'RG 상품',
  naver: '네이버 상품',
  manual: '직접 입력',
};

const COUPANG_RG_FEE_HINT = '로켓그로스 기본 10.8% — 필요 시 수정하세요';

const FEE_HINT: Record<Mode, string> = {
  coupang: COUPANG_RG_FEE_HINT,
  rg: COUPANG_RG_FEE_HINT,
  naver: '네이버 스마트스토어 수수료는 카테고리마다 다릅니다 — 직접 입력하세요',
  manual: '플랫폼 수수료율을 입력하세요',
};

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>('coupang');

  // 쿠팡 일반 상품
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [loadingCoupang, setLoadingCoupang] = useState(true);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  const [selectedCoupang, setSelectedCoupang] = useState<CoupangProduct | null>(null);
  const [coupangOptions, setCoupangOptions] = useState<CoupangOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  // 다중 선택: vendorItemId(string) Set
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [coupangProductName, setCoupangProductName] = useState('');

  // RG 상품
  const [rgProducts, setRgProducts] = useState<RgProduct[]>([]);
  const [loadingRg, setLoadingRg] = useState(false);
  const [rgError, setRgError] = useState<string | null>(null);
  const [selectedRg, setSelectedRg] = useState<RgProduct | null>(null);
  const [rgCustomName, setRgCustomName] = useState('');

  // 네이버 상품
  const [naverProducts, setNaverProducts] = useState<NaverProduct[]>([]);
  const [loadingNaver, setLoadingNaver] = useState(false);
  const [naverError, setNaverError] = useState<string | null>(null);
  const [selectedNaver, setSelectedNaver] = useState<NaverProduct | null>(null);

  // 직접 입력
  const [manualName, setManualName] = useState('');

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

  function handleSelectCoupang(p: CoupangProduct) {
    setSelectedCoupang(p);
    setSelectedOptions(new Set());
    setCoupangOptions([]);
    setCoupangProductName('');
    setLoadingOptions(true);
    fetch(`/api/cost-management/coupang-product-options?sellerProductId=${p.seller_product_id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          setCoupangOptions(j.data);
          setCoupangProductName(j.productName ?? p.seller_product_name);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingOptions(false));
  }

  useEffect(() => {
    setRgCustomName(selectedRg?.product_name ?? '');
  }, [selectedRg]);

  function handleModeChange(m: Mode) {
    setMode(m);
    if (m === 'naver' || m === 'manual') setFeeRate('');
    if (m === 'rg' && rgProducts.length === 0 && !loadingRg && !rgError) {
      loadTabProducts(
        '/api/cost-management/rg-products',
        (j) => (j.data as RgProduct[]) ?? [],
        setRgProducts,
        setLoadingRg,
        setRgError,
        'RG 상품 목록을 불러오지 못했습니다.',
      );
    }
    if (m === 'naver' && naverProducts.length === 0 && !loadingNaver && !naverError) {
      loadTabProducts(
        '/api/listing/naver',
        (j) => ((j.data as { items?: NaverProduct[] } | null)?.items ?? []),
        setNaverProducts,
        setLoadingNaver,
        setNaverError,
        '네이버 상품 목록을 불러오지 못했습니다.',
      );
    }
  }

  async function add() {
    // 쿠팡 다중 선택 처리
    if (mode === 'coupang') {
      if (!selectedCoupang || selectedOptions.size === 0) return;
      setSaving(true);
      try {
        // 이미 추가된 옵션은 제외하고 선택된 것만 POST
        const optionsToAdd = coupangOptions.filter(
          (opt) => selectedOptions.has(opt.vendorItemId) && !opt.alreadyAdded,
        );

        const results = await Promise.allSettled(
          optionsToAdd.map((opt) =>
            fetch('/api/cost-management/products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                product_name: `${coupangProductName} — ${opt.itemName}`,
                seller_product_id: selectedCoupang.seller_product_id,
                vendor_item_id: opt.vendorItemId,
                platform_fee_rate: Number(feeRate) / 100,
                ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
              }),
            }).then((r) => r.json()),
          ),
        );

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        onAdded();
        if (failed > 0) {
          alert(`${succeeded}개 추가 완료, ${failed}개 실패`);
        }
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }

    // 나머지 탭(rg, naver, manual) — 기존 로직 그대로 유지
    if (mode === 'rg' && !selectedRg) return;
    if (mode === 'naver' && !selectedNaver) return;
    if (mode === 'manual' && !manualName.trim()) return;

    setSaving(true);
    try {
      let body: Record<string, unknown>;
      if (mode === 'rg') {
        body = {
          product_name: rgCustomName.trim(),
          vendor_item_id: selectedRg!.vendor_item_id,
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
      } else if (mode === 'naver') {
        body = {
          product_name: selectedNaver!.name,
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
      } else {
        body = {
          product_name: manualName.trim(),
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
      }

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

  const canSave =
    (mode === 'coupang' && !!selectedCoupang && selectedOptions.size > 0) ||
    (mode === 'rg' && !!selectedRg && rgCustomName.trim().length > 0) ||
    (mode === 'naver' && !!selectedNaver) ||
    (mode === 'manual' && manualName.trim().length > 0);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '420px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#18181b' }}>상품 추가</div>
            <div style={{ fontSize: '11px', color: '#52525b' }}>원가 관리할 상품을 선택하거나 직접 입력하세요</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#52525b" /></button>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>
          {/* 탭 */}
          <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '10px', background: '#f5f5f7', marginBottom: '16px' }}>
            {(['coupang', 'rg', 'naver', 'manual'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={{ flex: 1, padding: '8px 4px', borderRadius: '7px', border: 'none', fontSize: '11px', fontWeight: mode === m ? 600 : 500, color: mode === m ? '#be0014' : '#3f3f46', background: mode === m ? '#fff' : 'transparent', cursor: 'pointer', boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
              >
                {TAB_LABELS[m]}
              </button>
            ))}
          </div>

          {/* 쿠팡 일반 상품 */}
          {mode === 'coupang' && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '8px' }}>쿠팡 등록 상품 선택</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #d4d4d8', borderRadius: '8px' }}>
                {loadingCoupang ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>로딩중...</div>
                ) : coupangError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>상품 목록 로드 실패</div>
                    <div style={{ color: '#52525b', fontSize: '11px' }}>{coupangError}</div>
                  </div>
                ) : coupangProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>연동 가능한 상품이 없습니다</div>
                ) : coupangProducts.map((p) => (
                  <div
                    key={p.seller_product_id}
                    onClick={() => handleSelectCoupang(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f0f0f0', background: selectedCoupang?.seller_product_id === p.seller_product_id ? '#fef2f2' : '#fff', color: selectedCoupang?.seller_product_id === p.seller_product_id ? '#be0014' : '#18181b', fontWeight: selectedCoupang?.seller_product_id === p.seller_product_id ? 600 : 400 }}
                  >
                    {p.seller_product_name}
                    <span style={{ fontSize: '10px', color: '#71717a', marginLeft: '8px' }}>#{p.seller_product_id}</span>
                  </div>
                ))}
              </div>
              {/* 옵션 다중 선택 */}
              {selectedCoupang && loadingOptions && (
                <div style={{ fontSize: '11px', color: '#71717a', padding: '8px 0', marginTop: '10px' }}>옵션 조회 중...</div>
              )}
              {selectedCoupang && !loadingOptions && coupangOptions.length > 0 && (
                <div style={{ border: '1px solid #e4e4e7', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', marginTop: '10px' }}>
                  <div style={{
                    padding: '6px 10px', background: '#f4f4f5',
                    fontSize: '11px', color: '#71717a', fontWeight: 600,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span>{coupangProductName || selectedCoupang.seller_product_name}</span>
                    <button
                      onClick={() => {
                        // 아직 추가되지 않은 옵션만 전체 선택
                        const available = coupangOptions
                          .filter((o) => !o.alreadyAdded)
                          .map((o) => o.vendorItemId);
                        setSelectedOptions(new Set(available));
                      }}
                      style={{ fontSize: '10px', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      전체 선택
                    </button>
                  </div>
                  {coupangOptions.map((opt) => {
                    const isSelected = selectedOptions.has(opt.vendorItemId);
                    return (
                      <div
                        key={opt.vendorItemId}
                        style={{
                          padding: '8px 10px',
                          borderBottom: '1px solid #f4f4f5',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: opt.alreadyAdded ? '#fafafa' : isSelected ? '#f5f3ff' : '#fff',
                          opacity: opt.alreadyAdded ? 0.6 : 1,
                          cursor: opt.alreadyAdded ? 'default' : 'pointer',
                        }}
                        onClick={() => {
                          if (opt.alreadyAdded) return;
                          setSelectedOptions((prev) => {
                            const next = new Set(prev);
                            if (next.has(opt.vendorItemId)) next.delete(opt.vendorItemId);
                            else next.add(opt.vendorItemId);
                            return next;
                          });
                        }}
                      >
                        <div style={{
                          width: '14px', height: '14px',
                          background: opt.alreadyAdded ? '#d4d4d8' : isSelected ? '#7c3aed' : 'transparent',
                          border: opt.alreadyAdded || isSelected ? 'none' : '1.5px solid #d4d4d8',
                          borderRadius: '3px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {(opt.alreadyAdded || isSelected) && (
                            <span style={{ color: '#fff', fontSize: '9px' }}>✓</span>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '12px', fontWeight: opt.alreadyAdded ? 400 : 500, color: '#18181b' }}>
                            {opt.itemName}
                          </div>
                          <div style={{ fontSize: '10px', color: '#0369a1', fontFamily: 'monospace' }}>
                            {opt.vendorItemId}
                          </div>
                        </div>
                        {opt.alreadyAdded ? (
                          <span style={{ fontSize: '10px', background: '#f4f4f5', color: '#71717a', padding: '1px 6px', borderRadius: '10px' }}>
                            이미 추가됨
                          </span>
                        ) : (
                          <span style={{ fontSize: '10px', background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: '10px' }}>
                            미추가
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {coupangOptions.every((o) => o.alreadyAdded) && (
                    <div style={{ padding: '10px', textAlign: 'center', fontSize: '11px', color: '#71717a' }}>
                      모든 옵션이 이미 추가됐습니다
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* RG 상품 */}
          {mode === 'rg' && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '8px' }}>
                로켓그로스 상품 선택
                <span style={{ fontWeight: 400, color: '#71717a', marginLeft: '6px' }}>재고 등록 기준</span>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #d4d4d8', borderRadius: '8px' }}>
                {loadingRg ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>RG 주문 이력 조회중...</div>
                ) : rgError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>RG 상품 조회 실패</div>
                    <div style={{ color: '#52525b', fontSize: '11px' }}>{rgError}</div>
                  </div>
                ) : rgProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>최근 90일 내 RG 판매 이력이 없습니다</div>
                ) : rgProducts.map((p) => (
                  <div
                    key={p.vendor_item_id}
                    onClick={() => setSelectedRg(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f0f0f0', background: selectedRg?.vendor_item_id === p.vendor_item_id ? '#fef2f2' : '#fff', color: selectedRg?.vendor_item_id === p.vendor_item_id ? '#be0014' : '#18181b', fontWeight: selectedRg?.vendor_item_id === p.vendor_item_id ? 600 : 400 }}
                  >
                    {p.product_name}
                    <span style={{ fontSize: '10px', color: '#71717a', marginLeft: '8px' }}>VID#{p.vendor_item_id}</span>
                  </div>
                ))}
              </div>
              {selectedRg && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '4px' }}>상품명</div>
                  <input
                    value={rgCustomName}
                    onChange={(e) => setRgCustomName(e.target.value)}
                    placeholder="상품명을 입력하세요"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* 네이버 상품 */}
          {mode === 'naver' && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '8px' }}>네이버 등록 상품 선택</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #d4d4d8', borderRadius: '8px' }}>
                {loadingNaver ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>네이버 상품 조회중...</div>
                ) : naverError ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px' }}>
                    <div style={{ color: '#ef4444', marginBottom: '6px' }}>네이버 상품 조회 실패</div>
                    <div style={{ color: '#52525b', fontSize: '11px' }}>{naverError}</div>
                  </div>
                ) : naverProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#52525b', fontSize: '12px' }}>등록된 네이버 상품이 없습니다</div>
                ) : naverProducts.map((p) => (
                  <div
                    key={p.originProductNo}
                    onClick={() => setSelectedNaver(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f0f0f0', background: selectedNaver?.originProductNo === p.originProductNo ? '#fef2f2' : '#fff', color: selectedNaver?.originProductNo === p.originProductNo ? '#be0014' : '#18181b', fontWeight: selectedNaver?.originProductNo === p.originProductNo ? 600 : 400 }}
                  >
                    {p.name}
                    <span style={{ fontSize: '10px', color: '#71717a', marginLeft: '8px' }}>#{p.originProductNo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 직접 입력 */}
          {mode === 'manual' && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>상품명</div>
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="상품명을 입력하세요" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }} />
            </div>
          )}

          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>플랫폼 수수료율 (%)</div>
            <input type="number" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} step="0.1" min="0" max="50" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }} />
            <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>{FEE_HINT[mode]}</div>
          </div>

          <div style={{ marginTop: '12px' }}>
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
            <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>입력하면 입고 시 개당 원가를 자동 계산합니다</div>
          </div>

          <button
            onClick={add}
            disabled={saving || !canSave}
            style={{ width: '100%', marginTop: '20px', padding: '10px', borderRadius: '8px', border: 'none', background: canSave ? '#be0014' : '#d4d4d4', color: canSave ? '#fff' : '#525252', fontSize: '13px', fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '추가 중...' : (
              mode === 'coupang' && selectedOptions.size > 0
                ? `${selectedOptions.size}개 옵션 추가`
                : '추가'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
