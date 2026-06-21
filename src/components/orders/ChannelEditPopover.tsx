'use client';

import React, { useState, useEffect, useRef } from 'react';

interface ProductSnapshot {
  id: string;
  seller_product_id: number | null;
  vendor_item_id: number | null;
  naver_channel_product_no: number | null;
}

interface ChannelEditPopoverProps {
  product: ProductSnapshot;
  anchorEl: HTMLElement;
  onClose: () => void;
  onSaved: (updates: Partial<ProductSnapshot>) => void;
}

export default function ChannelEditPopover({ product: p, anchorEl, onClose, onSaved }: ChannelEditPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [sellerProductId, setSellerProductId] = useState(p.seller_product_id ? String(p.seller_product_id) : '');
  const [vendorItemId, setVendorItemId] = useState(p.vendor_item_id ? String(p.vendor_item_id) : '');
  const [naverChannelProductNo, setNaverChannelProductNo] = useState(p.naver_channel_product_no ? String(p.naver_channel_product_no) : '');
  const [saving, setSaving] = useState(false);
  const [fetchingVariants, setFetchingVariants] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate position relative to anchor element
  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 260;
    const left = rect.left + popoverWidth > window.innerWidth - 8
      ? rect.right - popoverWidth
      : rect.left;
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [anchorEl]);

  // Close on outside click, Esc, scroll, resize
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (anchorEl.contains(e.target as Node)) return; // prevent toggle conflict
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClose() { onClose(); }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [anchorEl, onClose]);

  function parseId(val: string): number | null {
    const n = parseInt(val.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) || n <= 0 ? null : n;
  }

  async function handleSave() {
    const updates: Partial<ProductSnapshot> = {};
    const sid = parseId(sellerProductId);
    const vid = parseId(vendorItemId);
    const nid = parseId(naverChannelProductNo);
    if (sid !== null) updates.seller_product_id = sid;
    if (vid !== null) updates.vendor_item_id = vid;
    if (nid !== null) updates.naver_channel_product_no = nid;

    const body: Record<string, unknown> = { ...updates };
    if (Object.keys(body).length === 0) { onClose(); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        onSaved(updates);
        onClose();
      } else {
        alert(json.error ?? '저장 실패');
      }
    } catch {
      alert('네트워크 오류');
    } finally {
      setSaving(false);
    }
  }

  async function handleFetchVariants() {
    const sid = parseId(sellerProductId);
    if (!sid) return;
    setFetchingVariants(true);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/fetch-variants`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const count = Object.keys((json.data?.variants ?? {}) as Record<string, string>).length;
        alert(`사이즈 ${count}개 매핑 저장 완료`);
        onSaved({ seller_product_id: sid });
        onClose();
      } else {
        alert(json.error ?? 'variants 조회 실패');
      }
    } catch {
      alert('네트워크 오류');
    } finally {
      setFetchingVariants(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 8px', fontSize: '12px',
    border: '1px solid #d4d4d8', borderRadius: '5px',
    boxSizing: 'border-box', color: '#18181b', outline: 'none',
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 260,
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        padding: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', marginBottom: 10 }}>채널 코드 수정</div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#be0014', fontWeight: 600, marginBottom: 2 }}>윙 판매자상품ID</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>Wing 셀러센터 → 상품관리 → 판매자상품ID</div>
        <input
          style={{ ...inputStyle, borderColor: '#fca5a5' }}
          placeholder="예: 12345678"
          value={sellerProductId}
          onChange={(e) => setSellerProductId(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#0369a1', fontWeight: 600, marginBottom: 2 }}>RG vendorItemId</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>쿠팡 URL의 vendorItemId= 값 (URL 붙여넣기 가능)</div>
        <input
          style={{ ...inputStyle, borderColor: '#7dd3fc' }}
          placeholder="예: 95346957211"
          value={vendorItemId}
          onChange={(e) => {
            const v = e.target.value;
            const match = v.match(/[?&]vendorItemId=(\d+)/);
            setVendorItemId(match ? match[1] : v);
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: '#03c75a', fontWeight: 600, marginBottom: 2 }}>네이버 채널상품번호</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>스마트스토어 URL의 /products/숫자 (URL 붙여넣기 가능)</div>
        <input
          style={{ ...inputStyle, borderColor: '#86efac' }}
          placeholder="예: 5012345678"
          value={naverChannelProductNo}
          onChange={(e) => {
            const v = e.target.value;
            const match = v.match(/\/products\/(\d+)/);
            setNaverChannelProductNo(match ? match[1] : v);
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600,
            background: '#18181b', color: '#fff', border: 'none',
            borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '5px 10px', fontSize: 11,
            background: '#f4f4f5', color: '#71717a',
            border: 'none', borderRadius: 5, cursor: 'pointer',
          }}
        >
          취소
        </button>
        {parseId(sellerProductId) && (
          <button
            onClick={handleFetchVariants}
            disabled={fetchingVariants}
            style={{
              padding: '5px 10px', fontSize: 11,
              background: '#eff6ff', color: '#1d4ed8',
              border: '1px solid #bfdbfe', borderRadius: 5,
              cursor: fetchingVariants ? 'not-allowed' : 'pointer',
            }}
          >
            {fetchingVariants ? '불러오는 중...' : 'variants 불러오기'}
          </button>
        )}
      </div>
    </div>
  );
}
