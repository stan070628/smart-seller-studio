/**
 * AppShell-tabs.test.tsx
 * 주소 변화가 탭으로 반영되는지 확인
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import AppShell from '@/components/AppShell';
import { useTabStore } from '@/store/useTabStore';

let pathname = '/sourcing';
let search = new URLSearchParams('tab=discovery');

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/alerts/AlertList', () => ({
  default: () => null,
}));

beforeEach(() => {
  localStorage.clear();
  useTabStore.setState({ tabs: [], activeId: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true, rows: [] }) }));
});

describe('AppShell 탭 연동', () => {
  it('진입한 주소가 탭으로 열린다', () => {
    render(<AppShell>본문</AppShell>);

    const { tabs, activeId } = useTabStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].href).toBe('/sourcing?tab=discovery');
    expect(activeId).toBe('sourcing');
  });

  it('주소가 바뀌면 탭이 따라 바뀐다', () => {
    const { rerender } = render(<AppShell>본문</AppShell>);

    pathname = '/orders';
    search = new URLSearchParams();
    rerender(<AppShell>본문</AppShell>);

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['sourcing', 'orders']);
    expect(useTabStore.getState().activeId).toBe('orders');
  });
});
