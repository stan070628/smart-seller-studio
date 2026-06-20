'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Pencil } from 'lucide-react';

interface ProductData {
  id: string;
  seller_product_id: number | null;
  vendor_item_id: number | null;
  naver_channel_product_no: number | null;
  variants: Record<string, string> | null;
  naver_variants: Record<string, string> | null;
  naver_origin_product_no: number | null;
}

interface ChannelCellProps {
  product: ProductData;
  onEditChannel: () => void;
  onProductUpdate: (updates: Partial<ProductData>) => void;
}

export default function ChannelCell({ product: p, onEditChannel, onProductUpdate }: ChannelCellProps) {
  const [expandedCoupang, setExpandedCoupang] = useState(false);
  const [expandedNaver, setExpandedNaver] = useState(false);
  const [stock, setStock] = useState<Record<string, number> | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [fetchingVariants, setFetchingVariants] = useState<'coupang' | 'naver' | null>(null);
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const [editingOption, setEditingOption] = useState<{ channel: 'coupang' | 'naver'; optionId: string } | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingOption, setSavingOption] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const saveInitiatedRef = useRef(false);

  const fetchStock = useCallback(async () => {
    if (stock !== null || stockLoading) return;
    setStockLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/variant-stock`);
      const json = await res.json();
      if (json.success) setStock(json.data as Record<string, number>);
    } catch {
      // silent — stock cells just show "—"
    } finally {
      setStockLoading(false);
    }
  }, [p.id, stock, stockLoading]);

  function handleExpandCoupang() {
    const next = !expandedCoupang;
    setExpandedCoupang(next);
    if (next) fetchStock();
  }

  function handleExpandNaver() {
    const next = !expandedNaver;
    setExpandedNaver(next);
    if (next) fetchStock();
  }

  async function doFetchCoupangVariants() {
    setFetchingVariants('coupang');
    setFetchErrors((prev) => { const n = { ...prev }; delete n.coupang; return n; });
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/fetch-variants`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        onProductUpdate({ variants: json.data.variants as Record<string, string> });
      } else {
        setFetchErrors((prev) => ({ ...prev, coupang: json.error ?? '옵션 조회 실패' }));
      }
    } catch {
      setFetchErrors((prev) => ({ ...prev, coupang: '네트워크 오류' }));
    } finally {
      setFetchingVariants(null);
    }
  }

  async function doFetchNaverVariants() {
    setFetchingVariants('naver');
    setFetchErrors((prev) => { const n = { ...prev }; delete n.naver; return n; });
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/fetch-naver-variants`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        onProductUpdate({
          naver_variants: json.data.naver_variants as Record<string, string>,
          naver_origin_product_no: json.data.naver_origin_product_no as number,
        });
      } else {
        setFetchErrors((prev) => ({ ...prev, naver: json.error ?? '네이버 옵션 조회 실패' }));
      }
    } catch {
      setFetchErrors((prev) => ({ ...prev, naver: '네트워크 오류' }));
    } finally {
      setFetchingVariants(null);
    }
  }

  function startEdit(channel: 'coupang' | 'naver', optionId: string, currentName: string) {
    const key = `${channel}-${optionId}`;
    setSaveErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setEditingOption({ channel, optionId });
    setEditingName(currentName);
  }

  async function saveEdit() {
    if (!editingOption) return;
    const { channel, optionId } = editingOption;
    const name = editingName.trim();
    setEditingOption(null);
    if (!name) return;

    const key = `${channel}-${optionId}`;
    setSavingOption(key);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/variant-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, optionId, newName: name }),
      });
      const json = await res.json();
      if (json.success) {
        const field = channel === 'coupang' ? 'variants' : 'naver_variants';
        onProductUpdate({ [field]: (json.data as Record<string, Record<string, string>>)[field] });
      } else {
        setSaveErrors((prev) => ({ ...prev, [key]: json.error ?? '저장 실패' }));
      }
    } catch {
      setSaveErrors((prev) => ({ ...prev, [key]: '네트워크 오류' }));
    } finally {
      setSavingOption(null);
    }
  }

  function renderOptionRow(optionId: string, optionName: string, channel: 'coupang' | 'naver') {
    const idColor = channel === 'coupang' ? '#0369a1' : '#03c75a';
    const stockQty = stock ? (stock[optionName] ?? null) : null;
    const isEditing = editingOption?.channel === channel && editingOption?.optionId === optionId;
    const key = `${channel}-${optionId}`;
    const isSaving = savingOption === key;
    const saveError = saveErrors[key];

    return (
      <React.Fragment key={optionId}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', paddingLeft: '6px', marginTop: '2px' }}>
          <span style={{ color: idColor, fontFamily: 'monospace', fontSize: '9px', flexShrink: 0 }}>{optionId}</span>
          <button
            onClick={() => navigator.clipboard.writeText(optionId)}
            title="복사"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1, flexShrink: 0 }}
          >📋</button>
          {isEditing ? (
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { saveInitiatedRef.current = true; saveEdit(); }
                if (e.key === 'Escape') { saveInitiatedRef.current = true; setEditingOption(null); }
              }}
              onBlur={() => {
                if (!saveInitiatedRef.current) saveEdit();
                saveInitiatedRef.current = false;
              }}
              style={{ fontSize: '9px', padding: '1px 4px', border: '1px solid #7c3aed', borderRadius: '3px', width: '68px', outline: 'none', color: '#18181b', flexShrink: 0 }}
            />
          ) : (
            <button
              onClick={() => startEdit(channel, optionId, optionName)}
              title="옵션명 편집 (재고 매칭 키)"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', color: '#52525b', fontSize: '9px', display: 'flex', alignItems: 'center', gap: '1px', minWidth: 0 }}
            >
              <span style={{ maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{optionName}</span>
              <span style={{ color: '#d4d4d4', fontSize: '8px', flexShrink: 0 }}>✏</span>
            </button>
          )}
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '9px', color: isSaving ? '#a1a1aa' : stockLoading ? '#a1a1aa' : stockQty !== null ? (stockQty > 0 ? '#16a34a' : '#a1a1aa') : '#d4d4d4', fontWeight: stockQty !== null && stockQty > 0 ? 600 : 400 }}>
            {isSaving ? '…' : stockLoading ? '…' : stockQty !== null ? `${stockQty}개` : stock !== null ? '—' : ''}
          </span>
        </div>
        {saveError && (
          <div style={{ paddingLeft: '6px', fontSize: '8px', color: '#ef4444', marginTop: '1px' }}>{saveError}</div>
        )}
      </React.Fragment>
    );
  }

  const hasCoupang = !!p.seller_product_id;
  const hasRg = !!p.vendor_item_id;
  const hasNaver = !!p.naver_channel_product_no;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px' }}>
      {/* 쿠팡 윙 */}
      {hasCoupang && (
        <div style={{ fontSize: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '2px' }}>
            <button
              onClick={handleExpandCoupang}
              style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
            >
              <span style={{ background: '#fef2f2', color: '#be0014', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600 }}>쿠팡</span>
              <span style={{ color: '#52525b', fontFamily: 'monospace' }}>{p.seller_product_id}</span>
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(String(p.seller_product_id))}
              title="복사"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1 }}
            >📋</button>
            <button
              onClick={handleExpandCoupang}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1, marginLeft: 'auto' }}
            >{expandedCoupang ? '▴' : '▾'}</button>
          </div>
          {expandedCoupang && (() => {
            const vars = p.variants && Object.keys(p.variants).length > 0 ? p.variants : null;
            if (fetchingVariants === 'coupang') return <div style={{ color: '#a1a1aa', paddingLeft: '6px', fontSize: '9px' }}>불러오는 중…</div>;
            if (fetchErrors.coupang) return <div style={{ color: '#ef4444', fontSize: '9px', paddingLeft: '6px', maxWidth: '200px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{fetchErrors.coupang}</div>;
            if (!vars) return (
              <button
                onClick={doFetchCoupangVariants}
                style={{ marginLeft: '6px', marginTop: '2px', fontSize: '9px', color: '#be0014', background: 'none', border: '1px solid #fca5a5', borderRadius: '3px', padding: '1px 5px', cursor: 'pointer' }}
              >
                옵션 불러오기
              </button>
            );
            return <div>{Object.entries(vars).map(([vid, name]) => renderOptionRow(vid, name, 'coupang'))}</div>;
          })()}
        </div>
      )}

      {/* 쿠팡 RG */}
      {hasRg && (
        <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600 }}>RG</span>
          <span style={{ color: '#0369a1', fontFamily: 'monospace' }}>{p.vendor_item_id}</span>
          <button
            onClick={() => navigator.clipboard.writeText(String(p.vendor_item_id))}
            title="복사"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1 }}
          >📋</button>
        </div>
      )}

      {/* 네이버 */}
      {hasNaver && (
        <div style={{ fontSize: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '2px' }}>
            <button
              onClick={handleExpandNaver}
              style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '0' }}
            >
              <span style={{ background: '#f0fff8', color: '#03c75a', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600 }}>네이버</span>
              <span style={{ color: '#52525b', fontFamily: 'monospace' }}>{p.naver_channel_product_no}</span>
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(String(p.naver_channel_product_no))}
              title="복사"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1 }}
            >📋</button>
            <button
              onClick={handleExpandNaver}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1, marginLeft: 'auto' }}
            >{expandedNaver ? '▴' : '▾'}</button>
          </div>
          {expandedNaver && (() => {
            const nvars = p.naver_variants && Object.keys(p.naver_variants).length > 0 ? p.naver_variants : null;
            if (fetchingVariants === 'naver') return <div style={{ color: '#a1a1aa', paddingLeft: '6px', fontSize: '9px' }}>불러오는 중…</div>;
            if (fetchErrors.naver) return <div style={{ color: '#ef4444', fontSize: '9px', paddingLeft: '6px', maxWidth: '200px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{fetchErrors.naver}</div>;
            if (!nvars) return (
              <button
                onClick={doFetchNaverVariants}
                style={{ marginLeft: '6px', marginTop: '2px', fontSize: '9px', color: '#03c75a', background: 'none', border: '1px solid #86efac', borderRadius: '3px', padding: '1px 5px', cursor: 'pointer' }}
              >
                옵션 불러오기
              </button>
            );
            return <div>{Object.entries(nvars).map(([oid, name]) => renderOptionRow(oid, name, 'naver'))}</div>;
          })()}
        </div>
      )}

      {!hasCoupang && !hasRg && !hasNaver && (
        <span style={{ color: '#ccc', fontSize: '10px' }}>—</span>
      )}

      <button
        onClick={onEditChannel}
        title="채널 ID 편집"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', color: '#d4d4d4', lineHeight: 1, display: 'flex', alignItems: 'center', alignSelf: 'flex-start' }}
      >
        <Pencil size={10} />
      </button>
    </div>
  );
}
