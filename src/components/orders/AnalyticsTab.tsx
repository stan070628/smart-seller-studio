'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface OrderItem {
  sellerProductName: string;
  shippingCount: number;
  orderPrice: number;
}

interface CoupangOrder {
  orderId: number;
  status: string;
  orderedAt: string;
  orderItems: OrderItem[];
}

interface Analytics {
  totalRevenue: number;
  totalOrders: number;
  totalItems: number;
  cancelCount: number;
  avgOrderValue: number;
  topProducts: { name: string; sold: number; revenue: number }[];
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────

const CANCELLED = new Set(['CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE']);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function computeAnalytics(orders: CoupangOrder[]): Analytics {
  const active = orders.filter((o) => !CANCELLED.has(o.status));
  const totalRevenue = active.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0);
  const totalItems = active.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.shippingCount, 0), 0);
  const cancelCount = orders.filter((o) => CANCELLED.has(o.status)).length;
  const avgOrderValue = active.length > 0 ? Math.round(totalRevenue / active.length) : 0;

  // 상품별 집계
  const productMap = new Map<string, { sold: number; revenue: number }>();
  for (const o of active) {
    for (const i of o.orderItems) {
      const name = i.sellerProductName;
      const prev = productMap.get(name) ?? { sold: 0, revenue: 0 };
      productMap.set(name, { sold: prev.sold + i.shippingCount, revenue: prev.revenue + i.orderPrice });
    }
  }
  const topProducts = [...productMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return { totalRevenue, totalOrders: active.length, totalItems, cancelCount, avgOrderValue, topProducts };
}

function changePct(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, change, sub,
}: { label: string; value: string; change: number | null; sub?: string }) {
  const isPositive = change !== null && change >= 0;
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e5e5', padding: '16px' }}>
      <p style={{ fontSize: '11px', color: '#71717a', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 700, color: '#18181b', margin: '0 0 6px' }}>{value}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {change !== null ? (
          <>
            {isPositive ? <TrendingUp size={12} color="#16a34a" /> : <TrendingDown size={12} color="#dc2626" />}
            <span style={{ fontSize: '11px', fontWeight: 600, color: isPositive ? '#16a34a' : '#dc2626' }}>
              {isPositive ? '+' : ''}{change}%
            </span>
            <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전기 대비</span>
          </>
        ) : (
          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>{sub ?? '비교 데이터 없음'}</span>
        )}
      </div>
    </div>
  );
}

async function fetchOrdersForPeriod(from: string, to: string): Promise<CoupangOrder[]> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/orders/coupang?${params.toString()}`);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error ?? '주문 조회 실패');
  return json.data?.items ?? [];
}

const PERIODS = [
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
] as const;

function getPeriodDates(months: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  return { from: toDateStr(from), to: toDateStr(to) };
}

export default function AnalyticsTab() {
  const [selectedMonths, setSelectedMonths] = useState<number>(1);

  const { from, to } = getPeriodDates(selectedMonths);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Analytics | null>(null);
  const [previous, setPrevious] = useState<Analytics | null>(null);

  const fetchData = useCallback(async (months: number) => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getPeriodDates(months);
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / 86400_000);

      const prevTo = new Date(fromDate.getTime() - 86400_000);
      const prevFrom = new Date(prevTo.getTime() - daysDiff * 86400_000);

      const [currOrders, prevOrders] = await Promise.all([
        fetchOrdersForPeriod(from, to),
        fetchOrdersForPeriod(toDateStr(prevFrom), toDateStr(prevTo)),
      ]);

      setCurrent(computeAnalytics(currOrders));
      setPrevious(computeAnalytics(prevOrders));
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedMonths);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonths]);

  const fmt = (n: number) => {
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}천만`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
    return n.toLocaleString();
  };

  return (
    <div>
      {/* 필터 행 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        {PERIODS.map(({ label, months }) => (
          <button
            key={months}
            onClick={() => setSelectedMonths(months)}
            disabled={loading}
            style={{
              fontSize: '13px', fontWeight: selectedMonths === months ? 700 : 500,
              padding: '5px 16px', borderRadius: '8px', cursor: loading ? 'default' : 'pointer',
              border: selectedMonths === months ? '1px solid #18181b' : '1px solid #e5e5e5',
              backgroundColor: selectedMonths === months ? '#18181b' : '#fff',
              color: selectedMonths === months ? '#fff' : '#18181b',
            }}
          >
            {label}
          </button>
        ))}
        <button onClick={() => fetchData(selectedMonths)} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 500, padding: '5px 14px', borderRadius: '8px', border: '1px solid #e5e5e5', backgroundColor: '#fff', color: '#18181b', cursor: loading ? 'default' : 'pointer', marginLeft: '4px' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          새로고침
        </button>
        <span style={{ fontSize: '12px', color: '#a1a1aa' }}>* 쿠팡 주문 기준 · 전기 대비 = 동일 기간 이전</span>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
          <AlertCircle size={15} color="#dc2626" />
          <span style={{ fontSize: '13px', color: '#dc2626' }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#71717a', fontSize: '13px' }}>
          매출 데이터를 불러오는 중...
        </div>
      ) : current ? (
        <>
          {/* 요약 카드 4개 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
            <MetricCard
              label={`총 매출 (${from.slice(5)} ~ ${to.slice(5)})`}
              value={`${fmt(current.totalRevenue)}원`}
              change={previous ? changePct(current.totalRevenue, previous.totalRevenue) : null}
            />
            <MetricCard
              label="주문 건수"
              value={`${current.totalOrders}건`}
              change={previous ? changePct(current.totalOrders, previous.totalOrders) : null}
            />
            <MetricCard
              label="평균 주문금액"
              value={`${current.avgOrderValue.toLocaleString()}원`}
              change={previous ? changePct(current.avgOrderValue, previous.avgOrderValue) : null}
            />
            <MetricCard
              label="취소/반품"
              value={`${current.cancelCount}건`}
              change={null}
              sub="기간 내 합산"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* 채널별 매출 (현재 쿠팡만 연동됨) */}
            <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>채널별 매출</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* 쿠팡 */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#18181b' }}>쿠팡</span>
                    <span style={{ fontSize: '12px', color: '#71717a' }}>{fmt(current.totalRevenue)}원 · {current.totalOrders}건</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#f4f4f5' }}>
                    <div style={{ height: '100%', borderRadius: '4px', backgroundColor: '#be0014', width: '100%' }} />
                  </div>
                </div>
                <p style={{ fontSize: '12px', color: '#a1a1aa', margin: '4px 0 0' }}>
                  네이버·11번가 등 다른 채널 연동 시 자동 집계됩니다.
                </p>
              </div>
            </div>

            {/* 전기 대비 비교 */}
            <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>전기 대비 비교</h3>
              {previous ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                  <CompareRow label="매출" curr={current.totalRevenue} prev={previous.totalRevenue} fmt={(v) => `${fmt(v)}원`} />
                  <CompareRow label="주문수" curr={current.totalOrders} prev={previous.totalOrders} fmt={(v) => `${v}건`} />
                  <CompareRow label="판매수량" curr={current.totalItems} prev={previous.totalItems} fmt={(v) => `${v}개`} />
                  <CompareRow label="평균주문금액" curr={current.avgOrderValue} prev={previous.avgOrderValue} fmt={(v) => `${v.toLocaleString()}원`} />
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: '#a1a1aa' }}>전기 데이터 없음</p>
              )}
            </div>
          </div>

          {/* 상품별 매출 Top */}
          <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px', marginTop: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>상품별 매출 Top {current.topProducts.length}</h3>
            {current.topProducts.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#a1a1aa', textAlign: 'center', padding: '20px' }}>해당 기간에 매출 데이터가 없습니다.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f4f4f5' }}>
                    <th style={th}>#</th>
                    <th style={th}>상품명</th>
                    <th style={{ ...th, textAlign: 'right' }}>판매수</th>
                    <th style={{ ...th, textAlign: 'right' }}>매출</th>
                    <th style={{ ...th, textAlign: 'right' }}>매출 비중</th>
                  </tr>
                </thead>
                <tbody>
                  {current.topProducts.map((p, i) => {
                    const ratio = current.totalRevenue > 0
                      ? Math.round((p.revenue / current.totalRevenue) * 1000) / 10
                      : 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #f4f4f5' }}>
                        <td style={{ ...tdStyle, color: '#a1a1aa', width: '30px' }}>{i + 1}</td>
                        <td style={tdStyle}>{p.name}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#71717a' }}>{p.sold}개</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmt(p.revenue)}원</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            <div style={{ width: '60px', height: '6px', borderRadius: '3px', backgroundColor: '#f4f4f5', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: '3px', backgroundColor: '#be0014', width: `${ratio}%` }} />
                            </div>
                            <span style={{ color: '#71717a', minWidth: '36px' }}>{ratio}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function CompareRow({
  label, curr, prev, fmt,
}: { label: string; curr: number; prev: number; fmt: (v: number) => string }) {
  const change = changePct(curr, prev);
  const isUp = change !== null && change >= 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <span style={{ color: '#71717a' }}>{label}</span>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <span style={{ color: '#a1a1aa', fontSize: '12px' }}>{fmt(prev)}</span>
        <span style={{ color: '#a1a1aa' }}>→</span>
        <span style={{ fontWeight: 600, color: '#18181b' }}>{fmt(curr)}</span>
        {change !== null && (
          <span style={{ fontSize: '11px', fontWeight: 600, color: isUp ? '#16a34a' : '#dc2626' }}>
            {isUp ? '▲' : '▼'} {Math.abs(change)}%
          </span>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#71717a',
  fontSize: '12px',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#18181b',
};
