/**
 * useTabStore.test.ts
 * 탭 열기·닫기·활성화 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore } from '@/store/useTabStore';

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('openTab', () => {
  it('없던 탭을 만들고 활성화한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe('sourcing');
    expect(result.current.tabs[0].label).toBe('소싱');
    expect(result.current.activeId).toBe('sourcing');
  });

  it('같은 라우트를 다시 열면 새 탭을 만들지 않고 href를 갱신한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/sourcing?tab=discovery&page=3'));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].href).toBe('/sourcing?tab=discovery&page=3');
  });

  it('다시 열면 lastActiveAt이 커진다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    const first = result.current.tabs[0].lastActiveAt;

    act(() => result.current.openTab('/orders'));
    act(() => result.current.openTab('/sourcing'));

    const sourcing = result.current.tabs.find((t) => t.id === 'sourcing')!;
    expect(sourcing.lastActiveAt).toBeGreaterThanOrEqual(first);
  });
});

describe('closeTab', () => {
  it('탭을 제거한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.tabs.map((t) => t.id)).toEqual(['orders']);
  });

  it('활성 탭을 닫으면 바로 왼쪽 탭이 활성화된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.openTab('/plan'));
    act(() => result.current.closeTab('orders'));
    act(() => result.current.closeTab('plan'));

    expect(result.current.activeId).toBe('sourcing');
  });

  it('마지막 탭을 닫으면 활성 탭이 없다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });

  it('없는 탭을 닫아도 아무 일도 없다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.closeTab('nope'));

    expect(result.current.tabs).toHaveLength(1);
  });
});
