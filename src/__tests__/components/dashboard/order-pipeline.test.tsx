/**
 * OrderPipeline 컴포넌트 테스트
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrderPipeline from '@/components/dashboard/OrderPipeline';
import type { ChannelPipeline } from '@/lib/dashboard/types';

const emptyChannel: ChannelPipeline = {
  주문:     { count: 0, amount: 0 },
  배송중:   { count: 0, amount: 0 },
  배송완료: { count: 0, amount: 0 },
  구매확정: { count: 0, amount: 0 },
  정산완료: { count: 0, amount: 0, available: false },
  lastUpdated: '2026-04-26T00:00:00.000Z',
};

const sampleCoupang: ChannelPipeline = {
  ...emptyChannel,
  주문:     { count: 12, amount: 120_000 },
  배송중:   { count: 8,  amount: 80_000 },
  배송완료: { count: 25, amount: 250_000 },
  구매확정: { count: 18, amount: 180_000 },
  정산완료: { count: 15, amount: 150_000, available: true },
};

describe('OrderPipeline', () => {
  it('두 채널의 5단계를 모두 렌더링한다', () => {
    render(
      <OrderPipeline
        coupang={sampleCoupang}
        naver={emptyChannel}
        period="7d"
        onPeriodChange={vi.fn()}
      />
    );
    expect(screen.getByText('쿠팡')).toBeInTheDocument();
    expect(screen.getByText('네이버')).toBeInTheDocument();
    expect(screen.getAllByText('주문').length).toBe(2);
    expect(screen.getAllByText('배송중').length).toBe(2);
    expect(screen.getAllByText('배송완료').length).toBe(2);
    expect(screen.getAllByText('구매확정').length).toBe(2);
    expect(screen.getAllByText('정산완료').length).toBe(2);
  });

  it('정산 미연동(available=false) stage는 "API 미연동"으로 표시', () => {
    render(
      <OrderPipeline
        coupang={emptyChannel}
        naver={emptyChannel}
        period="today"
        onPeriodChange={vi.fn()}
      />
    );
    expect(screen.getAllByText('API 미연동').length).toBe(2);
  });

  it('PeriodToggle 클릭 시 onPeriodChange 호출', async () => {
    const onChange = vi.fn();
    render(
      <OrderPipeline
        coupang={emptyChannel}
        naver={emptyChannel}
        period="today"
        onPeriodChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('tab', { name: '30일' }));
    expect(onChange).toHaveBeenCalledWith('30d');
  });
});
