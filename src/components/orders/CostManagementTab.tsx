'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Truck, Search, Trash2 } from 'lucide-react';
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
  total_revenue: number;
  total_net_profit_amount: number;
}

type Preset = 'this_month' | 'last_month' | '3months' | '6months' | 'all' | 'custom';

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
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [summary, setSummary] = useState({ total_purchase_amount: 0, total_revenue: 0, total_net_profit_amount: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

      function getDateRange(p: Preset): { from: string; to: string } | null {
        if (p === 'all') return null;
        if (p === 'custom') {
          if (customFrom && customTo) return { from: customFrom, to: customTo };
          return null;
        }
        if (p === 'this_month') {
          return {
            from: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)),
            to: fmtDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
          };
        }
        if (p === 'last_month') {
          return {
            from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
            to: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)),
          };
        }
        if (p === '3months') {
          return {
            from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
            to: fmtDate(today),
          };
        }
        // 6months
        return {
          from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 5, 1)),
          to: fmtDate(today),
        };
      }

      const range = getDateRange(preset);
      const qs = range ? `?from=${range.from}&to=${range.to}` : '';
      const res = await fetch(`/api/cost-management/products${qs}`);
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
        setSummary(json.summary ?? { total_purchase_amount: 0, total_revenue: 0, total_net_profit_amount: 0 });
      }
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  async function deleteProduct(id: string, name: string) {
    if (!confirm(`"${name}" 상품을 삭제할까요?\n입고 내역도 모두 함께 삭제됩니다.`)) return;
    const res = await fetch(`/api/cost-management/products/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) load();
    else alert(json.error ?? '삭제에 실패했습니다.');
  }

  const filtered = products.filter((p) =>
    p.product_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      {/* 기간 필터 */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', color: '#52525b', fontWeight: 600, marginRight: '4px' }}>기간</span>
        {([
          { id: 'this_month', label: '이번 달' },
          { id: 'last_month', label: '지난 달' },
          { id: '3months', label: '최근 3개월' },
          { id: '6months', label: '최근 6개월' },
          { id: 'all', label: '전체' },
          { id: 'custom', label: '직접 입력' },
        ] as { id: Preset; label: string }[]).map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            style={{
              padding: '5px 12px', borderRadius: '20px', border: `1px solid ${preset === p.id ? '#be0014' : '#e5e5e5'}`,
              background: preset === p.id ? '#be0014' : '#fff',
              color: preset === p.id ? '#fff' : '#52525b',
              fontSize: '12px', fontWeight: preset === p.id ? 600 : 400, cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '4px' }}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #d4d4d8', fontSize: '12px', color: '#18181b' }} />
            <span style={{ color: '#71717a', fontSize: '12px' }}>~</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #d4d4d8', fontSize: '12px', color: '#18181b' }} />
          </div>
        )}
      </div>

      {/* 요약 카드 — 기간 집계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: '관리 상품 수', value: `${products.length}개`, color: '#18181b', sub: undefined },
          { label: '기간 총 매입비', value: `${fmt(summary.total_purchase_amount)}원`, color: '#ef4444', sub: '입고 단가 × 수량 합계' },
          { label: '기간 추정 매출', value: `${fmt(summary.total_revenue)}원`, color: '#2563eb', sub: '판매가 × 수량 합계' },
          {
            label: '기간 순이익',
            value: `${fmt(summary.total_net_profit_amount)}원`,
            color: summary.total_net_profit_amount >= 0 ? '#16a34a' : '#ef4444',
            sub: `마진율 ${summary.total_revenue > 0 ? ((summary.total_net_profit_amount / summary.total_revenue) * 100).toFixed(1) : '0.0'}%`,
          },
        ].map((c) => (
          <div key={c.label} style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: c.color }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: '10px', color: '#71717a', marginTop: '2px' }}>{c.sub}</div>}
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
                {['상품명', '판매가(가중평균)', '원가(가중평균)', '배송비(배분)', '수수료', '순이익', '마진율', '재고', '내역', ''].map((h) => (
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
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <button
                        onClick={() => deleteProduct(p.id, p.product_name)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', opacity: 0.25 }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.25')}
                        title="상품 삭제"
                      >
                        <Trash2 size={13} color="#ef4444" />
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
