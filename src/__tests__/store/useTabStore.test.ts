/**
 * useTabStore.test.ts
 * 탭 열기·닫기·활성화 단위 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore } from '@/store/useTabStore';

beforeEach(() => {
  // persist 미들웨어가 붙은 뒤로 localStorage를 통한 파일 간 오염을 막는다
  localStorage.clear();
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
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useTabStore());
      act(() => result.current.openTab('/sourcing'));
      const first = result.current.tabs[0].lastActiveAt;

      vi.advanceTimersByTime(1000);
      act(() => result.current.openTab('/orders'));
      vi.advanceTimersByTime(1000);
      act(() => result.current.openTab('/sourcing'));

      const sourcing = result.current.tabs.find((t) => t.id === 'sourcing')!;
      expect(sourcing.lastActiveAt).toBeGreaterThan(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('하위 경로로 이동하면 탭은 그대로고 라벨만 바뀐다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/listing'));
    act(() => result.current.openTab('/listing/detail-maker'));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe('listing');
    expect(result.current.tabs[0].label).toBe('상품상세 자동만들기');
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

  it('첫 탭이 활성일 때 닫으면 오른쪽 탭이 활성화된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.openTab('/sourcing')); // 첫 탭(idx 0)을 다시 활성화
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.activeId).toBe('orders');
  });

  it('비활성 탭을 닫아도 활성 탭이 바뀌지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.activeId).toBe('orders');
  });
});

describe('setDirty', () => {
  it('편집 표시를 켜고 끈다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/editor'));

    act(() => result.current.setDirty('editor', true));
    expect(result.current.tabs[0].isDirty).toBe(true);

    act(() => result.current.setDirty('editor', false));
    expect(result.current.tabs[0].isDirty).toBe(false);
  });

  it('없는 탭에 호출해도 아무 일도 없다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/editor'));
    act(() => result.current.setDirty('nope', true));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].isDirty).toBe(false);
  });
});
