'use client';

import React, { useState, useEffect, useRef } from 'react';

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
  dateRange: { from: string; to: string } | null;
  onOpenDrawer: (productId: string) => void;
  onSaveAdSpend: (productId: string, adDate: string, value: string) => Promise<boolean>;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
  rgInventoryLoading: boolean;
  fifoError?: boolean;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

export default function ProductDetailPanel({
  product, colSpan, dateRange, onOpenDrawer, onSaveAdSpend, channelFilter, rgInventory, rgInventoryLoading, fifoError,
}: Props) {
  const [adByDate, setAdByDate] = useState<Record<string, number>>({});
  const [adLoading, setAdLoading] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 프리미티브 값으로 추출해 객체 레퍼런스 변화에 따른 불필요한 재실행 방지
  const adFrom = dateRange?.from ?? '';
  const adTo = dateRange?.to ?? '';

  useEffect(() => {
    if (!adFrom || !adTo) return;
    const id = product.id;

    async function loadAdSpend() {
      setAdLoading(true);
      try {
        const r = await fetch(
          `/api/cost-management/products/${id}/ad-spend?from=${adFrom}&to=${adTo}`,
        );
        const json = await r.json();
        if (json.success) {
          const map: Record<string, number> = {};
          for (const d of json.data as Array<{ ad_date: string; ad_spend: number }>) {
            map[d.ad_date] = d.ad_spend;
          }
          setAdByDate(map);
        }
      } finally {
        setAdLoading(false);
      }
    }

    void loadAdSpend();
  }, [product.id, adFrom, adTo]);

  // Enter는 commitEdit → setEditingDate(null)로 input을 언마운트시켜 onBlur가
  // commitEdit을 재호출한다. 같은 날짜에 대한 이중 커밋(PATCH·재조회 2회)을 막는다.
  const committingRef = useRef<string | null>(null);
  const commitEdit = async (adDate: string) => {
    if (committingRef.current === adDate) return;
    committingRef.current = adDate;
    const num = parseFloat(editValue.replace(/,/g, ''));
    const safe = isNaN(num) || num < 0 ? 0 : num;
    const prev = adByDate[adDate];
    setAdByDate((m) => ({ ...m, [adDate]: safe })); // 낙관적
    setEditingDate(null);
    try {
      const ok = await onSaveAdSpend(product.id, adDate, String(safe));
      if (!ok) {
        // 저장 실패 시 롤백
        setAdByDate((m) => {
          const next = { ...m };
          if (prev === undefined) delete next[adDate];
          else next[adDate] = prev;
          return next;
        });
      }
    } finally {
      committingRef.current = null;
    }
  };

  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#a1a1aa' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#3f3f46' }}>{value}</span>
    </div>
  );

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: '#fafafa', padding: '14px 20px', borderBottom: '1px solid #eee' }}>
        {fifoError && (
          <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, fontWeight: 500 }}>
            ⚠ 판매 수량이 입고 수량을 초과했습니다. 입고를 추가하거나 판매 내역을 확인하세요. (재고·실현손익이 정확히 계산되지 않습니다.)
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}>
          {stat('원가(가중평균)', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_cost)}원`)}
          {stat('배송비', product.entry_count === 0 ? '—' : `${fmt(product.weighted_avg_shipping)}원`)}
          {stat('RG배송비', product.weighted_avg_rg_shipping > 0 ? `${fmt(product.weighted_avg_rg_shipping)}원` : '—')}
          {stat('재고', `${fmt(product.current_stock)}개`)}
          {stat('재고가치', product.current_stock > 0 ? `${fmt(product.stock_value)}원` : '—')}
          {stat('수수료율', `${(product.platform_fee_rate * 100).toFixed(1)}%`)}
          {channelFilter === 'rg' && stat('RG실재고', (() => {
            const v = rgInventory.get(product.id);
            if (rgInventoryLoading && (v === null || v === undefined)) return '조회 중…';
            return v === null || v === undefined ? '—' : `${fmt(v)}개`;
          })())}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              onClick={() => onOpenDrawer(product.id)}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#3f3f46' }}
            >
              입고·판매 관리
            </button>
          </div>
        </div>

        {/* 광고비 (날짜별) */}
        <div style={{ marginTop: 14, borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: '#71717a', fontWeight: 600, marginBottom: 6 }}>
            광고비 {dateRange ? `(${dateRange.from} ~ ${dateRange.to})` : ''}
          </div>
          {!dateRange ? (
            <div style={{ fontSize: 11, color: '#a1a1aa' }}>
              특정 기간(이번 달·직접 입력 등)을 선택하면 날짜별로 입력할 수 있습니다.
            </div>
          ) : adLoading ? (
            <div style={{ fontSize: 11, color: '#a1a1aa' }}>불러오는 중…</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 320 }}>
              {eachDate(dateRange.from, dateRange.to).map((d) => {
                const val = adByDate[d] ?? 0;
                return (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '3px 6px', borderRadius: 6 }}>
                    <span style={{ fontSize: 11, color: '#71717a', fontVariantNumeric: 'tabular-nums' }}>{d.slice(5)}</span>
                    {editingDate === d ? (
                      <input
                        autoFocus
                        aria-label={`${d} 광고비 입력`}
                        type="number"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(d);
                          if (e.key === 'Escape') setEditingDate(null);
                        }}
                        onBlur={() => commitEdit(d)}
                        style={{ width: 100, padding: '3px 6px', borderRadius: 6, border: '1px solid #7c3aed', fontSize: 12, textAlign: 'right' }}
                      />
                    ) : (
                      <button
                        onClick={() => { setEditingDate(d); setEditValue(val > 0 ? String(val) : ''); }}
                        style={{ minWidth: 100, textAlign: 'right', padding: '3px 6px', borderRadius: 6, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: val > 0 ? '#7c3aed' : '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {val > 0 ? `₩ ${fmt(val)}` : '입력'}
                      </button>
                    )}
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px', borderTop: '1px solid #eee', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#3f3f46', fontWeight: 600 }}>합계</span>
                <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  ₩ {fmt(Object.values(adByDate).reduce((s, v) => s + v, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
