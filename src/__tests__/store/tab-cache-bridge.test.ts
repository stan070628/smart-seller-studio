/**
 * tab-cache-bridge.test.ts
 * 탭이 사라지면 그 라우트의 캐시가 해제되는지 확인
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTabCacheBridge } from '@/store/tab-cache-bridge';
import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';

let stop: () => void;

beforeEach(() => {
  localStorage.clear();
  useTabStore.setState({ tabs: [], activeId: null });
  useCacheStore.setState({ entries: {}, scroll: {} });
  stop = startTabCacheBridge();
});

afterEach(() => {
  stop();
});

describe('탭 소멸 → 캐시 해제', () => {
  it('탭을 닫으면 그 라우트의 캐시가 사라진다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);
    useCacheStore.getState().setEntry('orders:costs', [2]);
    useCacheStore.getState().setEntry('sourcing:shortlist', [3]);

    useTabStore.getState().closeTab('orders');

    expect(Object.keys(useCacheStore.getState().entries)).toEqual(['sourcing:shortlist']);
  });

  it('밀려난 탭의 캐시도 사라진다', () => {
    ['/dashboard', '/sourcing', '/listing', '/label', '/orders', '/plan'].forEach((h) =>
      useTabStore.getState().openTab(h),
    );
    useCacheStore.getState().setEntry('dashboard:summary', [1]);

    useTabStore.getState().openTab('/editor'); // 7번째 → dashboard 밀려남

    expect(useCacheStore.getState().entries['dashboard:summary']).toBeUndefined();
  });

  it('탭이 유지되면 캐시도 유지된다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);

    useTabStore.getState().openTab('/orders?tab=cost');

    expect(useCacheStore.getState().entries['orders:list']).toBeDefined();
  });

  it('구독을 멈추면 더 이상 해제하지 않는다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);

    stop();
    useTabStore.getState().closeTab('orders');

    expect(useCacheStore.getState().entries['orders:list']).toBeDefined();
  });
});
