'use client';

import React, { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { useDraftPersist, loadDraft } from '@/hooks/useDraftPersist';
import { ADD_PRODUCT_DRAFT_KEY } from './draft-keys';
import { E } from '@/lib/design-tokens';

/**
 * 쿠팡에 없는 상품을 원가관리에 직접 넣는다.
 *
 * 쿠팡 등록상품을 고르는 경로는 [쿠팡 상품 불러오기](BulkAddProductModal)로 일원화했다.
 * 여기 남은 것은 그쪽으로 대신할 수 없는 하나 — 쿠팡에 존재하지 않는 상품을
 * 음수 가상 ID로 만드는 일이다(네이버 전용 상품, 소분 원재료 등).
 * seller_product_id를 보내지 않으면 DB DEFAULT가 가상 ID를 부여한다.
 */

interface AddProductDraft {
  productName: string;
  feeRate: string;
  subdivisionUnit: string;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [productName, setProductName] = useState('');
  const [feeRate, setFeeRate] = useState('');
  const [subdivisionUnit, setSubdivisionUnit] = useState('');
  const [saving, setSaving] = useState(false);

  // 작성 중이던 입력을 복원한다. 이전 버전이 남긴 쿠팡 선택 필드는 여기서 읽지 않아
  // 자연히 버려진다 — 그 경로는 이제 이 창에 없다.
  useEffect(() => {
    const saved = loadDraft<AddProductDraft>(ADD_PRODUCT_DRAFT_KEY);
    if (saved.productName === undefined) return;
    setProductName(saved.productName);
    if (saved.feeRate !== undefined) setFeeRate(saved.feeRate);
    if (saved.subdivisionUnit !== undefined) setSubdivisionUnit(saved.subdivisionUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { clearNow: clearDraftNow } = useDraftPersist(
    ADD_PRODUCT_DRAFT_KEY,
    { productName, feeRate, subdivisionUnit },
    productName.trim().length > 0,
  );

  /** 입력을 막는 이유. 없으면 null. */
  const blocking = (() => {
    if (!productName.trim()) return null; // 아직 안 쓴 것은 오류가 아니다
    if (feeRate.trim() !== '') {
      const n = Number(feeRate);
      if (Number.isNaN(n) || n <= 0 || n >= 100) return '수수료율은 0보다 크고 100보다 작아야 합니다';
    }
    if (subdivisionUnit.trim() !== '') {
      const n = Number(subdivisionUnit);
      if (!Number.isInteger(n) || n < 1) return '소분 갯수는 1 이상의 정수여야 합니다';
    }
    return null;
  })();

  const canSave = productName.trim().length > 0 && !blocking && !saving;

  async function add() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch('/api/cost-management/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          ...(feeRate.trim() !== '' && { platform_fee_rate: Number(feeRate) / 100 }),
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
          // seller_product_id를 생략해 DB DEFAULT(음수 가상 ID)를 받는다
        }),
      });
      const json = await res.json();
      if (json.success) {
        clearDraftNow();
        onAdded();
        onClose();
      } else {
        toast.error(json.error ?? '상품 추가에 실패했습니다.');
      }
    } catch {
      toast.error('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const label: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, color: E.inkSub, marginBottom: 5, display: 'block',
  };
  const input: React.CSSProperties = {
    width: '100%', font: 'inherit', fontSize: 12, color: E.ink, background: E.surface,
    border: `1px solid ${E.line}`, padding: '4px 8px', height: 27, boxSizing: 'border-box',
  };
  const hint: React.CSSProperties = { fontSize: 10.5, color: E.inkMute, marginTop: 4 };
  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: E.ctrlH, padding: '0 12px',
    font: 'inherit', fontSize: 11.5, fontWeight: 500, color: E.ink, background: E.surface,
    border: `1px solid ${E.line}`, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(22,32,42,0.45)' }} />
      <div style={{
        position: 'relative', width: 'min(420px, 94vw)',
        background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 16px 48px rgba(22,32,42,.28)',
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: E.chrome, borderBottom: `1px solid ${E.line}` }}>
          <Package size={14} color={E.accent} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: E.ink }}>직접 추가</div>
            <div style={{ fontSize: 11, color: E.inkSub }}>쿠팡에 없는 상품을 가상 ID로 등록합니다</div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ ...btn, width: 22, height: 22, padding: 0, justifyContent: 'center' }}>
            <X size={12} />
          </button>
        </div>

        <div style={{ padding: '14px 14px 4px' }}>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="ap-name" style={label}>상품명</label>
            <input
              id="ap-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="상품명을 입력하세요"
              autoFocus
              style={input}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="ap-fee" style={label}>플랫폼 수수료율 (%)</label>
            <input
              id="ap-fee"
              value={feeRate}
              onChange={(e) => setFeeRate(e.target.value)}
              inputMode="decimal"
              placeholder="비우면 10.8%"
              style={{ ...input, fontFamily: E.mono, textAlign: 'right' }}
            />
            <div style={hint}>카테고리·채널마다 다릅니다. 비우면 10.8%가 들어갑니다</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="ap-sub" style={label}>소분 갯수 (선택)</label>
            <input
              id="ap-sub"
              value={subdivisionUnit}
              onChange={(e) => setSubdivisionUnit(e.target.value)}
              inputMode="numeric"
              placeholder="비워두면 소분 없음"
              style={{ ...input, fontFamily: E.mono, textAlign: 'right' }}
            />
            <div style={hint}>입력하면 입고 시 개당 원가를 자동 계산합니다</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: E.chrome2, borderTop: `1px solid ${E.line}` }}>
          <span style={{ fontSize: 11, color: blocking ? E.loss : E.inkMute }}>
            {blocking ?? '쿠팡 등록상품은 [쿠팡 상품 불러오기]에서 추가하세요'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={btn}>취소</button>
            <button
              onClick={add}
              disabled={!canSave}
              style={{
                ...btn,
                background: canSave ? E.accent : '#c9d1d6',
                borderColor: canSave ? E.accent : '#c9d1d6',
                color: canSave ? '#fff' : '#6b7780',
                fontWeight: 600,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? '추가 중…' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
