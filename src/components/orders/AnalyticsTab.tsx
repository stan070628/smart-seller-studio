'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { PLATFORM_INFO, type OrderPlatform } from '@/types/orders';

// 목업 매출 데이터
const MOCK_SUMMARY = {
  totalRevenue: 23_400_000,
  totalProfit: 4_850_000,
  totalOrders: 892,
  avgMarginRate: 20.7,
  revenueChange: 12.5,
};

const MOCK_BY_PLATFORM: { platform: OrderPlatform; revenue: number; orders: number; ratio: number }[] = [
  { platform: 'coupang', revenue: 10_530_000, orders: 401, ratio: 45 },
  { platform: 'naver', revenue: 7_020_000, orders: 267, ratio: 30 },
  { platform: 'gmarket', revenue: 3_510_000, orders: 134, ratio: 15 },
  { platform: 'elevenst', revenue: 2_340_000, orders: 90, ratio: 10 },
];

const MOCK_TOP_PRODUCTS = [
  { title: '실리콘 주방매트 대형', sold: 234, revenue: 4_633_200, cost: 1_989_000, profit: 2_644_200 },
  { title: '접이식 스테인리스 건조대', sold: 189, revenue: 6_048_000, cost: 2_835_000, profit: 3_213_000 },
  { title: '무선 헤어드라이기 접이식', sold: 156, revenue: 7_020_000, cost: 3_432_000, profit: 3_588_000 },
  { title: '천연 대나무 도마 세트', sold: 142, revenue: 3_976_000, cost: 1_704_000, profit: 2_272_000 },
  { title: '다용도 스테인리스 수납장', sold: 98, revenue: 4_900_000, cost: 2_450_000, profit: 2_450_000 },
];

export default function AnalyticsTab() {
  const formatPrice = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  };

  return (
    <div>
      {/* 안내 배너 */}
      <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '14px 18px', marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: '#1e40af', margin: 0 }}>
          📊 아래는 미리보기 데이터입니다. 채널 연동 후 실제 매출 데이터가 표시됩니다.
        </p>
      </div>

      {/* 매출 요약 4카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
        <MetricCard label="총 매출 (30일)" value={`${(MOCK_SUMMARY.totalRevenue / 10_000).toFixed(0)}만원`} change={MOCK_SUMMARY.revenueChange} />
        <MetricCard label="순이익" value={`${(MOCK_SUMMARY.totalProfit / 10_000).toFixed(0)}만원`} change={8.3} />
        <MetricCard label="총 주문" value={`${MOCK_SUMMARY.totalOrders}건`} change={5.2} />
        <MetricCard label="평균 마진율" value={`${MOCK_SUMMARY.avgMarginRate}%`} change={-1.2} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* 채널별 매출 */}
        <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>채널별 매출 비중</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {MOCK_BY_PLATFORM.map((p) => {
              const info = PLATFORM_INFO[p.platform];
              return (
                <div key={p.platform}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#18181b' }}>{info.label}</span>
                    <span style={{ fontSize: '12px', color: '#71717a' }}>{formatPrice(p.revenue)}원 ({p.ratio}%)</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#f4f4f5', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '4px', backgroundColor: info.color, width: `${p.ratio}%`, transition: 'width 0.5s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 수익성 경고 */}
        <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>⚠️ 수익성 경고</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <WarningItem text='"접이식 건조대" 마진율 3% → 가격 조정 필요' />
            <WarningItem text='"USB 충전기" 반품률 15% → 품질 점검 필요' />
            <WarningItem text='"실리콘 매트" 재고 소진 임박 → 재발주 필요' />
          </div>
        </div>
      </div>

      {/* 상품별 수익 Top */}
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', padding: '20px', marginTop: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: '0 0 16px' }}>🏆 상품별 수익 Top 5</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f4f4f5' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>상품명</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>판매수</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>매출</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>원가</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_TOP_PRODUCTS.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f4f4f5' }}>
                <td style={{ padding: '10px 12px', color: '#18181b' }}>{p.title}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#71717a' }}>{p.sold}개</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500 }}>{formatPrice(p.revenue)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#71717a' }}>{formatPrice(p.cost)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>+{formatPrice(p.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, change }: { label: string; value: string; change: number }) {
  const isPositive = change >= 0;
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e5e5', padding: '16px' }}>
      <p style={{ fontSize: '11px', color: '#71717a', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 700, color: '#18181b', margin: '0 0 6px' }}>{value}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {isPositive ? <TrendingUp size={12} color="#16a34a" /> : <TrendingDown size={12} color="#dc2626" />}
        <span style={{ fontSize: '11px', fontWeight: 600, color: isPositive ? '#16a34a' : '#dc2626' }}>
          {isPositive ? '+' : ''}{change}%
        </span>
        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전월 대비</span>
      </div>
    </div>
  );
}

function WarningItem({ text }: { text: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#fffbeb', fontSize: '13px', color: '#92400e' }}>
      {text}
    </div>
  );
}
