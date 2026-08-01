'use client';

/**
 * useCachedFetch.ts
 * 캐시를 즉시 보여주고 뒤에서 갱신하는 조회 훅 (stale-while-revalidate)
 *
 * 기존 `useEffect` + `fetch` 패턴을 한 줄로 대체한다.
 * 응답 형태가 라우트마다 달라(`items`·`rows`·`data`) 훅은 JSON 전체를
 * 보관하고 호출 측이 `select`로 꺼낸다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCacheStore } from '@/store/useCacheStore';

/**
 * 진행 중인 요청 목록. 같은 주소를 동시에 부르면 하나로 합친다.
 * 키는 캐시 키가 아니라 **요청 주소**다 — 같은 주소를 다른 캐시 키로
 * 쓰는 화면이 있어도 네트워크 요청은 한 번이면 된다.
 */
const inflight = new Map<string, Promise<unknown>>();

export interface UseCachedFetchOptions<T> {
  /** false면 요청하지 않는다. 조건부 조회에 쓴다 */
  enabled?: boolean;
  /** 응답 JSON에서 필요한 부분을 꺼낸다 */
  select?: (json: unknown) => T;
}

export interface UseCachedFetchResult<T> {
  data: T | undefined;
  /** 캐시가 없어 처음 불러오는 중 */
  isLoading: boolean;
  /** 캐시를 보여주면서 뒤에서 갱신 중 */
  isRevalidating: boolean;
  error: string | null;
  fetchedAt: number | null;
  refetch: () => Promise<void>;
}

export function useCachedFetch<T = unknown>(
  key: string,
  url: string,
  options: UseCachedFetchOptions<T> = {},
): UseCachedFetchResult<T> {
  const { enabled = true, select } = options;

  const entry = useCacheStore((s) => s.entries[key]);
  const setEntry = useCacheStore((s) => s.setEntry);
  const setError = useCacheStore((s) => s.setError);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const run = useCallback(async () => {
    let promise = inflight.get(url);
    if (!promise) {
      promise = fetch(url)
        .then(async (res) => {
          // fetch는 4xx·5xx에서 reject하지 않는다.
          // 여기서 걸러내지 않으면 오류 응답이 정상 데이터로 캐시된다.
          //
          // 상태를 먼저 본다. 프록시나 Next의 오류 페이지는 HTML을 주므로
          // json()을 먼저 부르면 파싱 오류가 나서 상태 코드를 잃는다.
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const message = (body as { error?: string } | null)?.error;
            throw new Error(message ?? `요청이 실패했습니다 (${res.status})`);
          }
          return res.json();
        })
        .finally(() => inflight.delete(url));
      inflight.set(url, promise);
    }

    try {
      setEntry(key, await promise);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : '요청에 실패했습니다.');
    }
  }, [key, url, setEntry, setError]);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    const hadCache = useCacheStore.getState().entries[key] !== undefined;
    if (hadCache) setIsRevalidating(true);

    void run().finally(() => {
      if (alive) setIsRevalidating(false);
    });

    return () => {
      alive = false;
    };
  }, [key, url, enabled, run]);

  const data = useMemo(() => {
    if (entry?.data === undefined) return undefined;
    return select ? select(entry.data) : (entry.data as T);
    // select는 호출 측에서 매 렌더 새로 만들어지므로 의존성에서 뺀다.
    // 그래서 select는 순수해야 한다 — 외부 상태를 클로저로 잡으면 결과가 낡은 채로 남는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.data]);

  return {
    data,
    isLoading: entry === undefined && enabled,
    isRevalidating,
    error: entry?.error ?? null,
    fetchedAt: entry?.fetchedAt ?? null,
    refetch: run,
  };
}
