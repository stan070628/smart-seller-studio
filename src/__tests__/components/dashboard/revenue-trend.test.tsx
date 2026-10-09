// src/__tests__/components/dashboard/revenue-trend.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RevenueTrend from '@/components/dashboard/RevenueTrend';
import type { RevenueData } from '@/lib/erp/home/revenue';

const data: RevenueData = {
  period: '7d', from: '', to: '',
  days: [
    { day: '2026-10-08', total: 28200, orders: 2, byChannel: { coupang_rg: 28200 } },
    { day: '2026-10-09', total: 24000, orders: 2, byChannel: { coupang_rg: 14100, naver: 9900 } },
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
    rerender(<RevenueTrend data={{ ...data, days: [{ day: '2026-10-09', total: 0, orders: 0, byChannel: {} }], totals: { revenue: 0, orders: 0, byChannel: {} } }} period="today" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByText('매출 없음')).toBeInTheDocument();
  });

  it('막대에 마우스를 올리면 날짜·합계·건수·채널별 금액이 뜨고, 벗어나면 사라진다', () => {
    render(<RevenueTrend data={data} period="7d" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    const bar = screen.getByRole('img', { name: /10-09 매출/ });
    fireEvent.mouseEnter(bar);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('10-09 (금)');
    expect(tip).toHaveTextContent('24,000원');
    expect(tip).toHaveTextContent('2건');
    expect(tip).toHaveTextContent('쿠팡 RG 14,100원');
    expect(tip).toHaveTextContent('네이버 9,900원');
    expect(tip).not.toHaveTextContent('토스');
    fireEvent.mouseLeave(bar);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('키보드 초점으로도 뜬다', () => {
    render(<RevenueTrend data={data} period="7d" onPeriodChange={() => {}} loading={false} error={null} />);
    fireEvent.focus(screen.getByRole('img', { name: /10-08 매출/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('28,200원');
  });

  it('이번달은 누적 — 막대가 그날까지의 합계이고 툴팁에 누적·그날 매출이 함께 뜬다', () => {
    const month = { ...data, period: 'month' as const };
    render(<RevenueTrend data={month} period="month" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByText('이번 달 누적 매출')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '10-08 누적 매출 28,200원' })).toBeInTheDocument();
    const last = screen.getByRole('img', { name: '10-09 누적 매출 52,200원' });
    fireEvent.mouseEnter(last);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('10-09 (금) · 누적 52,200원');
    expect(tip).toHaveTextContent('그날 24,000원 · 2건');
    expect(tip).toHaveTextContent('쿠팡 RG 누적 42,300원');
    expect(tip).toHaveTextContent('네이버 누적 9,900원');
  });

  it('이번달이 아니면 하루 매출 그대로', () => {
    render(<RevenueTrend data={data} period="30d" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.queryByText('이번 달 누적 매출')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '10-09 매출 24,000원' })).toBeInTheDocument();
  });

  it('이번달이고 months가 있으면 왼쪽에 최근 월 매출 막대 · 다른 기간엔 없다', () => {
    const months = [{ month: '2026-09', revenue: 16408880, orders: 862, source: 'erp' as const }];
    const { rerender } = render(<RevenueTrend data={{ ...data, period: 'month', months }} period="month" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.getByRole('region', { name: '최근 월 매출' })).toBeInTheDocument();
    expect(screen.getByText('이번 달(1일~오늘)')).toBeInTheDocument();
    rerender(<RevenueTrend data={{ ...data, months }} period="30d" onPeriodChange={() => {}} loading={false} error={null} />);
    expect(screen.queryByRole('region', { name: '최근 월 매출' })).not.toBeInTheDocument();
  });
});
