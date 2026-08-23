'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { PLATFORM_INFO } from '@/types/orders';
import { useUrlParam } from '@/hooks/useUrlParams';
import { E } from '@/lib/design-tokens';
import {
  qFieldStyle, qLabelStyle, qValStyle, qTitleStyle, queryPanelStyle,
  inputStyle, btnStyle, thStyle, statNumStyle, statusBarStyle,
} from './erp-ui';

// ─── 쿠팡 주문 상태 → 내부 레이블 매핑 ────────────────────────

const COUPANG_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  ACCEPT:           { label: '신규',     color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  INSTRUCT:         { label: '발주확인', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  DEPARTURE:        { label: '출고완료', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  DELIVERING:       { label: '배송중',   color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  FINAL_DELIVERY:   { label: '배송완료', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  CANCEL_REQUEST:   { label: '취소요청', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  CANCEL_DONE:      { label: '취소완료', color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  RETURN_REQUEST:   { label: '반품요청', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  RETURN_DONE:      { label: '반품완료', color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  ROCKET_GROWTH:    { label: '정산완료', color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
};

// ─── 네이버 주문 상태 → 내부 레이블 매핑 ────────────────────────

const NAVER_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  PAYED:            { label: '결제완료',   color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  DELIVERING:       { label: '배송중',     color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  DELIVERED:        { label: '배송완료',   color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  PURCHASE_DECIDED: { label: '구매확정',   color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  CANCELED:         { label: '취소완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  RETURNED:         { label: '반품완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
};

// ─── 토스쇼핑 주문 상태 → 내부 레이블 매핑 ─────────────────────────

const TOSS_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  BEFORE_PAYMENT:          { label: '결제대기',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  PAID:                    { label: '결제완료',   color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  PREPARING_PRODUCT:       { label: '상품준비중', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  DELIVERING:              { label: '배송중',     color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  DELIVERED:               { label: '배송완료',   color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  CONFIRMED_ORDER:         { label: '구매확정',   color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  CLAIM_REQUESTED_CANCEL:  { label: '취소요청',   color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  CANCELED_PAYMENT:        { label: '결제취소',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_REJECTED_CANCEL:   { label: '취소거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  REQUESTED_EXCHANGE:      { label: '교환요청',   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  ONGOING_EXCHANGE:        { label: '교환중',     color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  COMPLETED_EXCHANGE:      { label: '교환완료',   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  CLAIM_REJECTED_EXCHANGE: { label: '교환거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  REQUESTED_RETURN:        { label: '반품요청',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  ONGOING_RETURN:          { label: '반품중',     color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  COMPLETED_RETURN:        { label: '반품완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_REJECTED_RETURN:   { label: '반품거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  CLAIM_COLLECTING:        { label: '회수중',     color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_COLLECTED:         { label: '회수완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_DELIVERING:        { label: '재배송중',   color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '전체 상태' },
  { value: 'ACCEPT', label: '신규' },
  { value: 'INSTRUCT', label: '발주확인' },
  { value: 'DEPARTURE', label: '출고완료' },
  { value: 'DELIVERING', label: '배송중' },
  { value: 'FINAL_DELIVERY', label: '배송완료' },
  { value: 'CANCEL_DONE', label: '취소완료' },
];

// ─── 공통 주문 아이템 타입 ──────────────────────────────────────

interface UnifiedOrderItem {
  sellerProductName: string;
  sellerProductItemName: string;
  shippingCount: number;
  salesPrice: number;
  orderPrice: number;
  // 쿠팡 전용 필드 (네이버는 undefined)
  estimatedShippingDate?: string;
  canceled?: boolean;
}

// ─── 쿠팡 원본 타입 (API 응답 그대로) ─────────────────────────

interface CoupangOrderItem {
  vendorItemPackageName: string;
  sellerProductName: string;
  sellerProductItemName: string;
  shippingCount: number;
  salesPrice: number;
  orderPrice: number;
  estimatedShippingDate: string;
  canceled: boolean;
}

interface CoupangOrder {
  shipmentBoxId: number;
  orderId: number;
  status: string;
  orderedAt: string;
  paidAt: string | null;
  shippingPrice: number;
  remoteArea: boolean;
  parcelPrintMessage: string;
  orderer: { name: string; safeNumber: string; email: string } | null;
  receiver: { name: string; safeNumber: string; addr1: string; addr2: string; postCode: string } | null;
  orderItems: CoupangOrderItem[];
  deliveryCompanyName: string;
  invoiceNumber: string;
  inTrasitDateTime: string;
  deliveredDate: string;
}

// ─── 통합 주문 타입 ────────────────────────────────────────────

interface UnifiedOrder {
  /** 화면 표시용 고유 키 (platform + orderId 조합) */
  key: string;
  platform: 'coupang' | 'naver' | 'rocket_growth' | 'toss';
  orderId: string;
  status: string;
  orderedAt: string;
  receiverName: string | null;
  receiverAddr: string | null;
  receiverTel: string | null;
  invoiceInfo: string | null;
  parcelMessage: string | null;
  orderItems: UnifiedOrderItem[];
}

// ─── 유틸 ─────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── 상태 뱃지 ────────────────────────────────────────────────

function StatusBadge({ status, platform }: { status: string; platform: 'coupang' | 'naver' | 'rocket_growth' | 'toss' }) {
  const map = platform === 'naver' ? NAVER_STATUS_MAP
    : platform === 'toss' ? TOSS_STATUS_MAP
    : COUPANG_STATUS_MAP;
  const info = map[status] ?? { label: status, color: '#71717a', bg: 'rgba(113,113,122,0.08)' };
  // 27px 행에 들어가도록 라운드를 없애고 높이를 줄인다. 색은 상태별 의미를 그대로 쓴다.
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, padding: '1px 5px',
      border: `1px solid ${info.color}`, color: info.color, background: info.bg,
      whiteSpace: 'nowrap', lineHeight: 1.5,
    }}>
      {info.label}
    </span>
  );
}

// 쿠팡 상태 요약 카드에 사용하는 키
const STATUS_SUMMARY_KEYS = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'CANCEL_DONE'];

// ─── 쿠팡 응답 → UnifiedOrder 변환 ───────────────────────────

function toCoupangUnified(order: CoupangOrder): UnifiedOrder {
  return {
    key: `coupang-${order.orderId}`,
    platform: 'coupang',
    orderId: String(order.orderId),
    status: order.status,
    orderedAt: order.orderedAt,
    receiverName: order.receiver?.name ?? null,
    receiverAddr: order.receiver ? `${order.receiver.addr1} ${order.receiver.addr2}`.trim() : null,
    receiverTel: order.receiver?.safeNumber ?? null,
    invoiceInfo: order.invoiceNumber ? `${order.deliveryCompanyName} ${order.invoiceNumber}` : null,
    parcelMessage: order.parcelPrintMessage || null,
    orderItems: order.orderItems.map((i) => ({
      sellerProductName: i.sellerProductName,
      sellerProductItemName: i.sellerProductItemName,
      shippingCount: i.shippingCount,
      salesPrice: i.salesPrice,
      orderPrice: i.orderPrice,
      estimatedShippingDate: i.estimatedShippingDate,
      canceled: i.canceled,
    })),
  };
}

// ─── 네이버 API 응답 아이템 타입 ──────────────────────────────

interface NaverOrderApiItem {
  orderId: string;
  productOrderId: string;
  status: string;
  claimStatus: string | null;
  orderedAt: string;
  receiverName: string | null;
  orderItems: {
    sellerProductName: string;
    sellerProductItemName: string;
    shippingCount: number;
    orderPrice: number;
    salesPrice: number;
    canceled: boolean;
  }[];
}

function toNaverUnified(item: NaverOrderApiItem): UnifiedOrder {
  return {
    key: `naver-${item.productOrderId}`,
    platform: 'naver',
    orderId: item.productOrderId,
    status: item.status,
    orderedAt: item.orderedAt,
    receiverName: item.receiverName,
    receiverAddr: null,
    receiverTel: null,
    invoiceInfo: null,
    parcelMessage: null,
    orderItems: item.orderItems.map((i) => ({
      sellerProductName: i.sellerProductName,
      sellerProductItemName: i.sellerProductItemName,
      shippingCount: i.shippingCount,
      salesPrice: i.salesPrice,
      orderPrice: i.orderPrice,
      canceled: i.canceled,
    })),
  };
}

// ─── 로켓그로스 API 응답 타입 ──────────────────────────────────

interface RgOrderApiItem {
  orderId: string;
  saleDate: string;
  recognitionDate: string;
  items: Array<{
    sellerProductId: number;
    vendorItemId: number;
    vendorItemName: string;
    quantity: number;
    salePrice: number;
    saleAmount: number;
  }>;
}

function toRgUnified(item: RgOrderApiItem): UnifiedOrder {
  return {
    key: `rg-${item.orderId}`,
    platform: 'rocket_growth',
    orderId: item.orderId,
    status: 'ROCKET_GROWTH',
    orderedAt: item.saleDate || item.recognitionDate,
    receiverName: null,
    receiverAddr: null,
    receiverTel: null,
    invoiceInfo: null,
    parcelMessage: null,
    orderItems: item.items.map((i) => ({
      sellerProductName: i.vendorItemName || `상품 #${i.sellerProductId}`,
      sellerProductItemName: '',
      shippingCount: i.quantity,
      salesPrice: i.salePrice,
      orderPrice: i.saleAmount,
    })),
  };
}

// ─── 토스쇼핑 API 응답 아이템 타입 ────────────────────────────────

interface TossOrderApiItem {
  orderId: number;
  orderProductId: number;
  orderedAt: string;
  ordererName: string;
  productName: string;
  optionName: string;
  quantity: number;
  price: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  detailAddress: string;
  shippingTrackingNumber: string;
  deliveryCompanyCode: string;
  orderProductStatus: string;
}

function toTossUnified(item: TossOrderApiItem): UnifiedOrder {
  return {
    key: `toss-${item.orderProductId}`,
    platform: 'toss',
    orderId: String(item.orderProductId),
    status: item.orderProductStatus,
    orderedAt: item.orderedAt,
    receiverName: item.receiverName,
    receiverAddr: item.address ? `${item.address} ${item.detailAddress ?? ''}`.trim() : null,
    receiverTel: item.receiverPhone ?? null,
    invoiceInfo: item.shippingTrackingNumber
      ? `${item.deliveryCompanyCode} ${item.shippingTrackingNumber}`
      : null,
    parcelMessage: null,
    orderItems: [
      {
        sellerProductName: item.productName + (item.optionName ? ` (${item.optionName})` : ''),
        sellerProductItemName: item.optionName ?? '',
        shippingCount: item.quantity,
        salesPrice: item.quantity > 0 ? Math.round(item.price / item.quantity) : item.price,
        orderPrice: item.price,
        canceled: ['CANCELED_PAYMENT', 'COMPLETED_RETURN'].includes(item.orderProductStatus),
      },
    ],
  };
}

// ─── 컴포넌트 ─────────────────────────────────────────────────

export default function OrdersTab() {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);
  const defaultFromStr = toDateStr(defaultFrom);
  const defaultToStr = toDateStr(today);

  // 기간·상태·펼침 행은 모두 스칼라(문자열)라 URL 쿼리에 둔다 — 탭 리마운트에도 복원된다.
  const [from, setFrom] = useUrlParam('from', defaultFromStr);
  const [to, setTo] = useUrlParam('to', defaultToStr);
  const [statusFilter, setStatusFilter] = useUrlParam('status', '');
  const [rawExpandedKey, setRawExpandedKey] = useUrlParam('expanded', '');
  const expandedKey = rawExpandedKey === '' ? null : rawExpandedKey;
  const setExpandedKey = useCallback(
    (key: string | null) => setRawExpandedKey(key ?? ''),
    [setRawExpandedKey],
  );
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  const [naverError, setNaverError] = useState<string | null>(null);
  const [rgError, setRgError] = useState<string | null>(null);
  const [tossError, setTossError] = useState<string | null>(null);
  // 페이지 번호는 URL에 넣지 않는다 — 데이터가 바뀌면 옛 페이지가 빈 화면을 가리킬 수 있고,
  // 실제로 조회를 새로 트리거하는 값도 아니라(from/to/status만 재조회 대상) 페이지네이션
  // 위치까지 영구 기억할 필요는 적다고 판단했다. 탭 복귀 시 1페이지부터 다시 보는 편이 안전하다.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const fetchOrders = useCallback(async (reset = true) => {
    setLoading(true);
    setCoupangError(null);
    setNaverError(null);
    setRgError(null);
    setTossError(null);

    const params = new URLSearchParams({ from, to });
    if (statusFilter) params.set('status', statusFilter);
    const rgParams = new URLSearchParams({ from, to });

    // 쿠팡 + 네이버 + 로켓그로스 + 토스쇼핑 병렬 조회 — 한 쪽 실패해도 나머지 표시
    const [coupangResult, naverResult, rgResult, tossResult] = await Promise.allSettled([
      fetch(`/api/orders/coupang?${params.toString()}`).then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? '쿠팡 주문 조회 실패');
        return json;
      }),
      fetch(`/api/orders/naver?${params.toString()}`).then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? '네이버 주문 조회 실패');
        return json;
      }),
      // 로켓그로스는 상태 필터 미적용 (revenue-history 기반, 항상 정산완료)
      fetch(`/api/orders/coupang-rg?${rgParams.toString()}`).then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? '로켓그로스 조회 실패');
        return json;
      }),
      fetch(`/api/orders/toss?${params.toString()}`).then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? '토스쇼핑 주문 조회 실패');
        return json;
      }),
    ]);

    const unified: UnifiedOrder[] = [];
    let coupangNextToken: string | null = null;

    if (coupangResult.status === 'fulfilled') {
      const coupangItems: CoupangOrder[] = coupangResult.value.data?.items ?? [];
      unified.push(...coupangItems.map(toCoupangUnified));
      coupangNextToken = coupangResult.value.data?.nextToken ?? null;
    } else {
      setCoupangError(coupangResult.reason instanceof Error ? coupangResult.reason.message : '쿠팡 오류');
    }

    if (naverResult.status === 'fulfilled') {
      const naverItems: NaverOrderApiItem[] = naverResult.value.data?.items ?? [];
      unified.push(...naverItems.map(toNaverUnified));
    } else {
      setNaverError(naverResult.reason instanceof Error ? naverResult.reason.message : '네이버 오류');
    }

    if (rgResult.status === 'fulfilled') {
      const rgItems: RgOrderApiItem[] = rgResult.value.data?.items ?? [];
      unified.push(...rgItems.map(toRgUnified));
    } else {
      setRgError(rgResult.reason instanceof Error ? rgResult.reason.message : '로켓그로스 오류');
    }

    if (tossResult.status === 'fulfilled') {
      const tossItems: TossOrderApiItem[] = tossResult.value.data?.items ?? [];
      unified.push(...tossItems.map(toTossUnified));
    } else {
      setTossError(tossResult.reason instanceof Error ? tossResult.reason.message : '토스쇼핑 오류');
    }

    // 주문일시 내림차순 정렬
    unified.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    setOrders(reset ? unified : (prev) => [...prev, ...unified]);
    setNextToken(coupangNextToken);
    if (reset) setPage(1);
    setLoading(false);
  }, [from, to, statusFilter]);

  useEffect(() => {
    fetchOrders(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 쿠팡 상태별 카운트 (상태 요약 카드)
  const statusCounts = STATUS_SUMMARY_KEYS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = orders.filter((o) => o.platform === 'coupang' && o.status === s).length;
    return acc;
  }, {});

  // 채널별 건수
  const coupangCount = orders.filter((o) => o.platform === 'coupang').length;
  const naverCount = orders.filter((o) => o.platform === 'naver').length;
  const rgCount = orders.filter((o) => o.platform === 'rocket_growth').length;
  const tossCount = orders.filter((o) => o.platform === 'toss').length;

  // 현재 페이지 슬라이싱
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pagedOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 총 매출
  const totalRevenue = orders.reduce((sum, o) => {
    return sum + o.orderItems.reduce((s, i) => s + i.orderPrice, 0);
  }, 0);

  // 채널별 오류를 한 줄씩 모은다 — 네 개 박스가 세로로 쌓이면 표가 화면 밖으로 밀린다.
  const channelErrors = [
    ['쿠팡', coupangError],
    ['로켓그로스', rgError],
    ['네이버', naverError],
    ['토스쇼핑', tossError],
  ].filter((e): e is [string, string] => Boolean(e[1]));

  return (
    <div style={{ background: E.ground, minHeight: '100%', paddingBottom: 4 }}>

      {/* ══ 조회조건 ══ */}
      <div style={queryPanelStyle}>
        <div style={qTitleStyle}>조회조건</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>주문일</div>
            <div style={qValStyle}>
              <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                aria-label="조회 시작일"
                style={{ ...inputStyle, fontFamily: E.mono, fontSize: 11.5 }}
              />
              <span style={{ color: E.inkMute }}>~</span>
              <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                aria-label="조회 종료일"
                style={{ ...inputStyle, fontFamily: E.mono, fontSize: 11.5 }}
              />
            </div>
          </div>

          <div style={qFieldStyle}>
            <div style={qLabelStyle}>주문상태</div>
            <div style={qValStyle}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="주문 상태"
                style={{ ...inputStyle, minWidth: 110 }}
              >
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center' }}>
            <button
              onClick={() => fetchOrders(true)}
              disabled={loading}
              style={{ ...btnStyle, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}
            >
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? '조회 중…' : '조회'}
            </button>
          </div>
        </div>
      </div>

      {/* ══ 채널 오류 ══ */}
      {channelErrors.length > 0 && (
        <div style={{
          border: `1px solid ${E.line}`, background: E.warnSoft, marginBottom: 10,
          padding: '7px 12px', display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertCircle size={13} color={E.warn} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: E.warn }}>
              일부 채널 조회 실패 ({channelErrors.length}건)
            </span>
            {channelErrors.map(([name, msg]) => (
              <p key={name} style={{ fontSize: 11, color: E.warn, margin: '2px 0 0' }}>{name}: {msg}</p>
            ))}
          </div>
        </div>
      )}

      {/* ══ 상태 요약 — 누르면 필터가 걸린다 ══ */}
      <div style={{ border: `1px solid ${E.line}`, background: E.surface, marginBottom: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px',
          background: E.chrome, borderBottom: `1px solid ${E.line}`,
          fontSize: 11, fontWeight: 600, color: E.inkSub,
        }}>
          쿠팡 주문 상태 <span style={{ fontWeight: 400, color: E.inkMute }}>누르면 그 상태만 조회합니다</span>
          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              style={{ ...btnStyle, height: 20, marginLeft: 'auto', fontSize: 11 }}
            >
              필터 해제
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STATUS_SUMMARY_KEYS.length}, 1fr)` }}>
          {STATUS_SUMMARY_KEYS.map((st, i) => {
            const info = COUPANG_STATUS_MAP[st];
            const on = statusFilter === st;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(on ? '' : st)}
                style={{
                  font: 'inherit', textAlign: 'left', cursor: 'pointer',
                  padding: '9px 12px', border: 'none',
                  borderRight: i === STATUS_SUMMARY_KEYS.length - 1 ? 'none' : `1px solid ${E.lineSoft}`,
                  background: on ? info.bg : E.surface,
                  boxShadow: on ? `inset 0 -2px 0 ${info.color}` : 'none',
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', color: E.inkMute }}>
                  {info.label}
                </div>
                <div style={{
                  fontFamily: E.mono, fontVariantNumeric: 'tabular-nums',
                  fontSize: 19, fontWeight: 600, letterSpacing: '-.02em', marginTop: 1,
                  color: (statusCounts[st] ?? 0) > 0 ? info.color : E.inkMute,
                }}>
                  {statusCounts[st] ?? 0}<span style={{ fontSize: 12, color: E.inkMute }}>건</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══ 주문 그리드 ══ */}
      <div style={{ border: `1px solid ${E.line}`, background: E.surface, overflowX: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 36, color: E.inkSub, fontSize: 12 }}>
            주문 데이터를 불러오는 중…
          </div>
        ) : pagedOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 36, color: E.inkSub, fontSize: 12 }}>
            <Package size={26} style={{ marginBottom: 6, opacity: 0.3 }} />
            <p style={{ margin: 0 }}>해당 기간에 주문이 없습니다.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 940 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', width: '13%', minWidth: 110 }}>주문번호</th>
                <th style={{ ...thStyle, width: 78 }}>채널</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>상품명</th>
                <th style={{ ...thStyle, textAlign: 'right', width: 56 }}>수량</th>
                <th style={{ ...thStyle, textAlign: 'right', width: '11%', minWidth: 92 }}>결제금액</th>
                <th style={{ ...thStyle, width: 84 }}>상태</th>
                <th style={{ ...thStyle, textAlign: 'left', width: 92 }}>주문일시</th>
                <th style={{ ...thStyle, textAlign: 'left', width: 88, borderRight: 'none' }}>수령인</th>
              </tr>
            </thead>
            <tbody>
              {pagedOrders.map((order, rowIndex) => {
                const totalQty = order.orderItems.reduce((s, i) => s + i.shippingCount, 0);
                const totalAmt = order.orderItems.reduce((s, i) => s + i.orderPrice, 0);
                const firstName = order.orderItems[0];
                const extraCount = order.orderItems.length - 1;
                const isExpanded = expandedKey === order.key;
                const platformInfo = PLATFORM_INFO[order.platform] ?? { label: order.platform, color: E.inkSub };

                return (
                  <React.Fragment key={order.key}>
                    <tr
                      onClick={() => setExpandedKey(isExpanded ? null : order.key)}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? E.infoSoft : rowIndex % 2 === 1 ? E.chrome2 : E.surface,
                      }}
                    >
                      <td style={{ ...cellStyle, fontFamily: E.mono, fontSize: 11, color: E.info }}>
                        {order.orderId}
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <span style={{
                          fontSize: 9.5, fontWeight: 700, padding: '1px 5px',
                          border: `1px solid ${platformInfo.color}`, color: platformInfo.color,
                          whiteSpace: 'nowrap', lineHeight: 1.5,
                        }}>
                          {platformInfo.label}
                        </span>
                      </td>
                      <td style={{ ...cellStyle, maxWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          <span
                            title={firstName?.sellerProductName ?? undefined}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                          >
                            {firstName?.sellerProductName ?? '-'}
                          </span>
                          {extraCount > 0 && (
                            <span style={{ fontSize: 10, color: E.inkMute, flexShrink: 0 }}>외 {extraCount}건</span>
                          )}
                        </div>
                      </td>
                      <td style={numCellStyle}>{totalQty}</td>
                      <td style={{ ...numCellStyle, fontWeight: 600 }}>{totalAmt.toLocaleString()}</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <StatusBadge status={order.status} platform={order.platform} />
                      </td>
                      <td style={{ ...cellStyle, fontFamily: E.mono, fontSize: 11, color: E.inkSub }}>
                        {formatDate(order.orderedAt)}
                      </td>
                      <td style={{ ...cellStyle, borderRight: 'none', color: E.inkSub }}>
                        {order.receiverName ?? '-'}
                      </td>
                    </tr>

                    {/* 펼침: 주문 상세 */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0 10px 10px', background: E.infoSoft, borderBottom: `1px solid ${E.line}` }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, background: E.surface, border: `1px solid ${E.line}` }}>
                            <thead>
                              <tr>
                                <th style={{ ...thStyle, textAlign: 'left', padding: '4px 8px' }}>상품명</th>
                                <th style={{ ...thStyle, textAlign: 'left', padding: '4px 8px' }}>옵션</th>
                                <th style={{ ...thStyle, textAlign: 'right', padding: '4px 8px', width: 56 }}>수량</th>
                                <th style={{
                                  ...thStyle, textAlign: 'right', padding: '4px 8px', width: 96,
                                  borderRight: order.platform === 'coupang' ? `1px solid ${E.lineSoft}` : 'none',
                                }}>
                                  결제금액
                                </th>
                                {order.platform === 'coupang' && (
                                  <th style={{ ...thStyle, textAlign: 'left', padding: '4px 8px', width: 96, borderRight: 'none' }}>
                                    예상출고일
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {order.orderItems.map((item, idx) => (
                                <tr key={idx} style={{ background: idx % 2 === 1 ? E.chrome2 : E.surface }}>
                                  <td style={cellStyle}>{item.sellerProductName}</td>
                                  <td style={{ ...cellStyle, color: E.inkSub }}>{item.sellerProductItemName || '-'}</td>
                                  <td style={numCellStyle}>{item.shippingCount}</td>
                                  <td style={{
                                    ...numCellStyle, fontWeight: 500,
                                    borderRight: order.platform === 'coupang' ? `1px solid ${E.lineSoft}` : 'none',
                                  }}>
                                    {item.orderPrice.toLocaleString()}
                                  </td>
                                  {order.platform === 'coupang' && (
                                    <td style={{ ...cellStyle, borderRight: 'none', fontFamily: E.mono, fontSize: 11, color: E.inkSub }}>
                                      {item.estimatedShippingDate || '-'}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* 배송·수령 정보 */}
                          <div style={{ marginTop: 6, fontSize: 11, color: E.inkSub, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            {order.receiverName && <span>수령인 <b style={{ color: E.ink }}>{order.receiverName}</b></span>}
                            {order.receiverTel && <span>연락처 <span style={{ fontFamily: E.mono }}>{order.receiverTel}</span></span>}
                            {order.receiverAddr && <span>주소 {order.receiverAddr}</span>}
                            {order.invoiceInfo && (
                              <span>송장 <span style={{ fontFamily: E.mono, color: E.info }}>{order.invoiceInfo}</span></span>
                            )}
                            {order.parcelMessage && <span>배송메모 {order.parcelMessage}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ══ 상태바 — 건수·채널별·합계·페이지 ══ */}
      <div style={statusBarStyle}>
        <span>전체 <b style={statNumStyle}>{orders.length}</b>건</span>
        <span style={{ color: E.inkMute }}>
          쿠팡 <b style={statNumStyle}>{coupangCount}</b> · 로켓그로스 <b style={statNumStyle}>{rgCount}</b>
          {' · '}네이버 <b style={statNumStyle}>{naverCount}</b> · 토스 <b style={statNumStyle}>{tossCount}</b>
        </span>
        <span>합계 <b style={statNumStyle}>{totalRevenue.toLocaleString()}</b>원</span>

        {orders.length > PAGE_SIZE && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {nextToken && (
              <button onClick={() => fetchOrders(false)} disabled={loading} style={{ ...btnStyle, height: 21 }}>
                다음 50건 더
              </button>
            )}
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="이전 페이지"
              style={{ ...btnStyle, height: 21, padding: '0 6px', opacity: page === 1 ? 0.4 : 1 }}
            >
              <ChevronLeft size={12} />
            </button>
            <span style={statNumStyle}>{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              aria-label="다음 페이지"
              style={{ ...btnStyle, height: 21, padding: '0 6px', opacity: page === totalPages ? 0.4 : 1 }}
            >
              <ChevronRight size={12} />
            </button>
          </span>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`,
  borderRight: `1px solid ${E.lineSoft}`,
  padding: '4px 8px',
  color: E.ink,
  verticalAlign: 'middle',
};

const numCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontFamily: E.mono,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};
