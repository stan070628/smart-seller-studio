/**
 * useCachedFetch.test.ts
 * SWR 조회 훅 — 캐시 히트·미스 동작
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCachedFetch } from '@/hooks/useCachedFetch';
import { useCacheStore } from '@/store/useCacheStore';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [1, 2, 3] }) });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('캐시가 없을 때', () => {
  it('처음에는 isLoading이 참이다', () => {
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('응답이 오면 데이터를 준다', async () => {
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ items: [1, 2, 3] });
  });

  it('select로 필요한 부분만 꺼낸다', async () => {
    const { result } = renderHook(() =>
      useCachedFetch<number[]>('t:list', '/api/t', {
        select: (j) => (j as { items: number[] }).items,
      }),
    );

    await waitFor(() => expect(result.current.data).toEqual([1, 2, 3]));
  });
});

describe('캐시가 있을 때', () => {
  it('첫 렌더부터 데이터가 있고 isLoading은 거짓이다', () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ items: [9] });
  });

  it('캐시를 보여주면서 뒤에서 다시 불러온다', async () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.data).toEqual({ items: [9] });
    await waitFor(() => expect(result.current.data).toEqual({ items: [1, 2, 3] }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('enabled', () => {
  it('거짓이면 요청하지 않는다', () => {
    renderHook(() => useCachedFetch('t:list', '/api/t', { enabled: false }));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('HTTP 오류', () => {
  it('4xx면 응답 바디를 데이터로 캐시하지 않는다', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: '찾을 수 없습니다' }),
    });

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('찾을 수 없습니다'));
    expect(result.current.data).toBeUndefined();
  });

  it('5xx여도 이전에 성공한 데이터는 남는다', async () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: '서버 오류' }),
    });

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('서버 오류'));
    expect(result.current.data).toEqual({ items: [9] });
  });

  it('오류 바디에 error 필드가 없으면 상태 코드를 쓴다', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('요청이 실패했습니다 (503)'));
  });
});
