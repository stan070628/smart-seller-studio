/**
 * useCacheStore.ts
 * 화면별 응답과 스크롤 위치를 담는 메모리 캐시
 *
 * 키 규칙은 `<라우트>:<세부>`다. 접두사가 라우트와 일치해야
 * 탭이 닫힐 때 일괄 해제할 수 있다.
 *
 * 영속하지 않는다 — 새로고침하면 비고, 탭 목록만 남는다.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface CacheEntry {
  data: unknown;
  fetchedAt: number;
  error: string | null;
}

export interface CacheState {
  entries: Record<string, CacheEntry>;
  scroll: Record<string, number>;
  setEntry(key: string, data: unknown): void;
  setError(key: string, error: string): void;
  /** 정확한 키 또는 `orders:*` 형태의 접두사 패턴 */
  invalidate(pattern: string): void;
  setScroll(key: string, y: number): void;
}

/**
 * 키가 패턴에 걸리는지 본다.
 * `orders:*` 형태만 접두사 패턴으로 인정한다 — `orders*`나 `*` 같은
 * 비규격 패턴은 아무것도 지우지 않는다.
 */
function matches(key: string, pattern: string): boolean {
  if (pattern.endsWith(':*')) return key.startsWith(pattern.slice(0, -1));
  return key === pattern;
}

export const useCacheStore = create<CacheState>()(
  devtools(
    (set) => ({
      entries: {},
      scroll: {},

      setEntry: (key, data) =>
        set(
          (s) => ({
            entries: { ...s.entries, [key]: { data, fetchedAt: Date.now(), error: null } },
          }),
          false,
          'cache/setEntry',
        ),

      setError: (key, error) =>
        set(
          (s) => {
            const prev = s.entries[key];
            return {
              entries: {
                ...s.entries,
                // 이전 엔트리가 없으면 data는 undefined다 — CacheEntry.data가 unknown
                // 타입이라 undefined도 유효한 값이며, entries[key] 자체는 존재하게 된다.
                [key]: { data: prev?.data, fetchedAt: prev?.fetchedAt ?? 0, error },
              },
            };
          },
          false,
          'cache/setError',
        ),

      invalidate: (pattern) =>
        set(
          (s) => {
            const entries = Object.fromEntries(
              Object.entries(s.entries).filter(([k]) => !matches(k, pattern)),
            );

            // `orders:*` 형태일 때만 같은 라우트의 스크롤 위치도 함께 버린다.
            // 'orders'나 '*' 같은 다른 패턴은 스크롤에 손대지 않는다.
            if (!pattern.endsWith(':*')) return { entries };

            const route = pattern.slice(0, -2);
            // 스크롤 컨테이너가 여럿인 화면은 `orders#list`처럼 `#` 뒤에 세부를
            // 붙인다 (설계 문서). 라우트 자체와 그 하위 컨테이너를 모두 지운다.
            const scroll = Object.fromEntries(
              Object.entries(s.scroll).filter(
                ([k]) => k !== route && !k.startsWith(`${route}#`),
              ),
            );
            return { entries, scroll };
          },
          false,
          'cache/invalidate',
        ),

      setScroll: (key, y) =>
        set((s) => ({ scroll: { ...s.scroll, [key]: y } }), false, 'cache/setScroll'),
    }),
    { name: 'CacheStore' },
  ),
);
