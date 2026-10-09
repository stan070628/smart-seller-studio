// src/__tests__/components/dashboard/dashboard-client.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DashboardClient from '@/components/dashboard/DashboardClient';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const today = {
  newOrders: { data: { count: 0, stale: 0 }, error: null },
  unmapped: { data: { lines: 0 }, error: null },
  jobFailures: { data: { jobs: [] }, error: null },
  shortage: { data: { lines: 0, skus: 0 }, error: null },
  rgMismatch: { data: { alerts: 0, runAt: new Date().toISOString() }, error: null },
  flow: { data: { paid: 0, shipping: 0, delivered: 0, confirmed: 0, cancel_requested: 0, canceled: 0, return_requested: 0, returned: 0 }, error: null },
};
const revenue = (total: number) => ({
  period: '7d', from: '', to: '',
  days: [{ day: '2026-10-09', total, byChannel: { coupang_rg: total } }],
  totals: { revenue: total, orders: 1, byChannel: { coupang_rg: { revenue: total, orders: 1 } } },
});
const json = (data: unknown) => ({ json: async () => ({ success: true, data }) });

afterEach(() => vi.unstubAllGlobals());

describe('DashboardClient — 매출 기간 전환', () => {
  it('늦게 온 앞 기간 응답이 뒤 기간 결과를 덮지 않는다', async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/erp/home/today')) return Promise.resolve(json(today));
      if (url.startsWith('/api/dashboard/product-count')) return Promise.resolve(json({ coupang: 0, naver: 0 }));
      const p = new URL(url, 'http://x').searchParams.get('period') ?? '';
      return new Promise((res) => { pending[p] = res; });
    }));
    render(<DashboardClient />);
    await waitFor(() => expect(pending['30d']).toBeDefined());
    fireEvent.click(screen.getByRole('tab', { name: '7일' }));
    await waitFor(() => expect(pending['7d']).toBeDefined());
    await act(async () => { pending['7d'](json(revenue(7000))); });
    await act(async () => { pending['30d'](json(revenue(30000))); });
    expect(screen.getByText('7,000원')).toBeInTheDocument();
    expect(screen.queryByText('30,000원')).not.toBeInTheDocument();
  });
});
