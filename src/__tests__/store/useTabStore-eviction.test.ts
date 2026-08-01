/**
 * useTabStore-eviction.test.ts
 * 탭 상한(6개)과 편집 중 탭 보호 단위 테스트
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore, MAX_TABS } from '@/store/useTabStore';

/** lastActiveAt이 겹치지 않도록 시간을 통제한다 */
let clock = 1_000;

beforeEach(() => {
  clock = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
  // persist 미들웨어가 붙은 뒤로 setState도 localStorage에 저장되므로,
  // 테스트 간 오염을 막기 위해 매번 비운다 (vitest는 파일마다 jsdom을 새로 주므로 파일 간 오염은 없다)
  localStorage.clear();
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

    expect(result.current.tabs).toHaveLength(MAX_TABS);
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

  it('방금 연 탭이 가장 오래된 시각을 갖더라도 밀려나지 않는다', () => {
    // 기존 6탭에 아주 큰 시각을 심어, 새로 여는 탭이 LRU 최하위가 되게 만든다
    const ids = ['dashboard', 'sourcing', 'listing', 'label', 'orders', 'plan'];
    useTabStore.setState({
      tabs: ids.map((id) => ({
        id,
        href: `/${id}`,
        label: id,
        lastActiveAt: 999_999,
        isDirty: false,
      })),
      activeId: 'dashboard',
    });

    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/editor'));

    expect(result.current.tabs).toHaveLength(MAX_TABS);
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

  it('편집이 끝나면 상한을 다시 계산하되 방금 끝낸 탭은 지킨다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));
    expect(result.current.tabs).toHaveLength(7);

    act(() => result.current.setDirty('dashboard', false));

    expect(result.current.tabs).toHaveLength(MAX_TABS);
    expect(result.current.tabs.map((t) => t.id)).toContain('dashboard');
    expect(result.current.tabs.map((t) => t.id)).not.toContain('sourcing');
  });

  it('없는 탭에 setDirty를 불러도 초과 상태의 탭이 사라지지 않는다', () => {
    const ids = ['dashboard', 'sourcing', 'listing', 'label', 'orders', 'plan', 'editor'];
    useTabStore.setState({
      tabs: ids.map((id, i) => ({
        id,
        href: `/${id}`,
        label: id,
        lastActiveAt: 100 + i,
        isDirty: false,
      })),
      activeId: 'editor',
    });

    const { result } = renderHook(() => useTabStore());
    act(() => result.current.setDirty('없는탭', false));

    expect(result.current.tabs).toHaveLength(7);
  });
});
