'use client';

import React, { useState } from 'react';

interface DetailProduct {
  id: string;
  platform_fee_rate: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_rg_shipping: number;
  current_stock: number;
  stock_value: number;
  ad_spend: number;
  entry_count: number;
  [key: string]: unknown;
}

interface Props {
  product: DetailProduct;
  colSpan: number;
  isEditablePeriod: boolean;
  onOpenDrawer: (productId: string) => void;
  onSaveAdSpend: (productId: string, value: string) => void;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function ProductDetailPanel({
  product, colSpan, isEditablePeriod, onOpenDrawer, onSaveAdSpend, channelFilter, rgInventory,
}: Props) {
  const [editingAd, setEditingAd] = useState(false);
  const [adValue, setAdValue] = useState('');

  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#a1a1aa' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#3f3f46' }}>{value}</span>
    </div>
  );

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: '#fafafa', padding: '14px 20px', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          {stat('원가(가중평균)', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_cost)}원`)}
          {stat('배송비', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_shipping)}원`)}
          {stat('RG배송비', product.weighted_avg_rg_shipping > 0 ? `${fmt(product.weighted_avg_rg_shipping)}원` : '—')}
          {stat('재고', `${fmt(product.current_stock)}개`)}
          {stat('재고가치', product.current_stock > 0 ? `${fmt(product.stock_value)}원` : '—')}
          {stat('수수료율', `${(product.platform_fee_rate * 100).toFixed(1)}%`)}
          {channelFilter === 'rg' && stat('RG실재고', (() => {
            const v = rgInventory.get(product.id);
            return v === null || v === undefined ? '—' : `${fmt(v)}개`;
          })())}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              onClick={() => onOpenDrawer(product.id)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#3f3f46' }}
            >
              입고·판매 관리
            </button>
            {!editingAd ? (
              <button
                onClick={() => { if (!isEditablePeriod) return; setEditingAd(true); setAdValue(product.ad_spend > 0 ? String(product.ad_spend) : ''); }}
                title={!isEditablePeriod ? '단일 월을 선택하면 편집할 수 있습니다' : undefined}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: isEditablePeriod ? 'pointer' : 'default', color: product.ad_spend > 0 ? '#7c3aed' : '#a1a1aa' }}
              >
                광고비 {product.ad_spend > 0 ? fmt(product.ad_spend) : '입력'}
              </button>
            ) : (
              <input
                autoFocus
                aria-label="광고비 입력"
                type="number"
                min="0"
                value={adValue}
                onChange={(e) => setAdValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onSaveAdSpend(product.id, adValue); setEditingAd(false); }
                  if (e.key === 'Escape') setEditingAd(false);
                }}
                onBlur={() => { onSaveAdSpend(product.id, adValue); setEditingAd(false); }}
                style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid #7c3aed', fontSize: 12 }}
              />
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
