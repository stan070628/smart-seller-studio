/**
 * useTabStore-persist.test.ts
 * 탭 목록의 localStorage 영속 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore, TAB_STORAGE_KEY, tabPersistOptions } from '@/store/useTabStore';

beforeEach(() => {
  // 테스트 간 오염을 막는다.
  // useTabStore.setState는 persist가 오버라이드하므로 아래 setState 자체도
  // localStorage에 저장된다 — clear를 먼저 해야 이전 테스트의 잔여물이 안 남는다.
  localStorage.clear();
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('영속', () => {
  it('탭을 열면 localStorage에 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing?tab=discovery&page=3'));

    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    expect(JSON.parse(raw!).state.tabs[0].href).toBe('/sourcing?tab=discovery&page=3');
  });

  it('활성 탭도 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/orders'));

    expect(JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)!).state.activeId).toBe('orders');
  });

  it('isDirty는 false로 저장한다 — 재시작 후 편집 상태가 남으면 안 된다', () => {
    const saved = tabPersistOptions.partialize!({
      ...useTabStore.getState(),
      tabs: [{ id: 'editor', href: '/editor', label: '에디터', lastActiveAt: 1, isDirty: true }],
    });

    expect(saved.tabs[0].isDirty).toBe(false);
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

    const merged = tabPersistOptions.merge!({ tabs, activeId: 'editor' }, useTabStore.getState());

    expect(merged.tabs).toHaveLength(6);
    expect(merged.tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(merged.activeId).toBe('editor');
  });

  it('저장값의 형태가 깨졌으면 복원을 포기하고 빈 상태로 시작한다', () => {
    const current = useTabStore.getState();

    expect(tabPersistOptions.merge!({ tabs: 'oops' }, current).tabs).toEqual([]);
    expect(tabPersistOptions.merge!({ tabs: [1, 2, 3] }, current).tabs).toEqual([]);
    expect(tabPersistOptions.merge!(undefined, current).tabs).toEqual([]);
  });

  it('활성 탭이 복원된 목록에 없으면 활성 탭을 비운다', () => {
    const merged = tabPersistOptions.merge!({ tabs: [], activeId: 'ghost' }, useTabStore.getState());

    expect(merged.activeId).toBeNull();
  });

  it('배선 검증: 손상된 저장값으로 실제 rehydrate를 태워도 스토어가 무너지지 않는다', () => {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify({ state: { tabs: 'oops' }, version: 0 }));

    useTabStore.persist.rehydrate();

    expect(useTabStore.getState().tabs).toEqual([]);
  });
});

describe('저장 실패 방어', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('localStorage.setItem이 던져도 openTab은 그대로 화면을 이동시킨다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError: 사파리 프라이빗 모드 시뮬레이션');
    });

    const { result } = renderHook(() => useTabStore());

    expect(() => act(() => result.current.openTab('/orders'))).not.toThrow();
    expect(result.current.tabs[0].href).toBe('/orders');
    expect(result.current.activeId).toBe('orders');
  });
});
