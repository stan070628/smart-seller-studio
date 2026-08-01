/**
 * useTabStore-eviction.test.ts
 * 탭 상한(6개)과 편집 중 탭 보호 단위 테스트
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore } from '@/store/useTabStore';

/** lastActiveAt이 겹치지 않도록 시간을 통제한다 */
let clock = 1_000;

beforeEach(() => {
  clock = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
  useTabStore.setState({ tabs: [], activeId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SEVEN = ['/dashboard', '/sourcing', '/listing', '/label', '/orders', '/plan', '/editor'];

describe('상한', () => {
  it('7번째를 열면 가장 오래된 탭이 밀려난다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs).toHaveLength(6);
    expect(result.current.tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(result.current.tabs.map((t) => t.id)).toContain('editor');
  });

  it('최근에 다시 본 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.slice(0, 6).forEach((href) => act(() => result.current.openTab(href)));
    act(() => result.current.openTab('/dashboard')); // 가장 오래된 것을 다시 봄
    act(() => result.current.openTab('/editor'));    // 7번째

    expect(result.current.tabs.map((t) => t.id)).toContain('dashboard');
    expect(result.current.tabs.map((t) => t.id)).not.toContain('sourcing');
  });

  it('방금 연 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.activeId).toBe('editor');
    expect(result.current.tabs.map((t) => t.id)).toContain('editor');
  });
});

describe('편집 보호', () => {
  it('편집 중인 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs.map((t) => t.id)).toContain('dashboard');
  });

  it('편집 중인 탭은 상한 계산에서 빠져 7개까지 열린다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs).toHaveLength(7);
  });

  it('편집이 끝나면 그때 상한을 다시 계산해 밀어낸다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));
    expect(result.current.tabs).toHaveLength(7);

    act(() => result.current.setDirty('dashboard', false));

    expect(result.current.tabs).toHaveLength(6);
    expect(result.current.tabs.map((t) => t.id)).not.toContain('dashboard');
  });
});
