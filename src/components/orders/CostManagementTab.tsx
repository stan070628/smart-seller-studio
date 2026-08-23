'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { buildTableItems, type GroupRow as GroupRowType } from '@/lib/cost-management/product-grouping';
import { determineWinnerStatus } from '@/lib/roi/calculations';
import { Plus, Truck, Package, Search, TrendingUp, TrendingDown, AlertCircle, CloudDownload, Receipt, ClipboardPaste, ListPlus, RotateCcw } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import CostEntryDrawer from './CostEntryDrawer';
import ShippingGroupModal from './ShippingGroupModal';
import AddProductModal from './AddProductModal';
import BulkAddProductModal from './BulkAddProductModal';
import RocketGrowthShipmentModal from './RocketGrowthShipmentModal';
import ReceiptIngestModal from './ReceiptIngestModal';
import AdSpendPasteModal from './AdSpendPasteModal';
import RgShipmentHistoryPopover from './RgShipmentHistoryPopover';
import ChannelEditPopover from './ChannelEditPopover';
import { buildImportSummary, type ImportSummary } from './import-summary';
import GroupRow from './cost-table/GroupRow';
import ProductRowComponent from './cost-table/ProductRow';
import ProductDetailPanel from './cost-table/ProductDetailPanel';
import { useUrlParams, useDebouncedUrlParam } from '@/hooks/useUrlParams';
import { E } from '@/lib/design-tokens';
import {
  qFieldStyle, qLabelStyle, qValStyle, qTitleStyle, queryPanelStyle,
  segStyle, segBtnStyle, inputStyle, btnStyle, dividerStyle,
  bandStyle, thStyle, statNumStyle, statusBarStyle, Kpi,
} from './erp-ui';
import { useTabUiState } from '@/hooks/useTabUiState';
import { hasDraft } from '@/hooks/useDraftPersist';
import { ADD_PRODUCT_DRAFT_KEY, SHIPPING_GROUP_DRAFT_KEY, RG_SHIPMENT_DRAFT_KEY } from './draft-keys';

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
  total_entry_stock: number;
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

/** useTabUiState의 defaultValue로 매 렌더 새 Set을 만들지 않도록 고정 인스턴스를 쓴다. */
const EMPTY_SET: Set<string> = new Set();

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

const PRESET_VALUES: readonly Preset[] = ['this_month', 'last_month', '3months', '6months', 'all', 'custom'];
function isPreset(v: string): v is Preset {
  return (PRESET_VALUES as readonly string[]).includes(v);
}

const CHANNEL_FILTER_VALUES = ['all', 'rg', 'wing', 'naver'] as const;
type ChannelFilter = (typeof CHANNEL_FILTER_VALUES)[number];
function isChannelFilterValue(v: string): v is ChannelFilter {
  return (CHANNEL_FILTER_VALUES as readonly string[]).includes(v);
}

/** 조회조건 입력값. [조회]를 누르기 전까지는 URL에 반영되지 않는다. */
interface QueryDraft {
  preset: Preset;
  from: string;
  to: string;
  channelFilter: ChannelFilter;
  showHidden: boolean;
}

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
  // 검색어 — 로컬 값은 즉시 필터링에 쓰고, URL 반영만 디바운스한다(타이핑마다 주소가 안 바뀌게).
  const [search, setSearch] = useDebouncedUrlParam('search', '');
  // 펼침 목록(Set) — 탭 리마운트에도 살아남아야 하므로 URL이 아니라 UI 상태 슬라이스에 둔다.
  const [expandedGroups, setExpandedGroups] = useTabUiState<Set<string>>('cost:expandedGroups', EMPTY_SET);
  const [expandedDetailIds, setExpandedDetailIds] = useTabUiState<Set<string>>('cost:expandedDetailIds', EMPTY_SET);
  const toggleDetail = (id: string) =>
    setExpandedDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [showRgModal, setShowRgModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showAdPasteModal, setShowAdPasteModal] = useState(false);
  const [showRgHistory, setShowRgHistory] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [settingUpVariants, setSettingUpVariants] = useState(false);
  const [channelEditTarget, setChannelEditTarget] = useState<{
    product: ProductRow;
    anchorEl: HTMLElement;
  } | null>(null);
  // 조회조건 5개를 한 묶음으로 다룬다. [조회]가 한 번의 router.replace로 커밋해야
  // 개별 훅이 같은 틱에 서로의 갱신을 덮어쓰지 않는다(useUrlParams.set 주석 참고).
  // 파라미터 이름과 인코딩은 이전과 같아 기존 주소가 그대로 열린다.
  const queryParams = useUrlParams({
    preset: 'this_month', from: '', to: '', channelFilter: 'all', showHidden: '',
  });
  const rawPreset = queryParams.get('preset');
  const preset: Preset = isPreset(rawPreset) ? rawPreset : 'this_month';
  const customFrom = queryParams.get('from');
  const customTo = queryParams.get('to');
  const rawChannelFilter = queryParams.get('channelFilter');
  const channelFilter: ChannelFilter = isChannelFilterValue(rawChannelFilter) ? rawChannelFilter : 'all';
  const showHidden = queryParams.get('showHidden') === '1';

  // 적용된 조건(URL)과 입력 중인 조건(draft)을 나눈다 — ERP식으로 [조회]를 눌러야 반영된다.
  const applied: QueryDraft = useMemo(
    () => ({ preset, from: customFrom, to: customTo, channelFilter, showHidden }),
    [preset, customFrom, customTo, channelFilter, showHidden],
  );
  const [draft, setDraft] = useState<QueryDraft>(applied);
  // 뒤로가기·탭 복원처럼 URL이 바깥에서 바뀌면 입력값도 따라간다.
  useEffect(() => { setDraft(applied); }, [applied]);
  const patchDraft = useCallback(
    (patch: Partial<QueryDraft>) => setDraft((d) => ({ ...d, ...patch })),
    [],
  );
  const dirty =
    draft.preset !== applied.preset ||
    draft.from !== applied.from ||
    draft.to !== applied.to ||
    draft.channelFilter !== applied.channelFilter ||
    draft.showHidden !== applied.showHidden;
  const [summary, setSummary] = useState({ total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
  const [apiRevenue, setApiRevenue] = useState<ApiRevenue | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rgInventory, setRgInventory] = useState<Map<string, number | null>>(new Map());
  const [rgInventoryLoading, setRgInventoryLoading] = useState(false);
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

  /**
   * [조회] — 입력 중인 조건을 URL에 커밋한다. URL이 바뀌면 load·fetchApiRevenue가
   * 의존성으로 다시 돈다. 조건이 그대로면 URL이 안 바뀌어 아무 일도 안 일어나므로,
   * 그 경우에는 직접 다시 부른다 — 사용자에게 [조회]는 언제나 "다시 가져오기"다.
   */
  const runQuery = useCallback(() => {
    if (!dirty) {
      load();
      fetchApiRevenue();
      return;
    }
    queryParams.set({
      preset: draft.preset,
      from: draft.from,
      to: draft.to,
      channelFilter: draft.channelFilter,
      showHidden: draft.showHidden ? '1' : '',
    });
  }, [dirty, draft, queryParams, load, fetchApiRevenue]);

  /** [초기화] — 입력값만 기본값으로 되돌린다. 적용은 [조회]를 눌러야 한다. */
  const resetQuery = useCallback(() => {
    setDraft({ preset: 'this_month', from: '', to: '', channelFilter: 'all', showHidden: false });
  }, []);

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

  /**
   * 기간 광고비 합계와 평균 ROAS. summary는 서버가 매입·손익만 주므로 여기서 모은다.
   * 평균 ROAS는 상품별 ROAS의 산술평균이 아니라 (매출 합 / 광고비 합)이다 —
   * 광고비가 큰 상품이 평균을 끌어야 실제 집행 효율과 맞다.
   */
  const adTotals = useMemo(() => {
    const spend = products.reduce((sum, p) => sum + (p.ad_spend ?? 0), 0);
    const sales = products.reduce((sum, p) => sum + (p.total_sales_amount ?? 0), 0);
    return { spend, roas: spend > 0 ? (sales / spend) * 100 : 0 };
  }, [products]);

  // 채널·상품명·매출·손익·마진율·ROAS·재고·메뉴
  const COL_COUNT = 8;

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

  // 성공 시 true, 실패 시 false 반환 — 호출부(상세 패널)가 낙관적 업데이트를 롤백할 수 있게 한다.
  async function saveAdSpend(productId: string, adDate: string, value: string): Promise<boolean> {
    const num = parseFloat(value.replace(/,/g, ''));
    if (isNaN(num) || num < 0) return false;
    let json;
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/ad-spend`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_date: adDate, ad_spend: num }),
      });
      json = await res.json();
    } catch {
      toast.error('광고비 저장 실패');
      return false;
    }
    if (!json.success) {
      toast.error(json.error ?? '광고비 저장 실패');
      return false;
    }
    // 저장 후 해당 상품의 기간 광고비 합계를 재조회해 행 지표 갱신
    const range = getDateRange(preset, customFrom, customTo);
    if (!range) return true;
    const listRes = await fetch(
      `/api/cost-management/products/${productId}/ad-spend?from=${range.from}&to=${range.to}`,
    );
    const listJson = await listRes.json();
    if (!listJson.success) return true;
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
    return true;
  }

  return (
    <div style={{ background: E.ground, minHeight: '100%', paddingBottom: 4 }}>

      {/* ══ 조회조건 ══ */}
      <div style={queryPanelStyle}>
        <div style={qTitleStyle}>
          조회조건
          {dirty && (
            <span style={{ fontWeight: 500, letterSpacing: 0, color: E.accent }}>
              — 조건이 바뀌었습니다. [조회]를 눌러 적용하세요.
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
          {/* 조회기간 */}
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>조회기간</div>
            <div style={qValStyle}>
              <div style={segStyle}>
                {([
                  { id: 'all', label: '전체' },
                  { id: 'this_month', label: '이번 달' },
                  { id: 'last_month', label: '지난 달' },
                  { id: '3months', label: '3개월' },
                  { id: '6months', label: '6개월' },
                  { id: 'custom', label: '직접' },
                ] as { id: Preset; label: string }[]).map((opt, idx, arr) => (
                  <button
                    key={opt.id}
                    onClick={() => patchDraft({ preset: opt.id })}
                    style={{
                      ...segBtnStyle,
                      borderRight: idx === arr.length - 1 ? 'none' : `1px solid ${E.line}`,
                      background: draft.preset === opt.id ? E.accent : E.surface,
                      color: draft.preset === opt.id ? '#fff' : E.inkSub,
                      fontWeight: draft.preset === opt.id ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {draft.preset === 'custom' && (
                <>
                  <input
                    type="date"
                    value={draft.from}
                    onChange={(e) => patchDraft({ from: e.target.value })}
                    aria-label="조회 시작일"
                    style={{ ...inputStyle, fontFamily: E.mono, fontSize: 11.5 }}
                  />
                  <span style={{ color: E.inkMute }}>~</span>
                  <input
                    type="date"
                    value={draft.to}
                    onChange={(e) => patchDraft({ to: e.target.value })}
                    aria-label="조회 종료일"
                    style={{ ...inputStyle, fontFamily: E.mono, fontSize: 11.5 }}
                  />
                </>
              )}
            </div>
          </div>

          {/* 채널 */}
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>채널</div>
            <div style={qValStyle}>
              <div style={segStyle}>
                {([
                  { id: 'all', label: '전체' },
                  { id: 'rg', label: '로켓그로스' },
                  { id: 'wing', label: '윙판매' },
                  { id: 'naver', label: '네이버' },
                ] as { id: ChannelFilter; label: string }[]).map((opt, idx, arr) => {
                  const on = draft.channelFilter === opt.id;
                  const tone = opt.id === 'naver' ? E.naver : E.accent;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => patchDraft({ channelFilter: opt.id })}
                      style={{
                        ...segBtnStyle,
                        borderRight: idx === arr.length - 1 ? 'none' : `1px solid ${E.line}`,
                        background: on ? tone : E.surface,
                        color: on ? '#fff' : E.inkSub,
                        fontWeight: on ? 600 : 400,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 표시 */}
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>표시</div>
            <div style={qValStyle}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, color: E.inkSub, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.showHidden}
                  onChange={(e) => patchDraft({ showHidden: e.target.checked })}
                  style={{ accentColor: E.accent, width: 13, height: 13, margin: 0 }}
                />
                숨긴 상품 포함
                {hiddenCount > 0 && (
                  <span style={{ fontFamily: E.mono, color: E.inkMute }}>({hiddenCount})</span>
                )}
              </label>
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center' }}>
            <button
              onClick={runQuery}
              disabled={loading}
              style={{
                ...btnStyle,
                background: dirty ? E.accent : E.surface,
                borderColor: dirty ? E.accent : E.line,
                color: dirty ? '#fff' : E.ink,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              <Search size={12} /> {loading ? '조회 중…' : '조회'}
            </button>
            <button onClick={resetQuery} style={btnStyle}>
              <RotateCcw size={12} /> 초기화
            </button>
          </div>
        </div>
      </div>

      {/* ══ 지표: 실제 매출 ══ */}
      {(preset === 'all' || (preset === 'custom' && (!customFrom || !customTo))) ? (
        <div style={{
          background: E.warnSoft, border: `1px solid ${E.line}`, padding: '9px 12px',
          marginBottom: 10, fontSize: 12, color: E.warn,
        }}>
          {preset === 'all'
            ? '전체 기간에서는 API 매출 조회를 생략합니다. 특정 기간을 선택해 조회하세요.'
            : '시작일과 종료일을 모두 입력하면 실제 매출이 조회됩니다.'}
        </div>
      ) : apiLoading ? (
        <div style={{
          border: `1px solid ${E.line}`, background: E.surface, padding: '14px 12px',
          marginBottom: 10, fontSize: 12, color: E.inkSub, textAlign: 'center',
        }}>
          실제 매출 데이터를 불러오는 중…
        </div>
      ) : (
        <>
          {apiWarnings.length > 0 && (
            <div style={{
              background: E.warnSoft, border: `1px solid ${E.line}`, padding: '8px 12px',
              marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <AlertCircle size={13} color={E.warn} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: E.warn }}>일부 채널 조회 실패</span>
                {apiWarnings.map((w, i) => (
                  <p key={i} style={{ fontSize: 11, color: E.warn, margin: '2px 0 0' }}>{w}</p>
                ))}
              </div>
            </div>
          )}
          {apiRevenue && (
            <div style={{ border: `1px solid ${E.line}`, marginBottom: 10, background: E.surface }}>
              <div style={bandStyle}>
                실제 매출 · 플랫폼 확정{' '}
                <span style={{ fontWeight: 400, color: E.inkMute }}>쿠팡 + 네이버 + 로켓그로스 API 집계</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <Kpi
                  label="총 매출"
                  value={fmtRevenue(apiRevenue.totalRevenue)}
                  unit="원"
                  delta={changePct(apiRevenue.totalRevenue, apiRevenue.prevTotalRevenue)}
                />
                <Kpi
                  label="주문 건수"
                  value={fmt(apiRevenue.totalOrders)}
                  unit="건"
                  delta={changePct(apiRevenue.totalOrders, apiRevenue.prevTotalOrders)}
                />
                <Kpi label="쿠팡" value={fmtRevenue(apiRevenue.coupangRevenue)} sub={`${apiRevenue.coupangOrders}건`} tone={E.accent} />
                <Kpi label="네이버" value={fmtRevenue(apiRevenue.naverRevenue)} sub={`${apiRevenue.naverOrders}건`} tone={E.naver} />
                <Kpi label="로켓그로스" value={fmtRevenue(apiRevenue.rgRevenue)} sub={`${apiRevenue.rgOrders}건`} tone={E.info} last />
              </div>
              <div style={{
                padding: '4px 12px', background: E.chrome2, borderTop: `1px solid ${E.lineSoft}`,
                fontSize: 10.5, color: E.inkMute,
              }}>
                {apiRevenue.cancelCount > 0 && `취소·반품 ${apiRevenue.cancelCount}건 제외됨 · `}
                실제 매출은 플랫폼 API 실시간 집계, 관리 손익은 입력한 원가·판매 기반 계산이라 값이 다를 수 있습니다.
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ 지표: 관리 손익 ══ */}
      <div style={{ border: `1px solid ${E.line}`, marginBottom: 10, background: E.surface }}>
        <div style={bandStyle}>
          관리 손익 · 내 입력 기반 <span style={{ fontWeight: 400, color: E.inkMute }}>입고·판매 수동 관리</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1.4fr' }}>
          <Kpi label="관리 상품" value={fmt(products.length)} unit="개" />
          <Kpi label="기간 총 매입비" value={fmt(summary.total_purchase_amount)} tone={E.loss} sub="입고 단가 × 수량 합계" />
          <Kpi
            label="기간 실현손익"
            value={`${summary.total_realized_profit >= 0 ? '+' : '−'}${fmt(Math.abs(summary.total_realized_profit))}`}
            tone={summary.total_realized_profit >= 0 ? E.profit : E.loss}
            sub={apiRevenue && apiRevenue.totalRevenue > 0
              ? `마진율 ${((summary.total_realized_profit / apiRevenue.totalRevenue) * 100).toFixed(1)}%`
              : undefined}
          />
          <Kpi
            label="기간 광고비 / 평균 ROAS"
            value={fmt(adTotals.spend)}
            sub={adTotals.spend > 0 ? `평균 ROAS ${Math.round(adTotals.roas)}%` : '광고비 입력 없음'}
            last
          />
        </div>
      </div>

      {/* ══ 툴바 ══ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexWrap: 'wrap',
        background: E.chrome2, border: `1px solid ${E.line}`, borderBottom: 'none',
      }}>
        <button
          onClick={() => setShowBulkAddModal(true)}
          title="쿠팡에 등록됐지만 원가관리에 없는 상품을 여러 건 한 번에 추가합니다"
          style={{ ...btnStyle, background: E.accent, borderColor: E.accent, color: '#fff', fontWeight: 600 }}
        >
          <ListPlus size={12} /> 쿠팡 상품 불러오기
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          title="쿠팡에 없는 상품을 가상 ID로 등록합니다 (네이버 전용 상품, 소분 원재료 등)"
          style={btnStyle}
        >
          <Plus size={12} /> 직접 추가
          {hasDraft(ADD_PRODUCT_DRAFT_KEY) && <span title="작성 중인 입력이 있어요">✎</span>}
        </button>

        <span style={dividerStyle} />

        <button onClick={() => setShowReceiptModal(true)} title="폰으로 찍은 코스트코 영수증을 입고로 확정합니다" style={btnStyle}>
          <Receipt size={12} /> 영수증 입고
        </button>
        <div style={{ position: 'relative', display: 'flex' }}>
          <button onClick={() => setShowRgModal(true)} style={{ ...btnStyle, color: E.info, borderRight: 'none' }}>
            <Package size={12} /> 로켓그로스 입고
            {hasDraft(RG_SHIPMENT_DRAFT_KEY) && <span title="작성 중인 입력이 있어요">✎</span>}
          </button>
          <button
            onClick={() => setShowRgHistory((prev) => !prev)}
            title="입고 이력 보기"
            style={{ ...btnStyle, padding: '0 8px', color: E.info, background: showRgHistory ? E.infoSoft : E.surface }}
          >
            이력
          </button>
          {showRgHistory && <RgShipmentHistoryPopover onClose={handleCloseRgHistory} />}
        </div>
        <button onClick={() => setShowShippingModal(true)} style={btnStyle}>
          <Truck size={12} /> 배송비 그룹
          {hasDraft(SHIPPING_GROUP_DRAFT_KEY) && <span title="작성 중인 입력이 있어요">✎</span>}
        </button>

        <span style={dividerStyle} />

        <button onClick={() => setShowAdPasteModal(true)} title="쿠팡 광고관리 표를 붙여넣어 상품별 광고비를 하루치로 입력합니다" style={btnStyle}>
          <ClipboardPaste size={12} /> 광고비 붙여넣기
        </button>
        <button
          onClick={runAllBulkImport}
          disabled={importingAll}
          style={{ ...btnStyle, opacity: importingAll ? 0.6 : 1, cursor: importingAll ? 'not-allowed' : 'pointer' }}
        >
          <CloudDownload size={12} /> {importingAll ? '가져오는 중…' : '판매 가져오기'}
        </button>
        <button
          onClick={runBulkSetupVariants}
          disabled={settingUpVariants}
          title="쿠팡·네이버 옵션 정보를 조회해 상품별 variants를 채웁니다"
          style={{ ...btnStyle, opacity: settingUpVariants ? 0.6 : 1, cursor: settingUpVariants ? 'not-allowed' : 'pointer' }}
        >
          {settingUpVariants ? '설정 중…' : 'variants 일괄 설정'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastSyncedAt && (
            <span style={{ fontSize: 10.5, color: E.inkMute, fontFamily: E.mono }}>
              마지막 동기화 {lastSyncedAt}
            </span>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, height: E.ctrlH, padding: '0 8px',
            border: `1px solid ${E.line}`, background: E.surface,
          }}>
            <Search size={11} color={E.inkMute} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명 검색"
              style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 11.5, width: 150, color: E.ink, outline: 'none' }}
            />
          </div>
        </div>
      </div>

      {/* ══ 그리드 ══ */}
      {loadError && (
        <div style={{
          background: E.accentSoft, border: `1px solid ${E.accentLine}`, borderBottom: 'none',
          padding: '8px 12px', fontSize: 12, color: E.accent, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={13} /> 상품 목록 오류: {loadError}
        </div>
      )}
      <div style={{ border: `1px solid ${E.line}`, background: E.surface, overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: E.inkSub, fontSize: 12 }}>불러오는 중…</div>
        ) : tableItems.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: E.inkSub, fontSize: 12 }}>
            {search
              ? '검색 결과가 없습니다.'
              : hiddenCount > 0 && !showHidden
                ? '모든 상품을 숨겼습니다. 조회조건의 [숨긴 상품 포함]을 켜고 조회하면 복원할 수 있고, 데이터는 삭제되지 않았습니다.'
                : '상품을 추가하세요. [쿠팡 상품 불러오기]로 여러 건을 한 번에 넣을 수 있습니다.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 880 }}>
            <thead>
              <tr>
                {/* 상품명만 폭을 비워 남는 공간을 먹되, 셀 안에서 말줄임된다.
                    나머지는 % 폭이라 모니터가 넓어져도 숫자가 오른쪽 끝으로 달아나지 않는다. */}
                <th style={{ ...thStyle, width: '12%', minWidth: 120 }}>채널</th>
                <th style={{ ...thStyle, textAlign: 'left', maxWidth: 0 }}>상품명</th>
                <th style={{ ...thStyle, width: '12%', minWidth: 128 }}>매출 (수량)</th>
                <th style={{ ...thStyle, width: '12%', minWidth: 124 }}>실현손익</th>
                <th style={{ ...thStyle, width: '11%', minWidth: 112 }}>마진율</th>
                <th style={{ ...thStyle, width: '9%', minWidth: 88 }}>ROAS</th>
                <th style={{ ...thStyle, width: '9%', minWidth: 88 }}>재고</th>
                <th style={{ ...thStyle, width: 44, borderRight: 'none' }} />
              </tr>
            </thead>
            <tbody>
              {tableItems.map((item, rowIndex) => {
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
                      {isGroupExpanded && item.children.map((child, childIndex) => (
                        <React.Fragment key={child.id}>
                          <ProductRowComponent
                            product={child}
                            isChild
                            expanded={expandedDetailIds.has(child.id)}
                            colCount={COL_COUNT}
                            striped={childIndex % 2 === 1}
                            onToggleDetail={toggleDetail}
                            onOpenDrawer={setDrawerProductId}
                            onHide={() => toggleHide(child)}
                            onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
                            onEditChannel={(_prod, anchorEl) => setChannelEditTarget({ product: child, anchorEl })}
                            onProductUpdate={handleProductUpdate}
                            isEditablePeriod={isEditablePeriod}
                            channelFilter={channelFilter}
                            rgInventory={rgInventory}
                            rgInventoryLoading={rgInventoryLoading}
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
                      striped={rowIndex % 2 === 1}
                      onToggleDetail={toggleDetail}
                      onOpenDrawer={setDrawerProductId}
                      onHide={() => toggleHide(p)}
                      onDelete={(prod) => deleteProduct(prod.id, prod.product_name)}
                      onEditChannel={(_prod, anchorEl) => setChannelEditTarget({ product: p, anchorEl })}
                      onProductUpdate={handleProductUpdate}
                      isEditablePeriod={isEditablePeriod}
                      channelFilter={channelFilter}
                      rgInventory={rgInventory}
                      rgInventoryLoading={rgInventoryLoading}
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

      {/* ══ 상태바 ══ */}
      <div style={statusBarStyle}>
        <span>총 <b style={statNumStyle}>{fmt(products.length)}</b>건</span>
        {hiddenCount > 0 && <span>숨김 <b style={statNumStyle}>{fmt(hiddenCount)}</b>건</span>}
        <span>합계 매출 <b style={statNumStyle}>{fmt(summary.total_sales_amount)}</b>원</span>
        <span>
          합계 손익{' '}
          <b style={{ ...statNumStyle, color: summary.total_realized_profit >= 0 ? E.profit : E.loss }}>
            {summary.total_realized_profit >= 0 ? '+' : '−'}{fmt(Math.abs(summary.total_realized_profit))}
          </b>원
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: E.inkMute }}>
          실현손익 = FIFO 원가 기준 ((판매가−쿠폰할인) − 입고원가 − 배송비 − RG배송비 − 수수료)
        </span>
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
      {showBulkAddModal && (
        <BulkAddProductModal
          onClose={() => setShowBulkAddModal(false)}
          onAdded={load}
        />
      )}
      {showReceiptModal && (
        <ReceiptIngestModal
          onClose={() => setShowReceiptModal(false)}
          onConfirmed={load}
        />
      )}
      {showAdPasteModal && (
        <AdSpendPasteModal
          onClose={() => setShowAdPasteModal(false)}
          onSaved={() => { setShowAdPasteModal(false); load(); }}
        />
      )}
      {showRgModal && (
        <RocketGrowthShipmentModal
          products={products.filter((p) => p.total_entry_stock > 0).map((p) => ({
            id: p.id,
            product_name: p.product_name,
            current_stock: p.total_entry_stock,
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
