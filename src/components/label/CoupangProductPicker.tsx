'use client';

import { useState } from 'react';

interface CoupangProductItem {
  sellerProductId: number;
  sellerProductName: string;
}

interface Props {
  onLoad: (imageUrl: string, productName: string) => void;
}

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  fontSize: 12,
  background: '#fff',
  color: '#111',
};

const BTN_STYLE: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  fontSize: 12,
  cursor: 'pointer',
  background: '#fff',
  color: '#111',
  whiteSpace: 'nowrap' as const,
};

export default function CoupangProductPicker({ onLoad }: Props) {
  const [products, setProducts] = useState<CoupangProductItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);

  const fetchProducts = async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/listing/coupang?status=APPROVED&maxPerPage=50');
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '조회 실패');
      const items: CoupangProductItem[] = (json.data?.items ?? []).map((p: Record<string, unknown>) => ({
        sellerProductId: p.sellerProductId as number,
        sellerProductName: p.sellerProductName as string,
      }));
      setProducts(items);
      if (items.length === 0) setError('등록된 상품이 없습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '상품 목록 조회 실패');
    } finally {
      setListLoading(false);
    }
  };

  const handleLoad = async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setError(null);
    setLoadMsg(null);
    try {
      const res = await fetch(`/api/listing/coupang/${selectedId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '상품 조회 실패');

      const detail = json.data as Record<string, unknown>;
      const productName =
        (detail.sellerProductName as string) ??
        products.find((p) => p.sellerProductId === selectedId)?.sellerProductName ??
        '';

      // 대표이미지(REPRESENTATION) → 없으면 첫 번째 이미지
      let thumbUrl = '';
      const items = (detail.items as Record<string, unknown>[] | undefined) ?? [];
      outer: for (const item of items) {
        const images = (item.images as { imageType: string; vendorPath: string }[] | undefined) ?? [];
        for (const img of images) {
          if (img.imageType === 'REPRESENTATION' && img.vendorPath) {
            thumbUrl = img.vendorPath;
            break outer;
          }
        }
        if (!thumbUrl && images[0]?.vendorPath) {
          thumbUrl = images[0].vendorPath;
        }
      }

      onLoad(thumbUrl, productName);
      setLoadMsg(`"${productName}" 불러오기 완료`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '상품 불러오기 실패');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {products.length === 0 ? (
        <button style={{ ...BTN_STYLE, width: '100%' }} onClick={fetchProducts} disabled={listLoading}>
          {listLoading ? '조회 중...' : '쿠팡 등록 상품 조회'}
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              style={SELECT_STYLE}
              value={selectedId}
              onChange={(e) => { setSelectedId(Number(e.target.value) || ''); setLoadMsg(null); }}
            >
              <option value="">상품 선택...</option>
              {products.map((p) => (
                <option key={p.sellerProductId} value={p.sellerProductId}>
                  [{p.sellerProductId}] {p.sellerProductName}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...BTN_STYLE, flex: 1 }} onClick={fetchProducts} disabled={listLoading}>
              {listLoading ? '조회 중...' : '새로고침'}
            </button>
            <button
              style={{ ...BTN_STYLE, flex: 1, opacity: (!selectedId || detailLoading) ? 0.4 : 1, cursor: (!selectedId || detailLoading) ? 'not-allowed' : 'pointer' }}
              onClick={handleLoad}
              disabled={!selectedId || detailLoading}
            >
              {detailLoading ? '불러오는 중...' : '불러오기'}
            </button>
          </div>
        </>
      )}
      {error && <p style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{error}</p>}
      {loadMsg && <p style={{ fontSize: 11, color: '#16a34a', margin: 0 }}>{loadMsg}</p>}
    </div>
  );
}
