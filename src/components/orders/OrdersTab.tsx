'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Package, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { PLATFORM_INFO } from '@/types/orders';

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
  platform: 'coupang' | 'naver';
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

function StatusBadge({ status, platform }: { status: string; platform: 'coupang' | 'naver' }) {
  const map = platform === 'naver' ? NAVER_STATUS_MAP : COUPANG_STATUS_MAP;
  const info = map[status] ?? { label: status, color: '#71717a', bg: 'rgba(113,113,122,0.08)' };
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', color: info.color, backgroundColor: info.bg }}>
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

// ─── 컴포넌트 ─────────────────────────────────────────────────

export default function OrdersTab() {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const [from, setFrom] = useState(toDateStr(defaultFrom));
  const [to, setTo] = useState(toDateStr(today));
  const [statusFilter, setStatusFilter] = useState('');
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coupangError, setCoupangError] = useState<string | null>(null);
  const [naverError, setNaverError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const fetchOrders = useCallback(async (reset = true) => {
    setLoading(true);
    setCoupangError(null);
    setNaverError(null);

    const params = new URLSearchParams({ from, to });
    if (statusFilter) params.set('status', statusFilter);

    // 쿠팡 + 네이버 병렬 조회 — 한 쪽 실패해도 다른 쪽 표시
    const [coupangResult, naverResult] = await Promise.allSettled([
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

  // 현재 페이지 슬라이싱
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pagedOrders = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 총 매출
  const totalRevenue = orders.reduce((sum, o) => {
    return sum + o.orderItems.reduce((s, i) => s + i.orderPrice, 0);
  }, 0);

  return (
    <div>
      {/* 필터 행 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#71717a' }}>
          <span>기간</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ fontSize: '13px', padding: '5px 8px', borderRadius: '8px', border: '1px solid #e5e5e5', outline: 'none', color: '#18181b' }} />
          <span>~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ fontSize: '13px', padding: '5px 8px', borderRadius: '8px', border: '1px solid #e5e5e5', outline: 'none', color: '#18181b' }} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '8px', border: '1px solid #e5e5e5', outline: 'none', color: '#18181b', backgroundColor: '#fff' }}>
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button onClick={() => fetchOrders(true)} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 500, padding: '5px 14px', borderRadius: '8px', border: '1px solid #e5e5e5', backgroundColor: '#fff', color: '#18181b', cursor: loading ? 'default' : 'pointer' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          조회
        </button>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#71717a' }}>
          전체 주문 {orders.length}건 (쿠팡 {coupangCount}건 · 네이버 {naverCount}건) · 총 {totalRevenue.toLocaleString()}원
        </span>
      </div>

      {/* 에러 — 쿠팡/네이버 개별 표시 */}
      {coupangError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px' }}>
          <AlertCircle size={15} color="#dc2626" />
          <span style={{ fontSize: '13px', color: '#dc2626' }}>쿠팡: {coupangError}</span>
        </div>
      )}
      {naverError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px' }}>
          <AlertCircle size={15} color="#dc2626" />
          <span style={{ fontSize: '13px', color: '#dc2626' }}>네이버: {naverError}</span>
        </div>
      )}

      {/* 쿠팡 상태 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STATUS_SUMMARY_KEYS.length}, 1fr)`, gap: '10px', marginBottom: '20px' }}>
        {STATUS_SUMMARY_KEYS.map((s) => {
          const info = COUPANG_STATUS_MAP[s];
          return (
            <button key={s} onClick={() => { setStatusFilter(s === statusFilter ? '' : s); }}
              style={{ backgroundColor: statusFilter === s ? info.bg : '#fff', borderRadius: '10px', border: `1px solid ${statusFilter === s ? info.color + '40' : '#e5e5e5'}`, padding: '10px 12px', textAlign: 'center', cursor: 'pointer' }}>
              <p style={{ fontSize: '20px', fontWeight: 700, color: info.color, margin: 0 }}>{statusCounts[s] ?? 0}</p>
              <p style={{ fontSize: '11px', color: '#71717a', margin: '4px 0 0' }}>{info.label}</p>
            </button>
          );
        })}
      </div>

      {/* 주문 테이블 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#71717a', fontSize: '13px' }}>
          주문 데이터를 불러오는 중...
        </div>
      ) : pagedOrders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#71717a', fontSize: '13px' }}>
          <Package size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
          <p>해당 기간에 주문이 없습니다.</p>
        </div>
      ) : (
        <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                <th style={th}>주문번호</th>
                <th style={th}>채널</th>
                <th style={th}>상품명</th>
                <th style={{ ...th, textAlign: 'right' }}>수량</th>
                <th style={{ ...th, textAlign: 'right' }}>결제금액</th>
                <th style={{ ...th, textAlign: 'center' }}>상태</th>
                <th style={th}>주문일시</th>
                <th style={th}>수령인</th>
              </tr>
            </thead>
            <tbody>
              {pagedOrders.map((order) => {
                const totalQty = order.orderItems.reduce((s, i) => s + i.shippingCount, 0);
                const totalAmt = order.orderItems.reduce((s, i) => s + i.orderPrice, 0);
                const firstName = order.orderItems[0];
                const extraCount = order.orderItems.length - 1;
                const isExpanded = expandedKey === order.key;
                const platformInfo = PLATFORM_INFO[order.platform];

                return (
                  <React.Fragment key={order.key}>
                    <tr
                      onClick={() => setExpandedKey(isExpanded ? null : order.key)}
                      style={{ borderBottom: '1px solid #f4f4f5', cursor: 'pointer', backgroundColor: isExpanded ? '#fafafa' : '#fff' }}
                    >
                      <td style={td}><span style={{ fontWeight: 500, color: '#2563eb', fontFamily: 'monospace', fontSize: '12px' }}>{order.orderId}</span></td>
                      <td style={td}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: platformInfo.color, backgroundColor: `${platformInfo.color}10`, padding: '2px 8px', borderRadius: '100px' }}>
                          {platformInfo.label}
                        </span>
                      </td>
                      <td style={{ ...td, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {firstName?.sellerProductName ?? '-'}
                        {extraCount > 0 && <span style={{ marginLeft: '4px', fontSize: '11px', color: '#71717a' }}>외 {extraCount}건</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: '#71717a' }}>{totalQty}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{totalAmt.toLocaleString()}원</td>
                      <td style={{ ...td, textAlign: 'center' }}><StatusBadge status={order.status} platform={order.platform} /></td>
                      <td style={{ ...td, color: '#71717a', fontSize: '12px' }}>{formatDate(order.orderedAt)}</td>
                      <td style={{ ...td, color: '#71717a', fontSize: '12px' }}>{order.receiverName ?? '-'}</td>
                    </tr>

                    {/* 펼침: 주문 상세 */}
                    {isExpanded && (
                      <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                        <td colSpan={8} style={{ padding: '0 16px 12px 16px', backgroundColor: '#fafafa' }}>
                          <div style={{ borderRadius: '8px', border: '1px solid #e5e5e5', overflow: 'hidden', fontSize: '12px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ backgroundColor: '#f3f4f6' }}>
                                  <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#71717a' }}>상품명</th>
                                  <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#71717a' }}>옵션</th>
                                  <th style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a' }}>수량</th>
                                  <th style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a' }}>결제금액</th>
                                  {order.platform === 'coupang' && (
                                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: '#71717a' }}>예상출고일</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {order.orderItems.map((item, idx) => (
                                  <tr key={idx} style={{ borderTop: '1px solid #f3f4f6' }}>
                                    <td style={{ padding: '7px 12px', color: '#18181b' }}>{item.sellerProductName}</td>
                                    <td style={{ padding: '7px 12px', color: '#71717a' }}>{item.sellerProductItemName || '-'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right' }}>{item.shippingCount}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 500 }}>{item.orderPrice.toLocaleString()}원</td>
                                    {order.platform === 'coupang' && (
                                      <td style={{ padding: '7px 12px', color: '#71717a' }}>{item.estimatedShippingDate || '-'}</td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {/* 배송/수령 정보 */}
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#71717a', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                            {order.receiverName && (
                              <span>수령인: <b style={{ color: '#18181b' }}>{order.receiverName}</b></span>
                            )}
                            {order.receiverAddr && (
                              <span>주소: {order.receiverAddr}</span>
                            )}
                            {order.receiverTel && (
                              <span>연락처: {order.receiverTel}</span>
                            )}
                            {order.invoiceInfo && (
                              <span>송장: <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{order.invoiceInfo}</span></span>
                            )}
                            {order.parcelMessage && (
                              <span>배송메모: {order.parcelMessage}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {orders.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '5px 10px', borderRadius: '7px', border: '1px solid #e5e5e5', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: '13px', color: '#71717a' }}>{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '5px 10px', borderRadius: '7px', border: '1px solid #e5e5e5', background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}>
            <ChevronRight size={14} />
          </button>
          {nextToken && (
            <button onClick={() => fetchOrders(false)} disabled={loading}
              style={{ fontSize: '12px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
              다음 50건 더 불러오기
            </button>
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#71717a',
  fontSize: '12px',
};

const td: React.CSSProperties = {
  padding: '12px 16px',
  color: '#18181b',
};
