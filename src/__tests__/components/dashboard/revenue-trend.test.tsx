// src/__tests__/components/dashboard/revenue-trend.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RevenueTrend from '@/components/dashboard/RevenueTrend';
import type { RevenueData } from '@/lib/erp/home/revenue';

const data: RevenueData = {
  period: '7d', from: '', to: '',
  days: [
    { day: '2026-10-08', total: 28200, byChannel: { coupang_rg: 28200 } },
    { day: '2026-10-09', total: 24000, byChannel: { coupang_rg: 14100, naver: 9900 } },
  ],
  totals: { revenue: 52200, orders: 4, byChannel: { coupang_rg: { revenue: 42300, orders: 3 }, naver: { revenue: 9900, orders: 1 } } },
};

describe('RevenueTrend', () => {
  it('합계 · 채널 비중 · 날짜 막대 · RG 한계 문구', () => {
    render(<RevenueTrend data={data} period="7d" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByText('52,200원')).toBeInTheDocument();
    expect(screen.getByText(/4건/)).toBeInTheDocument();
    expect(screen.getByText(/쿠팡 RG 81%/)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /10-0[89] 매출/ })).toHaveLength(2);
    expect(screen.getByText(/RG 매출은 취소·반품만큼 크게 잡힌다/)).toBeInTheDocument();
  });

  it('기간 토글이 onPeriodChange를 부른다', () => {
    const on = vi.fn();
    render(<RevenueTrend data={data} period="7d" onPeriodChange={on} loading={false} error={null} />);
    fireEvent.click(screen.getByRole('tab', { name: '30일' }));
    expect(on).toHaveBeenCalledWith('30d');
  });

  it('채널 비중 0.5% 미만은 <1%', () => {
    const d: RevenueData = { ...data, totals: { revenue: 100000, orders: 2, byChannel: { coupang_rg: { revenue: 99800, orders: 1 }, naver: { revenue: 200, orders: 1 } } } };
    render(<RevenueTrend data={d} period="7d" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByText(/네이버 <1%/)).toBeInTheDocument();
  });

  it('다시 불러오는 중이면 흐리게', () => {
    render(<RevenueTrend data={data} period="7d" onPeriodChange={() => {}} loading error={null} />);
    expect(screen.getByRole('region', { name: '매출 추이' })).toHaveStyle({ opacity: '0.5' });
  });

  it('오류면 오류 문구 · 매출 0이면 「매출 없음」', () => {
    const { rerender } = render(<RevenueTrend data={null} period="7d" onPeriodChange={() => {}} loading={false} error="db down" />);
    expect(screen.getByText('매출을 불러오지 못했다 — 새로고침으로 다시 시도')).toBeInTheDocument();
    expect(screen.queryByText(/db down/)).not.toBeInTheDocument();
    rerender(<RevenueTrend data={{ ...data, days: [{ day: '2026-10-09', total: 0, byChannel: {} }], totals: { revenue: 0, orders: 0, byChannel: {} } }} period="today" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByText('매출 없음')).toBeInTheDocument();
  });
});
