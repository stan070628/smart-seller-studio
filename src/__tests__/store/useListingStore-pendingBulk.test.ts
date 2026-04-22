/**
 * useListingStore-pendingBulk.test.ts
 * pendingBulkItems 액션 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListingStore } from '@/store/useListingStore';

function resetStore() {
  useListingStore.setState({ pendingBulkItems: [] });
}

describe('useListingStore — pendingBulkItems', () => {
  beforeEach(resetStore);

  it('addPendingBulkItems: 새 번호를 추가하고 추가된 수를 반환한다', () => {
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '87654321']);
    });
    expect(added!).toBe(2);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '87654321']);
  });

  it('addPendingBulkItems: 같은 호출 내 중복은 한 번만 추가된다', () => {
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '12345678', '87654321']);
    });
    expect(added!).toBe(2);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '87654321']);
  });

  it('addPendingBulkItems: 기존 상태에 있는 번호는 추가하지 않는다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678'] });
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '99991111']);
    });
    expect(added!).toBe(1);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '99991111']);
  });

  it('addPendingBulkItems: 전부 중복이면 0을 반환하고 상태가 변하지 않는다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678'] });
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678']);
    });
    expect(added!).toBe(0);
    expect(result.current.pendingBulkItems).toEqual(['12345678']);
  });

  it('clearPendingBulkItems: 목록을 비운다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678', '87654321'] });
    const { result } = renderHook(() => useListingStore());
    act(() => {
      result.current.clearPendingBulkItems();
    });
    expect(result.current.pendingBulkItems).toEqual([]);
  });
});
