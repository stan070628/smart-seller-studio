'use client';

/**
 * useCachedFetch.ts
 * 캐시를 즉시 보여주고 뒤에서 갱신하는 조회 훅 (stale-while-revalidate)
 *
 * 기존 `useEffect` + `fetch` 패턴을 한 줄로 대체한다.
 * 응답 형태가 라우트마다 달라(`items`·`rows`·`data`) 훅은 JSON 전체를
 * 보관하고 호출 측이 `select`로 꺼낸다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** 서버가 error를 주지 않았을 때 쓸 문구. 화면별로 지정한다 */
  errorMessage?: string;
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

/**
 * select 없이 제네릭만 지정하면 컴파일은 통과하고 런타임에 터진다
 * (`data`는 실제로 `{items: T}` 같은 JSON 전체인데 `T`로 단정하게 되므로).
 * 오버로드로 "제네릭을 쓰려면 select도 함께"를 강제한다.
 */
export function useCachedFetch(
  key: string,
  url: string,
  options?: Pick<UseCachedFetchOptions<unknown>, 'enabled' | 'errorMessage'>,
): UseCachedFetchResult<unknown>;
export function useCachedFetch<T>(
  key: string,
  url: string,
  options: UseCachedFetchOptions<T> & { select: (json: unknown) => T },
): UseCachedFetchResult<T>;
export function useCachedFetch<T = unknown>(
  key: string,
  url: string,
  options: UseCachedFetchOptions<T> = {},
): UseCachedFetchResult<T> {
  const { enabled = true, select, errorMessage = '요청을 처리하지 못했습니다.' } = options;

  const entry = useCacheStore((s) => s.entries[key]);
  const setEntry = useCacheStore((s) => s.setEntry);
  const setError = useCacheStore((s) => s.setError);
  const [isRevalidating, setIsRevalidating] = useState(false);

  /**
   * 이 훅 인스턴스가 지금까지 시작한 요청의 세대 번호.
   * 응답이 와도 그 사이 더 새 요청이 떠났으면(주소 변경·refetch) 버린다 —
   * 그렇지 않으면 늦게 도착한 낡은 응답이 새 응답을 덮어쓸 수 있다.
   */
  const generation = useRef(0);

  const run = useCallback(
    async (force = false) => {
      const mine = ++generation.current;

      // 쓰기 직후의 refetch(force)는 진행 중인 요청에 합류하면 안 된다.
      // 그 요청은 쓰기 이전에 떠났으므로 낡은 결과를 준다.
      let promise = force ? undefined : inflight.get(url);
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
              throw new Error(message ?? `${errorMessage} (${res.status})`);
            }
            return res.json();
          })
          .finally(() => inflight.delete(url));
        inflight.set(url, promise);
      }

      try {
        const json = await promise;
        // 더 새로운 요청이 이미 떠났으면 이 응답은 버린다 —
        // 주소가 바뀌었거나(예: 페이지네이션) refetch가 겹친 경우다.
        if (mine !== generation.current) return;
        setEntry(key, json);
      } catch (e) {
        if (mine !== generation.current) return;
        setError(key, e instanceof Error ? e.message : errorMessage);
      }
    },
    [key, url, setEntry, setError, errorMessage],
  );

  const refetch = useCallback(() => run(true), [run]);

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
    fetchedAt: entry?.fetchedAt || null,
    refetch,
  };
}
