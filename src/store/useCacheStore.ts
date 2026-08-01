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
 * 패턴이 `:*`로 끝나면 콜론까지 포함한 접두사 일치를,
 * 아니면 완전 일치를 확인한다.
 *
 * 콜론을 접두사에 포함시키는 이유: `'orders:*'`가 `'ordersXYZ:list'`처럼
 * 라우트 이름이 우연히 겹치는 다른 키까지 지우면 안 되기 때문이다.
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
            const scroll = Object.fromEntries(
              Object.entries(s.scroll).filter(([k]) => k !== route),
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
