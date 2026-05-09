'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Truck, Search } from 'lucide-react';
import CostEntryDrawer from './CostEntryDrawer';
import ShippingGroupModal from './ShippingGroupModal';
import AddProductModal from './AddProductModal';

interface ProductRow {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  platform_fee_rate: number;
  current_stock: number;
  entry_count: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_selling_price: number;
  fee: number;
  net_profit: number;
  margin_rate: number;
  total_quantity: number;
  total_purchase_amount: number;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export default function CostManagementTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cost-management/products');
      const json = await res.json();
      if (json.success) setProducts(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = products.filter((p) =>
    p.product_name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalPurchase = products.reduce((s, p) => s + p.total_purchase_amount, 0);
  const avgMargin =
    products.length > 0
      ? products.reduce((s, p) => s + p.margin_rate, 0) / products.length
      : 0;
  const riskCount = products.filter((p) => p.entry_count > 0 && p.margin_rate < 5).length;

  return (
    <div>
      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: '관리 상품 수', value: `${products.length}개`, color: '#18181b' },
          { label: '총 매입 금액', value: `${fmt(totalPurchase)}원`, color: '#18181b' },
          { label: '평균 마진율', value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 10 ? '#16a34a' : avgMargin >= 0 ? '#ca8a04' : '#ef4444' },
          { label: '마진 위험 상품', value: `${riskCount}개`, color: riskCount > 0 ? '#ef4444' : '#16a34a', sub: '마진율 5% 미만' },
        ].map((c) => (
          <div key={c.label} style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: c.color }}>{c.value}</div>
            {'sub' in c && c.sub && <div style={{ fontSize: '10px', color: '#71717a' }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#be0014', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Plus size={13} /> 상품 추가
        </button>
        <button
          onClick={() => setShowShippingModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#333', border: '1px solid #e5e5e5', fontSize: '12px', cursor: 'pointer' }}
        >
          <Truck size={13} /> 배송비 그룹 생성
        </button>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 검색..."
            style={{ padding: '8px 12px 8px 30px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', width: '180px' }}
          />
        </div>
      </div>

      {/* 테이블 */}
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>
            {search ? '검색 결과가 없습니다.' : '상품을 추가해주세요.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                {['상품명', '판매가(가중평균)', '원가(가중평균)', '배송비(배분)', '수수료', '순이익', '마진율', '재고', '내역'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === '상품명' ? 'left' : 'right', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isRisk = p.entry_count > 0 && p.margin_rate < 5;
                const noEntries = p.entry_count === 0;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: isRisk ? '#fff9f9' : '#fff' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: noEntries ? '#999' : '#18181b' }}>{p.product_name}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : undefined }}>{noEntries ? '—' : fmt(p.weighted_avg_selling_price)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#ef4444' }}>{noEntries ? '—' : fmt(p.weighted_avg_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#f97316' }}>{noEntries ? '—' : fmt(p.weighted_avg_shipping)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#f97316' }}>{noEntries ? '—' : fmt(p.fee)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: noEntries ? '#ccc' : p.net_profit >= 0 ? '#16a34a' : '#ef4444' }}>
                      {noEntries ? '—' : fmt(p.net_profit)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {noEntries ? <span style={{ color: '#ccc' }}>—</span> : (
                        <span style={{ background: isRisk ? '#fef2f2' : p.margin_rate >= 10 ? '#f0fdf4' : '#fefce8', color: isRisk ? '#ef4444' : p.margin_rate >= 10 ? '#16a34a' : '#ca8a04', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                          {p.margin_rate.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{ color: '#18181b' }}>{fmt(p.current_stock)}개</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => setDrawerProductId(p.id)}
                        style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e5e5', background: '#fff', fontSize: '11px', cursor: 'pointer', color: '#555' }}
                      >
                        📋 {p.entry_count}건
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
        수수료 = 판매가(가중평균) × 수수료율 &nbsp;|&nbsp; 순이익 = 판매가 − 원가 − 배송비 − 수수료
      </div>

      {drawerProductId && (
        <CostEntryDrawer
          productId={drawerProductId}
          productName={products.find((p) => p.id === drawerProductId)?.product_name ?? ''}
          onClose={() => setDrawerProductId(null)}
          onChanged={load}
        />
      )}
      {showShippingModal && (
        <ShippingGroupModal
          products={products.filter((p) => p.entry_count > 0)}
          onClose={() => setShowShippingModal(false)}
          onCreated={load}
        />
      )}
      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onAdded={load}
        />
      )}
    </div>
  );
}
