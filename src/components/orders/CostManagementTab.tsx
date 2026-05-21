'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Truck, Package, Search, Trash2, TrendingUp, TrendingDown, AlertCircle, CloudDownload } from 'lucide-react';
import CostEntryDrawer from './CostEntryDrawer';
import ShippingGroupModal from './ShippingGroupModal';
import AddProductModal from './AddProductModal';
import RocketGrowthShipmentModal from './RocketGrowthShipmentModal';
import { WinnerBadge } from '@/components/ui';

interface ProductRow {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  vendor_item_id: number | null;
  platform_fee_rate: number;
  entry_count: number;
  sale_count: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_rg_shipping: number;
  total_purchase_amount: number;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
  ad_spend: number;
  ad_roas: number;
  margin_rate: number;
  breakeven_roas: number;
  winner_status: 'winner' | 'watch' | 'normal';
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface OrderItem {
  orderPrice: number;
}

interface UnifiedOrder {
  status: string;
  orderedAt: string;
  platform: 'coupang' | 'naver';
  orderItems: OrderItem[];
}

interface ApiRevenue {
  totalRevenue: number;
  totalOrders: number;
  cancelCount: number;
  coupangRevenue: number;
  naverRevenue: number;
  coupangOrders: number;
  naverOrders: number;
  rgRevenue: number;
  rgOrders: number;
  prevTotalRevenue: number;
  prevTotalOrders: number;
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────

type Preset = 'this_month' | 'last_month' | '3months' | '6months' | 'all' | 'custom';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDateRange(p: Preset, customFrom: string, customTo: string): { from: string; to: string } | null {
  const today = new Date();
  if (p === 'all') return null;
  if (p === 'custom') {
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return null;
  }
  if (p === 'this_month') {
    return {
      from: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: toDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (p === 'last_month') {
    return {
      from: toDateStr(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: toDateStr(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  if (p === '3months') {
    return {
      from: toDateStr(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
      to: toDateStr(today),
    };
  }
  return {
    from: toDateStr(new Date(today.getFullYear(), today.getMonth() - 5, 1)),
    to: toDateStr(today),
  };
}

const CANCELLED = new Set([
  'CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE',
  'CANCELED', 'RETURNED',
]);

async function fetchRgRevenue(from: string, to: string): Promise<{ revenue: number; orders: number }> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/orders/coupang-rg?${params}`);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error ?? '로켓그로스 조회 실패');
  const items = (json.data?.items ?? []) as Array<{ items: Array<{ saleAmount: number }> }>;
  const revenue = items.reduce((s, o) => s + o.items.reduce((is, i) => is + i.saleAmount, 0), 0);
  return { revenue, orders: items.length };
}

async function fetchOrdersForPeriod(from: string, to: string): Promise<{ orders: UnifiedOrder[]; coupangError: string | null; naverError: string | null }> {
  const params = new URLSearchParams({ from, to });
  const [coupangResult, naverResult] = await Promise.allSettled([
    fetch(`/api/orders/coupang?${params}`).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? '쿠팡 주문 조회 실패');
      return (json.data?.items ?? []) as Array<{ status: string; orderedAt: string; orderItems: OrderItem[] }>;
    }),
    fetch(`/api/orders/naver?${params}`).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? '네이버 주문 조회 실패');
      return (json.data?.items ?? []) as Array<{ status: string; orderedAt: string; orderItems: OrderItem[] }>;
    }),
  ]);
  const orders: UnifiedOrder[] = [];
  if (coupangResult.status === 'fulfilled') {
    orders.push(...coupangResult.value.map((o) => ({ ...o, platform: 'coupang' as const })));
  }
  if (naverResult.status === 'fulfilled') {
    orders.push(...naverResult.value.map((o) => ({ ...o, platform: 'naver' as const })));
  }
  return {
    orders,
    coupangError: coupangResult.status === 'rejected' ? (coupangResult.reason instanceof Error ? coupangResult.reason.message : '조회 실패') : null,
    naverError: naverResult.status === 'rejected' ? (naverResult.reason instanceof Error ? naverResult.reason.message : '조회 실패') : null,
  };
}

function computeApiRevenue(curr: UnifiedOrder[], prev: UnifiedOrder[]): ApiRevenue {
  const active = (orders: UnifiedOrder[]) => orders.filter((o) => !CANCELLED.has(o.status));
  const sum = (orders: UnifiedOrder[]) => active(orders).reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0);

  const currActive = active(curr);
  const coupangActive = currActive.filter((o) => o.platform === 'coupang');
  const naverActive = currActive.filter((o) => o.platform === 'naver');

  return {
    totalRevenue: sum(curr),
    totalOrders: currActive.length,
    cancelCount: curr.filter((o) => CANCELLED.has(o.status)).length,
    coupangRevenue: coupangActive.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0),
    naverRevenue: naverActive.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0),
    coupangOrders: coupangActive.length,
    naverOrders: naverActive.length,
    prevTotalRevenue: sum(prev),
    prevTotalOrders: active(prev).length,
    rgRevenue: 0,
    rgOrders: 0,
  };
}

function changePct(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function fmtRevenue(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}천만`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString();
}

export default function CostManagementTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRgModal, setShowRgModal] = useState(false);
  const [importingRg, setImportingRg] = useState(false);
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [summary, setSummary] = useState({ total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
  const [apiRevenue, setApiRevenue] = useState<ApiRevenue | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = getDateRange(preset, customFrom, customTo);
      const qs = range ? `?from=${range.from}&to=${range.to}` : '';
      const res = await fetch(`/api/cost-management/products${qs}`);
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
        setSummary(json.summary ?? { total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
      }
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo]);

  async function runRgBulkImport() {
    setImportingRg(true);
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const res = await fetch('/api/cost-management/rg-bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`RG 판매 ${json.data.imported}건 가져오기 완료 (중복 ${json.data.skipped}건 스킵)`);
        load();
      } else {
        alert(json.error ?? 'RG 가져오기 실패');
      }
    } finally {
      setImportingRg(false);
    }
  }

  const fetchApiRevenue = useCallback(async () => {
    const range = getDateRange(preset, customFrom, customTo);
    if (!range) {
      setApiRevenue(null);
      return;
    }
    setApiLoading(true);
    setApiWarnings([]);
    try {
      const { from, to } = range;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
      const prevTo = new Date(fromDate.getTime() - 86_400_000);
      const prevFrom = new Date(prevTo.getTime() - daysDiff * 86_400_000);

      const rgFallback = { revenue: 0, orders: 0 };
      // 주문 API(orders)와 RG API(revenue-history)를 동시 호출하되,
      // RG 이전 기간 조회는 현재 기간 완료 후 순차 실행 — 동시 429 방지
      const [currResult, prevResult, rgResult] = await Promise.all([
        fetchOrdersForPeriod(from, to),
        fetchOrdersForPeriod(toDateStr(prevFrom), toDateStr(prevTo)),
        fetchRgRevenue(from, to).catch((e: unknown) => ({
          ...rgFallback,
          error: e instanceof Error ? e.message : '조회 실패',
        })),
      ]);
      const rgPrevResult = await fetchRgRevenue(toDateStr(prevFrom), toDateStr(prevTo)).catch(() => rgFallback);

      const warnings: string[] = [];
      if (currResult.coupangError) warnings.push(`쿠팡: ${currResult.coupangError}`);
      if (currResult.naverError) warnings.push(`네이버: ${currResult.naverError}`);
      if ('error' in rgResult) warnings.push(`로켓그로스: ${rgResult.error}`);
      setApiWarnings(warnings);

      const base = computeApiRevenue(currResult.orders, prevResult.orders);
      setApiRevenue({
        ...base,
        totalRevenue: base.totalRevenue + rgResult.revenue,
        totalOrders: base.totalOrders + rgResult.orders,
        prevTotalRevenue: base.prevTotalRevenue + rgPrevResult.revenue,
        prevTotalOrders: base.prevTotalOrders + rgPrevResult.orders,
        rgRevenue: rgResult.revenue,
        rgOrders: rgResult.orders,
      });
    } catch {
      setApiWarnings(['API 매출 조회 중 오류가 발생했습니다.']);
      setApiRevenue(null);
    } finally {
      setApiLoading(false);
    }
  }, [preset, customFrom, customTo]);

  useEffect(() => { load(); fetchApiRevenue(); }, [load, fetchApiRevenue]);

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

      {/* 섹션 A — 실제 매출 (API 기반) */}
      {(preset === 'all' || (preset === 'custom' && (!customFrom || !customTo))) ? (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', fontSize: '12px', color: '#92400e' }}>
          {preset === 'all'
            ? '전체 기간 선택 시 API 매출 조회는 생략됩니다. 특정 기간을 선택해주세요.'
            : '시작일과 종료일을 모두 입력하면 실제 매출이 조회됩니다.'}
        </div>
      ) : apiLoading ? (
        <div style={{ textAlign: 'center', padding: '24px', color: '#71717a', fontSize: '12px', marginBottom: '12px' }}>
          실제 매출 데이터를 불러오는 중...
        </div>
      ) : (
        <>
          {apiWarnings.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertCircle size={14} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>일부 채널 조회 실패</span>
                {apiWarnings.map((w, i) => (
                  <p key={i} style={{ fontSize: '11px', color: '#92400e', margin: '2px 0 0' }}>{w}</p>
                ))}
              </div>
            </div>
          )}
          {apiRevenue && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', marginBottom: '6px' }}>
                실제 매출 <span style={{ fontWeight: 400 }}>(쿠팡 + 네이버 + 로켓그로스 API · 취소/반품 제외)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '10px', marginBottom: '10px' }}>
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>실제 총 매출</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#18181b' }}>{fmtRevenue(apiRevenue.totalRevenue)}원</div>
                  {(() => {
                    const pct = changePct(apiRevenue.totalRevenue, apiRevenue.prevTotalRevenue);
                    return pct !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                        {pct >= 0 ? <TrendingUp size={11} color="#16a34a" /> : <TrendingDown size={11} color="#dc2626" />}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '+' : ''}{pct}%</span>
                        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전기 대비</span>
                      </div>
                    ) : <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>비교 데이터 없음</div>;
                  })()}
                </div>
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>주문 건수</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#18181b' }}>{apiRevenue.totalOrders}건</div>
                  {(() => {
                    const pct = changePct(apiRevenue.totalOrders, apiRevenue.prevTotalOrders);
                    return pct !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                        {pct >= 0 ? <TrendingUp size={11} color="#16a34a" /> : <TrendingDown size={11} color="#dc2626" />}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '+' : ''}{pct}%</span>
                        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전기 대비</span>
                      </div>
                    ) : <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>비교 데이터 없음</div>;
                  })()}
                </div>
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>쿠팡</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#be0014' }}>{fmtRevenue(apiRevenue.coupangRevenue)}원</div>
                  <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>{apiRevenue.coupangOrders}건</div>
                </div>
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>네이버</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#03c75a' }}>{fmtRevenue(apiRevenue.naverRevenue)}원</div>
                  <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>{apiRevenue.naverOrders}건</div>
                </div>
                <div style={{ background: '#f0f9ff', borderRadius: '10px', padding: '14px', border: '1px solid #bae6fd' }}>
                  <div style={{ fontSize: '11px', color: '#0369a1', marginBottom: '4px', fontWeight: 600 }}>로켓그로스</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#0284c7' }}>{fmtRevenue(apiRevenue.rgRevenue)}원</div>
                  <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>{apiRevenue.rgOrders}건</div>
                </div>
              </div>
              {apiRevenue.cancelCount > 0 && (
                <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '10px' }}>
                  취소/반품 {apiRevenue.cancelCount}건 제외됨
                </div>
              )}
            </>
          )}
        </>
      )}

      <div style={{ height: '1px', background: '#e5e5e5', margin: '4px 0 14px' }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', marginBottom: '8px' }}>
        원가·수익 <span style={{ fontWeight: 400 }}>(수동 입력 기반)</span>
      </div>

      {/* 요약 카드 — 기간 집계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: '관리 상품 수', value: `${products.length}개`, color: '#18181b', sub: undefined },
          { label: '기간 총 매입비', value: `${fmt(summary.total_purchase_amount)}원`, color: '#ef4444', sub: '입고 단가 × 수량 합계' },
          { label: '기간 총 매출', value: `${fmt(summary.total_sales_amount)}원`, color: '#2563eb', sub: '판매가 × 수량 합계' },
          {
            label: '기간 실현손익',
            value: `${fmt(summary.total_realized_profit)}원`,
            color: summary.total_realized_profit >= 0 ? '#16a34a' : '#ef4444',
            sub: `마진율 ${summary.total_sales_amount > 0 ? ((summary.total_realized_profit / summary.total_sales_amount) * 100).toFixed(1) : '0.0'}%`,
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
        <button
          onClick={() => setShowRgModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '12px', cursor: 'pointer' }}
        >
          <Package size={13} /> 로켓그로스 입고 등록
        </button>
        <button
          onClick={runRgBulkImport}
          disabled={importingRg}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '12px', cursor: importingRg ? 'not-allowed' : 'pointer', opacity: importingRg ? 0.6 : 1 }}
        >
          <CloudDownload size={13} /> {importingRg ? 'RG 가져오는 중...' : 'RG 판매 가져오기'}
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
                {['채널', '상품명', '원가(가중평균)', '배송비(배분)', 'RG배송비', '재고', '재고가치', '실현손익', '마진율', '광고비', 'ROAS', '위너', '입고', '판매', '내역', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === '상품명' ? 'left' : h === '채널' ? 'center' : 'right', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {p.seller_product_id && (
                      <span style={{ background: '#fef2f2', color: '#be0014', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', display: 'inline-block' }}>윙판매</span>
                    )}
                    {p.vendor_item_id && (
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', display: 'inline-block', marginLeft: p.seller_product_id ? '3px' : '0' }}>RG</span>
                    )}
                    {!p.seller_product_id && !p.vendor_item_id && (
                      <span style={{ color: '#ccc', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: p.entry_count === 0 ? '#999' : '#18181b' }}>{p.product_name}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#ef4444' }}>
                    {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_cost)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#f97316' }}>
                    {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_shipping)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: p.weighted_avg_rg_shipping > 0 ? '#0369a1' : '#ccc' }}>
                    {p.weighted_avg_rg_shipping > 0 ? fmt(p.weighted_avg_rg_shipping) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#18181b' }}>
                    {fmt(p.current_stock)}개
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>
                    {p.current_stock > 0 ? `${fmt(p.stock_value)}원` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: p.total_realized_profit >= 0 ? '#16a34a' : '#ef4444' }}>
                    {p.sale_count === 0 ? <span style={{ color: '#ccc' }}>—</span> : `${fmt(p.total_realized_profit)}원`}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: p.margin_rate > 0 ? '#2563eb' : '#ccc' }}>
                    {p.margin_rate > 0 ? `${(p.margin_rate * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: p.ad_spend > 0 ? '#7c3aed' : '#ccc' }}>
                    {p.ad_spend > 0 ? `${fmt(p.ad_spend)}원` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: p.ad_roas > 0 ? 600 : 400,
                    color: p.ad_roas === 0 ? '#ccc' : p.ad_roas >= 250 ? '#16a34a' : '#ef4444' }}>
                    {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <WinnerBadge status={p.winner_status} />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>{p.entry_count}건</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>{p.sale_count}건</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      onClick={() => setDrawerProductId(p.id)}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e5e5', background: '#fff', fontSize: '11px', cursor: 'pointer', color: '#555' }}
                    >
                      📋 보기
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
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
        실현손익 = FIFO 원가 기준 (판매가 − 입고원가 − 배송비 − RG배송비 − 수수료)
      </div>

      {drawerProductId && (() => {
        const dp = products.find((p) => p.id === drawerProductId);
        return (
          <CostEntryDrawer
            productId={drawerProductId}
            productName={dp?.product_name ?? ''}
            sellerProductId={dp?.seller_product_id ?? null}
            vendorItemId={dp?.vendor_item_id ?? null}
            onClose={() => setDrawerProductId(null)}
            onChanged={load}
          />
        );
      })()}
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
      {showRgModal && (
        <RocketGrowthShipmentModal
          products={products.filter((p) => p.current_stock > 0).map((p) => ({
            id: p.id,
            product_name: p.product_name,
            current_stock: p.current_stock,
          }))}
          onClose={() => setShowRgModal(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
