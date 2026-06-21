'use client';

import React, { useState, useEffect, useRef } from 'react';

interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
}

interface ProductSnapshot {
  id: string;
  seller_product_id: number | null;
  channels: ChannelEntry[];
}

interface ChannelEditPopoverProps {
  product: ProductSnapshot;
  anchorEl: HTMLElement;
  onClose: () => void;
  onChannelAdded: (entry: ChannelEntry) => void;
  onChannelRemoved: (channelId: string) => void;
  onSellerProductIdSaved: (newId: number) => void;
}

const CHANNEL_LABELS: Record<string, { label: string; color: string; bg: string; placeholder: string }> = {
  coupang_rg: { label: 'RG', color: '#0369a1', bg: '#e0f2fe', placeholder: '예: 95401822935 (vendorItemId)' },
  coupang_wing: { label: '쿠팡 윙', color: '#be0014', bg: '#fef2f2', placeholder: '예: 95401822935 (판배 옵션ID)' },
  naver: { label: '네이버', color: '#03c75a', bg: '#f0fff8', placeholder: '예: 5012345678 (채널상품번호)' },
};

export default function ChannelEditPopover({
  product,
  anchorEl,
  onClose,
  onChannelAdded,
  onChannelRemoved,
  onSellerProductIdSaved,
}: ChannelEditPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // 저장 중 팝오버 닫힘 방지용 ref (이벤트 핸들러가 클로저를 캡처하므로 ref 사용)
  const savingSpidRef = useRef(false);

  const [channels, setChannels] = useState<ChannelEntry[]>(product.channels ?? []);
  const [newChannelType, setNewChannelType] = useState<string>('coupang_rg');
  const [newExternalId, setNewExternalId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 등록상품ID 편집 상태
  const initialSpid = product.seller_product_id != null && product.seller_product_id > 0
    ? String(product.seller_product_id)
    : '';
  const [spidInput, setSpidInput] = useState(initialSpid);
  const [savingSpid, setSavingSpid] = useState(false);
  const [spidError, setSpidError] = useState<string | null>(null);
  const [spidSaved, setSpidSaved] = useState(false);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 280;
    const left = rect.left + popoverWidth > window.innerWidth - 8
      ? rect.right - popoverWidth
      : rect.left;
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [anchorEl]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (savingSpidRef.current) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (anchorEl.contains(e.target as Node)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (savingSpidRef.current) return;
      if (e.key === 'Escape') onClose();
    }
    function handleClose() {
      if (savingSpidRef.current) return;
      onClose();
    }

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

  async function handleSaveSpid() {
    const parsed = parseInt(spidInput.replace(/[^0-9]/g, ''), 10);
    if (isNaN(parsed) || parsed <= 0) {
      setSpidError('양수 등록상품ID를 입력하세요.');
      return;
    }
    setSpidError(null);
    setSpidSaved(false);
    setSavingSpid(true);
    savingSpidRef.current = true;
    try {
      const res = await fetch(`/api/cost-management/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seller_product_id: parsed }),
      });
      const json = await res.json();
      if (json.success) {
        setSpidSaved(true);
        setSpidInput(String(parsed));
        onSellerProductIdSaved(parsed);
        setTimeout(() => setSpidSaved(false), 2000);
      } else {
        setSpidError(json.error ?? '저장 실패');
      }
    } catch {
      setSpidError('네트워크 오류');
    } finally {
      setSavingSpid(false);
      savingSpidRef.current = false;
    }
  }

  async function handleAdd() {
    const extId = parseInt(newExternalId.replace(/[^0-9]/g, ''), 10);
    if (!newChannelType || isNaN(extId) || extId <= 0) {
      setAddError('유효한 ID를 입력하세요.');
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/cost-management/products/${product.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: newChannelType, external_id: extId }),
      });
      const json = await res.json();
      if (json.success) {
        const entry = json.data as ChannelEntry;
        setChannels((prev) => [...prev, entry]);
        onChannelAdded(entry);
        setNewExternalId('');
      } else {
        setAddError(json.error ?? '추가 실패');
      }
    } catch {
      setAddError('네트워크 오류');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(channelId: string) {
    setRemovingId(channelId);
    try {
      const res = await fetch(
        `/api/cost-management/products/${product.id}/channels/${channelId}`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (json.success) {
        setChannels((prev) => prev.filter((ch) => ch.id !== channelId));
        onChannelRemoved(channelId);
      }
    } catch {
      // silent — channel stays visible
    } finally {
      setRemovingId(null);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '4px 8px', fontSize: '12px',
    border: '1px solid #d4d4d8', borderRadius: '5px',
    color: '#18181b', outline: 'none', minWidth: 0,
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 280,
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        padding: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', marginBottom: 10 }}>채널 관리</div>

      {/* 등록상품ID (primary key) */}
      <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #f4f4f5' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#52525b', marginBottom: 4 }}>
          등록상품ID <span style={{ fontWeight: 400, color: '#a1a1aa' }}>(그룹 키)</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            style={{ ...inputStyle, fontFamily: 'monospace' }}
            placeholder="예: 16182237839"
            value={spidInput}
            onChange={(e) => { setSpidInput(e.target.value); setSpidError(null); setSpidSaved(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSpid(); }}
          />
          <button
            onClick={handleSaveSpid}
            disabled={savingSpid || spidInput === initialSpid}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              background: spidInput !== initialSpid ? '#18181b' : '#e5e5e5',
              color: spidInput !== initialSpid ? '#fff' : '#a1a1aa',
              border: 'none', borderRadius: 5,
              cursor: (savingSpid || spidInput === initialSpid) ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >{savingSpid ? '...' : '저장'}</button>
        </div>
        {spidError && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3 }}>{spidError}</div>}
        {spidSaved && <div style={{ fontSize: 10, color: '#16a34a', marginTop: 3 }}>저장됐습니다. 같은 ID를 가진 상품 2개 이상이면 그룹으로 묶입니다.</div>}
      </div>

      {/* 현재 채널 목록 */}
      <div style={{ fontSize: 10, fontWeight: 600, color: '#52525b', marginBottom: 6 }}>채널 (서브키)</div>
      {channels.length === 0 && (
        <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 10 }}>연결된 채널 없음</div>
      )}
      {channels.map((ch) => {
        const meta = CHANNEL_LABELS[ch.channel_type] ?? { label: ch.channel_type, color: '#52525b', bg: '#f4f4f5', placeholder: '' };
        const isRemoving = removingId === ch.id;
        return (
          <div
            key={ch.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 0', borderBottom: '1px solid #f4f4f5',
              opacity: isRemoving ? 0.4 : 1,
            }}
          >
            <span style={{ background: meta.bg, color: meta.color, padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, flexShrink: 0 }}>
              {meta.label}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#18181b', flex: 1 }}>{ch.external_id}</span>
            <button
              onClick={() => navigator.clipboard.writeText(String(ch.external_id))}
              title="복사"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10, color: '#a1a1aa' }}
            >📋</button>
            <button
              onClick={() => handleRemove(ch.id)}
              disabled={isRemoving}
              title="채널 삭제"
              style={{
                background: 'none', border: 'none', cursor: isRemoving ? 'not-allowed' : 'pointer',
                padding: 0, fontSize: 11, color: '#f87171',
              }}
            >✕</button>
          </div>
        );
      })}

      {/* 새 채널 추가 */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#52525b', marginBottom: 6 }}>채널 추가</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <select
            value={newChannelType}
            onChange={(e) => { setNewChannelType(e.target.value); setAddError(null); }}
            style={{
              padding: '4px 6px', fontSize: 11, border: '1px solid #d4d4d8',
              borderRadius: 5, color: '#18181b', background: '#fff', outline: 'none', flexShrink: 0,
            }}
          >
            <option value="coupang_rg">RG</option>
            <option value="coupang_wing">쿠팡 윙</option>
            <option value="naver">네이버</option>
          </select>
          <input
            style={inputStyle}
            placeholder={CHANNEL_LABELS[newChannelType]?.placeholder ?? 'ID 입력'}
            value={newExternalId}
            onChange={(e) => { setNewExternalId(e.target.value); setAddError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
        </div>
        {addError && (
          <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 4 }}>{addError}</div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{
              padding: '4px 12px', fontSize: 11, fontWeight: 600,
              background: '#18181b', color: '#fff', border: 'none',
              borderRadius: 5, cursor: adding ? 'not-allowed' : 'pointer',
              opacity: adding ? 0.6 : 1,
            }}
          >{adding ? '추가 중...' : '추가'}</button>
          <button
            onClick={onClose}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: '#f4f4f5', color: '#71717a',
              border: 'none', borderRadius: 5, cursor: 'pointer',
            }}
          >닫기</button>
        </div>
      </div>
    </div>
  );
}
