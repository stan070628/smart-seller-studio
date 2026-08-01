/**
 * useCachedFetch-resilience.test.ts
 * 동시 요청 합치기와 실패 시 이전 데이터 유지
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCachedFetch } from '@/hooks/useCachedFetch';
import { useCacheStore } from '@/store/useCacheStore';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('동시 요청', () => {
  it('같은 주소를 동시에 부르면 한 번만 요청한다', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [1] }) });

    const a = renderHook(() => useCachedFetch('t:list', '/api/t'));
    const b = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(a.result.current.data).toBeDefined());
    await waitFor(() => expect(b.result.current.data).toBeDefined());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('실패', () => {
  it('실패해도 이전 데이터를 지우지 않는다', async () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    mockFetch.mockRejectedValue(new Error('네트워크 오류'));

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('네트워크 오류'));
    expect(result.current.data).toEqual({ items: [9] });
  });

  it('캐시가 없이 실패하면 로딩이 끝나고 오류만 남는다', async () => {
    mockFetch.mockRejectedValue(new Error('실패'));

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('실패'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('다시 성공하면 오류가 사라진다', async () => {
    mockFetch.mockRejectedValueOnce(new Error('실패'));
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));
    await waitFor(() => expect(result.current.error).toBe('실패'));

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [7] }) });
    await result.current.refetch();

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data).toEqual({ items: [7] });
  });
});
