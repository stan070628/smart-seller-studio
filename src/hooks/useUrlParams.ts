'use client';

/**
 * useUrlParams.ts
 * 스칼라(문자열·숫자·불리언) 상태를 URL 쿼리 파라미터로 관리하는 훅 모음
 *
 * 값은 항상 URL(useSearchParams)에서 직접 읽는다 — 별도 React state로
 * 복제하지 않는다. ListingDashboard의 step 버그(URL→상태는 반영하면서
 * 상태→URL 갱신은 빼먹어 탭 주소가 옛 값으로 굳는 문제,
 * ListingDashboard.tsx:2201-2206 참고)처럼 상태와 URL이 따로 놀 여지 자체를
 * 없앤다. 원본이 하나면 항상 같다.
 *
 * 탭 바가 주소를 통째로 기억하므로, 다른 탭에 갔다 이 탭으로 돌아오면
 * 컴포넌트가 다시 마운트돼도 URL에서 값이 그대로 복원된다.
 *
 * Set·객체 같은 비스칼라 상태는 여기 넣지 마라 — useTabUiState를 써라.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type UrlParamDefaults = Record<string, string>;

export interface UrlParamsApi {
  /** 현재 값. 파라미터가 없으면 defaults[key]를 돌려준다 */
  get(key: string): string;
  /**
   * 여러 파라미터를 한 번의 router.replace로 함께 갱신한다.
   * 개별 훅을 같은 틱에 여러 번 호출하면 각자 옛 searchParams를 기준으로
   * 계산해 서로를 덮어쓸 수 있다 — 한 번에 묶어 쓰면 그 문제가 없다.
   * updates에 없는 키는 건드리지 않는다.
   * 값이 기본값과 같아지면 파라미터를 아예 지운다(주소가 길어지지 않게).
   */
  set(updates: Record<string, string>): void;
}

/**
 * 여러 URL 파라미터를 한 묶음으로 다루는 저수준 훅.
 * preset·from·to처럼 "하나를 바꾸면 나머지도 같이 정리해야 하는" 필드들에 쓴다.
 */
export function useUrlParams(defaults: UrlParamDefaults): UrlParamsApi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback(
    (key: string) => searchParams.get(key) ?? defaults[key] ?? '',
    // defaults는 호출부에서 매 렌더 새 객체로 넘어오는 경우가 많다.
    // 값 비교는 JSON으로 충분히 안정적이라 참조 대신 문자열로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, JSON.stringify(defaults)],
  );

  const set = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === (defaults[key] ?? '')) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, JSON.stringify(defaults), pathname, router],
  );

  return { get, set };
}

/**
 * 파라미터 하나만 쓸 때의 편의 버전. `useUrlParams({[key]: defaultValue})`와 같다.
 */
export function useUrlParam(key: string, defaultValue: string): [string, (value: string) => void] {
  const { get, set } = useUrlParams({ [key]: defaultValue });
  const value = get(key);
  const setValue = useCallback((next: string) => set({ [key]: next }), [set, key]);
  return [value, setValue];
}

/**
 * 불리언 전용 변형. '1'/'0'으로 인코딩하고, 기본값과 같으면 파라미터를 지운다.
 */
export function useUrlFlag(key: string, defaultValue = false): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useUrlParam(key, '');
  const value = raw === '' ? defaultValue : raw === '1';

  const setValue = useCallback(
    (next: boolean) => setRaw(next === defaultValue ? '' : next ? '1' : '0'),
    [setRaw, defaultValue],
  );

  return [value, setValue];
}

/**
 * 검색어처럼 "타이핑마다 주소가 바뀌면 안 되는" 값을 위한 변형.
 * 화면에 보이는 값은 로컬 state로 즉시 반영해 필터링에 바로 쓰고,
 * URL 반영(주소 갱신)만 debounceMs 뒤로 미룬다.
 * 뒤로가기 등으로 URL이 바깥에서 바뀌면 로컬 값도 따라간다(양방향 동기화).
 */
export function useDebouncedUrlParam(
  key: string,
  defaultValue: string,
  debounceMs = 400,
): [string, (value: string) => void] {
  const [urlValue, setUrlValue] = useUrlParam(key, defaultValue);
  const [local, setLocal] = useState(urlValue);

  useEffect(() => {
    setLocal(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (local === urlValue) return;
    const t = setTimeout(() => setUrlValue(local), debounceMs);
    return () => clearTimeout(t);
  }, [local, urlValue, debounceMs, setUrlValue]);

  return [local, setLocal];
}
