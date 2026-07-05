import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const replaceMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/orders',
}));

// 하위 탭 컴포넌트는 네트워크/무거운 로직을 가지므로 렌더만 확인되도록 스텁 처리
vi.mock('@/components/orders/OrdersTab', () => ({ default: () => <div>주문탭내용</div> }));
vi.mock('@/components/orders/CostManagementTab', () => ({ default: () => <div>수익원가탭내용</div> }));
vi.mock('@/components/orders/ChannelsTab', () => ({ default: () => <div>채널설정탭내용</div> }));

import OrdersClient from '@/components/orders/OrdersClient';

describe('OrdersClient — 서브탭 URL 동기화', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    for (const k of Array.from(searchParams.keys())) searchParams.delete(k);
  });

  it('기본은 주문·배송 탭을 렌더한다', () => {
    render(<OrdersClient />);
    expect(screen.getByText('주문탭내용')).toBeInTheDocument();
  });

  it('수익·원가 탭 클릭 시 URL ?tab=cost 로 동기화된다', () => {
    render(<OrdersClient />);
    fireEvent.click(screen.getByRole('button', { name: /수익·원가/ }));
    expect(replaceMock).toHaveBeenCalledWith('/orders?tab=cost', { scroll: false });
  });

  it('주문·배송 탭 클릭 시 tab 파라미터를 제거한다', () => {
    searchParams.set('tab', 'cost');
    render(<OrdersClient />);
    fireEvent.click(screen.getByRole('button', { name: /주문·배송/ }));
    expect(replaceMock).toHaveBeenCalledWith('/orders', { scroll: false });
  });

  it('URL ?tab=channels 로 진입하면 채널설정 탭을 렌더한다', () => {
    searchParams.set('tab', 'channels');
    render(<OrdersClient />);
    expect(screen.getByText('채널설정탭내용')).toBeInTheDocument();
  });
});
