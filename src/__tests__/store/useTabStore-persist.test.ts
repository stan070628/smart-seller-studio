/**
 * useTabStore-persist.test.ts
 * 탭 목록의 localStorage 영속 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore, TAB_STORAGE_KEY } from '@/store/useTabStore';

beforeEach(() => {
  localStorage.clear();
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('영속', () => {
  it('탭을 열면 localStorage에 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing?tab=discovery&page=3'));

    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).state.tabs[0].href).toBe('/sourcing?tab=discovery&page=3');
  });

  it('활성 탭도 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/orders'));

    expect(JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)!).state.activeId).toBe('orders');
  });

  it('isDirty는 false로 저장한다 — 재시작 후 편집 상태가 남으면 안 된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/editor'));
    act(() => result.current.setDirty('editor', true));

    const saved = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)!).state.tabs[0];
    expect(saved.isDirty).toBe(false);
  });

  it('저장 당시 편집 중이던 탭 때문에 초과 상태로 복원되면 그 자리에서 정리한다', () => {
    // non-dirty 7탭이 저장된 상황을 직접 만든다
    // (저장 시점엔 6개 + dirty 1개였고, partialize가 isDirty를 전부 false로 만들었다)
    const tabs = ['dashboard', 'sourcing', 'listing', 'label', 'orders', 'plan', 'editor'].map(
      (id, i) => ({
        id,
        href: `/${id}`,
        label: id,
        lastActiveAt: 100 + i,
        isDirty: false,
      }),
    );
    localStorage.setItem(
      TAB_STORAGE_KEY,
      JSON.stringify({ state: { tabs, activeId: 'editor' }, version: 0 }),
    );

    useTabStore.persist.rehydrate();

    expect(useTabStore.getState().tabs).toHaveLength(6);
    expect(useTabStore.getState().tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(useTabStore.getState().activeId).toBe('editor');
  });
});
