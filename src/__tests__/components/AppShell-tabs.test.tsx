/**
 * AppShell-tabs.test.tsx
 * 주소 변화가 탭으로 반영되는지 확인
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import AppShell from '@/components/AppShell';
import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';

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
  useCacheStore.setState({ entries: {}, scroll: {} });
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

  it('밀려난 탭의 캐시가 실제로 해제된다 — 배선 확인', () => {
    // 탭 6개와 그중 하나(dashboard)의 캐시를 심어둔다.
    // AppShell이 브리지를 렌더 중(수정 1)이 아니라 effect로 다시 걸면,
    // 자식 TabSync의 effect(openTab → 7번째 진입 → 밀어내기)가 부모 effect보다
    // 먼저 실행되어 이 첫 밀어내기를 브리지가 놓친다.
    ['/dashboard', '/sourcing', '/listing', '/label', '/orders', '/plan'].forEach((h) =>
      useTabStore.getState().openTab(h),
    );
    useCacheStore.getState().setEntry('dashboard:summary', { total: 1 });

    pathname = '/editor';
    search = new URLSearchParams();
    render(<AppShell>본문</AppShell>);

    expect(useTabStore.getState().tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(useCacheStore.getState().entries['dashboard:summary']).toBeUndefined();
  });
});
