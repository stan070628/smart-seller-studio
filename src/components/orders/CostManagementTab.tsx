'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { buildTableItems, type GroupRow as GroupRowType } from '@/lib/cost-management/product-grouping';
import { determineWinnerStatus } from '@/lib/roi/calculations';
import { Plus, Truck, Package, Search, TrendingUp, TrendingDown, AlertCircle, CloudDownload, Eye, EyeOff } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import CostEntryDrawer from './CostEntryDrawer';
import ShippingGroupModal from './ShippingGroupModal';
import AddProductModal from './AddProductModal';
import RocketGrowthShipmentModal from './RocketGrowthShipmentModal';
import RgShipmentHistoryPopover from './RgShipmentHistoryPopover';
import ChannelEditPopover from './ChannelEditPopover';
import { buildImportSummary, type ImportSummary } from './import-summary';
import GroupRow from './cost-table/GroupRow';
import ProductRowComponent from './cost-table/ProductRow';
import ProductDetailPanel from './cost-table/ProductDetailPanel';

interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
  unit_multiplier: number;
}

interface ProductRow {
  id: string;
  product_name: string;
  seller_product_id: number;
  vendor_item_id: number | null;
  naver_channel_product_no: number | null;
  variants: Record<string, string> | null;
  naver_variants: Record<string, string> | null;
  naver_origin_product_no: number | null;
  subdivision_unit: number | null;
  platform_fee_rate: number;
  entry_count: number;
  sale_count: number;
  sale_quantity: number;
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
  fifo_error: boolean;
  hidden: boolean;
  download_coupon_policy: { rate: number; max_discount: number; min_price: number; } | null;
  channels: ChannelEntry[];
  [key: string]: unknown;
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(new Set());
  const toggleDetail = (id: string) =>
    setExpandedDetailIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRgModal, setShowRgModal] = useState(false);
  const [showRgHistory, setShowRgHistory] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [settingUpVariants, setSettingUpVariants] = useState(false);
  const [channelEditTarget, setChannelEditTarget] = useState<{
    product: ProductRow;
    anchorEl: HTMLElement;
  } | null>(null);
  const [preset, setPreset] = useState<Preset>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [summary, setSummary] = useState({ total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
  const [apiRevenue, setApiRevenue] = useState<ApiRevenue | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<'all' | 'rg' | 'wing' | 'naver'>('all');
  const [rgInventory, setRgInventory] = useState<Map<string, number | null>>(new Map());
  const [rgInventoryLoading, setRgInventoryLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  interface UndoToast { message: string; productsToRestore: ProductRow[]; }
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCloseRgHistory = useCallback(() => setShowRgHistory(false), []);

  const load = useCallback(async () => {
    setChannelEditTarget(null);
    setLoading(true);
    setLoadError(null);
    try {
      const range = getDateRange(preset, customFrom, customTo);
      const params = new URLSearchParams();
      if (range) { params.set('from', range.from); params.set('to', range.to); }
      if (channelFilter !== 'all') params.set('channel', channelFilter);
      if (showHidden) params.set('show_hidden', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/cost-management/products${qs}`);
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
        setSummary(json.summary ?? { total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
        setHiddenCount(json.summary?.hidden_count ?? 0);
      } else {
        setLoadError(json.error ?? '상품 목록 조회에 실패했습니다.');
        console.error('[products API error]', json.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '네트워크 오류';
      setLoadError(msg);
      console.error('[products load error]', e);
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo, channelFilter, showHidden]);

  async function runAllBulkImport() {
    setImportingAll(true);
    try {
      const range = getDateRange(preset, customFrom, customTo);
      const [rgRes, wingRes, naverRes] = await Promise.all([
        fetch('/api/cost-management/rg-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        fetch('/api/cost-management/wing-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(range ?? {}),
        }),
        fetch('/api/cost-management/naver-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(range ?? {}),
        }),
      ]);
      const [rgJson, wingJson, naverJson] = await Promise.all([
        rgRes.json(), wingRes.json(), naverRes.json(),
      ]);

      const summary = buildImportSummary([
        { channel: 'RG', json: rgJson },
        { channel: '윙', json: wingJson },
        { channel: '네이버', json: naverJson },
      ]);
      setImportResult(summary);
      setLastSyncedAt(
        new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      );
      load();
    } finally {
      setImportingAll(false);
    }
  }

  async function runBulkSetupVariants() {
    setSettingUpVariants(true);
    try {
      const res = await fetch('/api/cost-management/bulk-setup-variants', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const { updated, skipped, total } = json.data;
        toast.success(`variants 일괄 설정 완료 — 총 ${total}개 상품, ${updated}개 업데이트, ${skipped}개 스킵`);
        load();
      } else {
        toast.error(json.error ?? 'variants 설정 실패');
      }
    } finally {
      setSettingUpVariants(false);
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
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

  // channelFilter가 'rg'일 때 RG 실재고 조회
  useEffect(() => {
    if (channelFilter !== 'rg') { setRgInventory(new Map()); return; }
    setRgInventoryLoading(true);
    fetch('/api/cost-management/rg-inventory')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const map = new Map<string, number | null>();
          for (const item of json.data as Array<{ productCostId: string; actualStock: number | null }>) {
            map.set(item.productCostId, item.actualStock);
          }
          setRgInventory(map);
        }
      })
      .finally(() => setRgInventoryLoading(false));
  }, [channelFilter]);

  function showUndoToast(message: string, productsToRestore: ProductRow[]) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ message, productsToRestore });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
  }

  async function undoHide(productsToRestore: ProductRow[]) {
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (!showHidden) {
      setProducts((prev) => {
        const existingIds = new Set(prev.map((x) => x.id));
        const toAdd = productsToRestore
          .filter((p) => !existingIds.has(p.id))
          .map((p) => ({ ...p, hidden: false }));
        return [...prev, ...toAdd];
      });
    } else {
      setProducts((prev) =>
        prev.map((x) => {
          const match = productsToRestore.find((r) => r.id === x.id);
          return match ? { ...x, hidden: false } : x;
        })
      );
    }
    try {
      await Promise.all(
        productsToRestore.map((p) =>
          fetch(`/api/cost-management/products/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden: false }),
          }).then((r) => r.json())
        )
      );
      setHiddenCount((c) => Math.max(0, c - productsToRestore.length));
    } catch {
      load();
    }
  }

  async function toggleHide(p: ProductRow) {
    const savedProduct = { ...p };
    const newHidden = !p.hidden;
    if (!showHidden) {
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
    } else {
      setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, hidden: newHidden } : x));
    }
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: newHidden }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '실패');
      setHiddenCount((c) => newHidden ? c + 1 : Math.max(0, c - 1));
      if (newHidden) showUndoToast('숨겼어요. 데이터는 삭제되지 않았어요.', [savedProduct]);
    } catch (e) {
      load();
      toast.error(`숨김 처리 실패: ${e instanceof Error ? e.message : '오류'}`);
    }
  }

  async function toggleGroupHide(group: GroupRowType<ProductRow>) {
    const savedChildren = [...group.children];
    const allHidden = group.children.every((c) => c.hidden);
    const newHidden = !allHidden;
    const childIds = new Set(group.children.map((c) => c.id));

    if (!showHidden && newHidden) {
      setProducts((prev) => prev.filter((x) => !childIds.has(x.id)));
    } else {
      setProducts((prev) =>
        prev.map((x) => (childIds.has(x.id) ? { ...x, hidden: newHidden } : x))
      );
    }

    try {
      await Promise.all(
        group.children.map((child) =>
          fetch(`/api/cost-management/products/${child.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden: newHidden }),
          })
            .then((r) => r.json())
            .then((json) => {
              if (!json.success) throw new Error(json.error ?? '실패');
            })
        )
      );
      const delta = group.children.filter((c) => c.hidden !== newHidden).length;
      setHiddenCount((c) => (newHidden ? c + delta : Math.max(0, c - delta)));
      if (newHidden) showUndoToast(`옵션 ${savedChildren.length}개를 숨겼어요. 데이터는 삭제되지 않았어요.`, savedChildren);
    } catch (e) {
      load();
      toast.error(`그룹 숨김 처리 실패: ${e instanceof Error ? e.message : '오류'}`);
    }
  }

  async function deleteProduct(id: string, name: string) {
    if (!(await confirmDialog({ message: `"${name}" 상품을 삭제할까요?\n입고 내역도 모두 함께 삭제됩니다.`, danger: true }))) return;
    const res = await fetch(`/api/cost-management/products/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) load();
    else toast.error(json.error ?? '삭제에 실패했습니다.');
  }

  const tableItems = useMemo(() => {
    const filtered = products
      .filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.sale_count - a.sale_count);
    return buildTableItems(filtered);
  }, [products, search]);

  const COL_COUNT = 7;

  const isEditablePeriod =
    preset === 'this_month' ||
    preset === 'last_month' ||
    (preset === 'custom' &&
      customFrom !== '' &&
      customTo !== '' &&
      customFrom.slice(0, 7) === customTo.slice(0, 7));

  function toggleGroup(sellerProductId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sellerProductId)) next.delete(sellerProductId);
      else next.add(sellerProductId);
      return next;
    });
  }

  function handleProductUpdate(productId: string, updates: Partial<ProductRow>) {
    setProducts((prev) => prev.map((item) => item.id === productId ? { ...item, ...updates } : item));
  }

  async function saveAdSpend(productId: string, adDate: string, value: string) {
    const num = parseFloat(value.replace(/,/g, ''));
    if (isNaN(num) || num < 0) return;
    const res = await fetch(`/api/cost-management/products/${productId}/ad-spend`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ad_date: adDate, ad_spend: num }),
    });
    const json = await res.json();
    if (!json.success) {
      toast.error(json.error ?? '광고비 저장 실패');
      return;
    }
    // 저장 후 해당 상품의 기간 광고비 합계를 재조회해 행 지표 갱신
    const range = getDateRange(preset, customFrom, customTo);
    if (!range) return;
    const listRes = await fetch(
      `/api/cost-management/products/${productId}/ad-spend?from=${range.from}&to=${range.to}`,
    );
    const listJson = await listRes.json();
    if (!listJson.success) return;
    const total = (listJson.data as Array<{ ad_spend: number }>).reduce((s, d) => s + d.ad_spend, 0);
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        const newRoas = total > 0 ? (p.total_sales_amount / total) * 100 : 0;
        return {
          ...p,
          ad_spend: total,
          ad_roas: newRoas,
          winner_status: determineWinnerStatus(p.sale_quantity, newRoas, p.breakeven_roas),
        };
      }),
    );
  }

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

      {/* 채널 필터 */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', color: '#52525b', fontWeight: 600, marginRight: '4px' }}>채널</span>
        {([
          { id: 'all', label: '전체' },
          { id: 'wing', label: '윙판매' },
          { id: 'rg', label: 'RG' },
          { id: 'naver', label: '네이버' },
        ] as { id: 'all' | 'wing' | 'rg' | 'naver'; label: string }[]).map((ch) => (
          <button
            key={ch.id}
            onClick={() => setChannelFilter(ch.id)}
            style={{
              padding: '5px 12px', borderRadius: '20px',
              border: `1px solid ${channelFilter === ch.id ? (ch.id === 'naver' ? '#03c75a' : '#be0014') : '#e5e5e5'}`,
              background: channelFilter === ch.id ? (ch.id === 'naver' ? '#03c75a' : '#be0014') : '#fff',
              color: channelFilter === ch.id ? '#fff' : '#52525b',
              fontSize: '12px', fontWeight: channelFilter === ch.id ? 600 : 400, cursor: 'pointer',
            }}
          >
            {ch.label}
          </button>
        ))}
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
                실제 매출 · 플랫폼 확정 <span style={{ fontWeight: 400 }}>(쿠팡 + 네이버 + 로켓그로스 API 집계)</span>
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
      <div style={{ fontSize: 11, color: '#a1a1aa', margin: '0 0 8px' }}>
        실제 매출은 플랫폼 API 실시간 집계, 관리 손익은 입력한 원가·판매 기반 계산이라 값이 다를 수 있습니다.
      </div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', marginBottom: '8px' }}>
        관리 손익 · 내 입력 기반 <span style={{ fontWeight: 400 }}>(입고·판매 수동 관리)</span>
      </div>

      {/* 요약 카드 — 기간 집계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: '관리 상품 수', value: `${products.length}개`, color: '#18181b', sub: undefined },
          { label: '기간 총 매입비', value: `${fmt(summary.total_purchase_amount)}원`, color: '#ef4444', sub: '입고 단가 × 수량 합계' },
          {
            label: '기간 실현손익',
            value: `${fmt(summary.total_realized_profit)}원`,
            color: summary.total_realized_profit >= 0 ? '#16a34a' : '#ef4444',
            sub: apiRevenue && apiRevenue.totalRevenue > 0
              ? `마진율 ${((summary.total_realized_profit / apiRevenue.totalRevenue) * 100).toFixed(1)}%`
              : undefined,
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
        <div style={{ position: 'relative', display: 'flex', borderRadius: '8px', border: '1px solid #bae6fd' }}>
          <button
            onClick={() => setShowRgModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: '#fff', color: '#0369a1', border: 'none', fontSize: '12px', cursor: 'pointer', borderRadius: '8px 0 0 8px' }}
          >
            <Package size={13} /> 로켓그로스 입고 등록
          </button>
          <button
            onClick={() => setShowRgHistory((prev) => !prev)}
            style={{
              padding: '8px 10px',
              background: showRgHistory ? '#e0f2fe' : '#f0f9ff',
              color: '#0369a1', border: 'none', borderLeft: '1px solid #bae6fd',
              fontSize: '13px', cursor: 'pointer', fontWeight: 700,
              borderRadius: '0 8px 8px 0',
            }}
            title="입고 이력 보기"
          >
            🕐
          </button>
          {showRgHistory && (
            <RgShipmentHistoryPopover onClose={handleCloseRgHistory} />
          )}
        </div>
        <button
          onClick={runAllBulkImport}
          disabled={importingAll}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '12px', cursor: importingAll ? 'not-allowed' : 'pointer', opacity: importingAll ? 0.6 : 1 }}
        >
          <CloudDownload size={13} /> {importingAll ? '가져오는 중...' : '판매 가져오기'}
        </button>
        {lastSyncedAt && (
          <span style={{ fontSize: '11px', color: '#a1a1aa', alignSelf: 'center' }}>
            마지막 동기화 {lastSyncedAt}
          </span>
        )}
        <button
          onClick={runBulkSetupVariants}
          disabled={settingUpVariants}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#7c3aed', border: '1px solid #ddd6fe', fontSize: '12px', cursor: settingUpVariants ? 'not-allowed' : 'pointer', opacity: settingUpVariants ? 0.6 : 1 }}
        >
          {settingUpVariants ? '설정 중...' : '🏷️ variants 일괄 설정'}
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

      {/* 숨김 행 표시 토글 */}
      {hiddenCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <button
            onClick={() => setShowHidden((prev) => !prev)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 12px', borderRadius: '20px', fontSize: '12px',
              cursor: 'pointer',
              border: `1px solid ${showHidden ? '#71717a' : '#e5e5e5'}`,
              background: showHidden ? '#f4f4f5' : '#fff',
              color: '#52525b',
            }}
          >
            {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            {showHidden ? '숨긴 항목 숨기기' : '숨긴 항목 표시하기'}
          </button>
        </div>
      )}

      {/* 테이블 */}
      {loadError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', fontSize: '12px', color: '#be0014', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={14} /> 상품 목록 오류: {loadError}
        </div>
      )}
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>불러오는 중...</div>
        ) : tableItems.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>
            {search
              ? '검색 결과가 없습니다.'
              : hiddenCount > 0 && !showHidden
                ? `모든 상품을 숨겼어요. 위의 '숨긴 항목 표시하기' 버튼으로 복원할 수 있고, 데이터는 삭제되지 않았어요.`
                : '상품을 추가해주세요.'
            }
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e5e5' }}>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11, color: '#71717a', fontWeight: 600 }}>채널</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#71717a', fontWeight: 600 }}>상품명</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>매출(수량)</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>실현손익</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>마진율</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}>ROAS</th>
                <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: 11, color: '#71717a', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {tableItems.map((item) => {
                if (item.kind === 'group') {
                  const isGroupExpanded = expandedGroups.has(item.sellerProductId);
                  return (
                    <React.Fragment key={`group-${item.sellerProductId}`}>
                      <GroupRow
                        group={item}
                        expanded={isGroupExpanded}
                        colCount={COL_COUNT}
                        onToggleGroup={toggleGroup}
                        onToggleGroupHide={toggleGroupHide}
                      />
                      {isGroupExpanded && item.children.map((child) => (
                        <React.Fragment key={child.id}>
                          <ProductRowComponent
                            product={child}
                            isChild
                            expanded={expandedDetailIds.has(child.id)}
                            colCount={COL_COUNT}
                            onToggleDetail={toggleDetail}
                            onOpenDrawer={setDrawerProductId}
                            onHide={() => toggleHide(child)}
                            onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
                            onEditChannel={(_prod, anchorEl) => setChannelEditTarget({ product: child, anchorEl })}
                            onProductUpdate={handleProductUpdate}
                            isEditablePeriod={isEditablePeriod}
                            channelFilter={channelFilter}
                            rgInventory={rgInventory}
                          />
                          {expandedDetailIds.has(child.id) && (
                            <ProductDetailPanel
                              product={child}
                              colSpan={COL_COUNT}
                              isEditablePeriod={isEditablePeriod}
                              dateRange={getDateRange(preset, customFrom, customTo)}
                              onOpenDrawer={setDrawerProductId}
                              onSaveAdSpend={saveAdSpend}
                              channelFilter={channelFilter}
                              rgInventory={rgInventory}
                              rgInventoryLoading={rgInventoryLoading}
                              fifoError={child.fifo_error}
                            />
                          )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  );
                }
                const p = item.product;
                return (
                  <React.Fragment key={p.id}>
                    <ProductRowComponent
                      product={p}
                      isChild={false}
                      expanded={expandedDetailIds.has(p.id)}
                      colCount={COL_COUNT}
                      onToggleDetail={toggleDetail}
                      onOpenDrawer={setDrawerProductId}
                      onHide={() => toggleHide(p)}
                      onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
                      onEditChannel={(_prod, anchorEl) => setChannelEditTarget({ product: p, anchorEl })}
                      onProductUpdate={handleProductUpdate}
                      isEditablePeriod={isEditablePeriod}
                      channelFilter={channelFilter}
                      rgInventory={rgInventory}
                    />
                    {expandedDetailIds.has(p.id) && (
                      <ProductDetailPanel
                        product={p}
                        colSpan={COL_COUNT}
                        isEditablePeriod={isEditablePeriod}
                        dateRange={getDateRange(preset, customFrom, customTo)}
                        onOpenDrawer={setDrawerProductId}
                        onSaveAdSpend={saveAdSpend}
                        channelFilter={channelFilter}
                        rgInventory={rgInventory}
                        rgInventoryLoading={rgInventoryLoading}
                        fifoError={p.fifo_error}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
        실현손익 = FIFO 원가 기준 ((판매가−쿠폰할인) − 입고원가 − 배송비 − RG배송비 − 수수료)
      </div>

      {drawerProductId && (() => {
        const dp = products.find((p) => p.id === drawerProductId);
        return (
          <CostEntryDrawer
            productId={drawerProductId}
            productName={dp?.product_name ?? ''}
            sellerProductId={dp?.seller_product_id ?? null}
            vendorItemId={dp?.vendor_item_id ?? null}
            naverChannelProductNo={dp?.naver_channel_product_no ?? null}
            subdivisionUnit={dp?.subdivision_unit ?? null}
            variants={products.find((p) => p.id === drawerProductId)?.variants ?? null}
            downloadCouponPolicy={dp?.download_coupon_policy ?? null}
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
      {importResult && (
        <div style={{
          position: 'fixed', bottom: 84, right: 24,
          background: '#fff', color: '#18181b',
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
          zIndex: 9999, minWidth: 260, maxWidth: 340,
          border: '1px solid #e5e5e5',
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              판매 가져오기 — 신규 {importResult.totalImported}건{importResult.totalVoided > 0 ? ` · 취소 ${importResult.totalVoided}건` : ''}
            </span>
            <button
              onClick={() => setImportResult(null)}
              aria-label="닫기"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a1a1aa', fontSize: 16, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {importResult.channels.map((c) => (
              <div key={c.channel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#52525b', fontWeight: 600 }}>{c.channel}</span>
                {c.success ? (
                  <span style={{ color: '#16a34a' }}>
                    신규 {c.imported} · 스킵 {c.skipped}{c.voided > 0 ? ` · 취소 ${c.voided}` : ''}
                  </span>
                ) : (
                  <span style={{ color: '#ef4444' }}>실패 — {c.error}</span>
                )}
              </div>
            ))}
          </div>
          {importResult.hasError && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#d97706' }}>
              일부 채널 조회에 실패했습니다. 채널 설정/토큰을 확인해 주세요.
            </div>
          )}
        </div>
      )}
      {undoToast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: '#18181b', color: '#fff',
          borderRadius: 10, padding: '12px 16px', fontSize: 13,
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          <span>{undoToast.message}</span>
          <button
            onClick={() => undoHide(undoToast.productsToRestore)}
            style={{
              color: '#34d399', fontWeight: 600, border: 'none',
              background: 'none', cursor: 'pointer', fontSize: 13, padding: 0,
            }}
          >
            실행 취소
          </button>
        </div>
      )}
      {channelEditTarget && (
        <ChannelEditPopover
          product={channelEditTarget.product}
          anchorEl={channelEditTarget.anchorEl}
          onClose={() => setChannelEditTarget(null)}
          onChannelAdded={(entry) => {
            const target = channelEditTarget.product;
            handleProductUpdate(target.id, { channels: [...(target.channels ?? []), entry] });
          }}
          onChannelRemoved={(channelId) => {
            const target = channelEditTarget.product;
            handleProductUpdate(target.id, {
              channels: (target.channels ?? []).filter((ch) => ch.id !== channelId),
            });
          }}
          onSellerProductIdSaved={(newId) => {
            const target = channelEditTarget.product;
            handleProductUpdate(target.id, { seller_product_id: newId });
            // channelEditTarget도 갱신해서 재오픈 시 최신 값 반영
            setChannelEditTarget((prev) => prev ? { ...prev, product: { ...prev.product, seller_product_id: newId } } : null);
          }}
        />
      )}
    </div>
  );
}
