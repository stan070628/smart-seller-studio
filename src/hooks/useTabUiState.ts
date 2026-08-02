'use client';

/**
 * useTabUiState.ts
 * 탭이 리마운트돼도(다른 탭 갔다 복귀) 살아남는 UI 상태 훅
 *
 * 펼침 목록(Set) · 선택 항목 같은 비스칼라 상태에 쓴다.
 * 스칼라(문자열·숫자·불리언)는 URL 쿼리(useUrlParams)를 써라 — 여기 넣으면
 * 새로고침 시 그냥 사라지고, 공유·북마크도 안 된다.
 *
 * useCacheStore의 `ui` 네임스페이스에 저장한다. `entries`(데이터 캐시)와는
 * 별도 키 공간이라 `invalidate('orders:*')`로 데이터를 새로고침해도
 * 펼침 상태는 지워지지 않는다. 탭을 완전히 닫을 때만
 * tab-cache-bridge가 이 상태도 함께 지운다.
 *
 * 값을 로컬 useState로 복제하지 않고 useSyncExternalStore로 스토어를 직접 구독한다.
 * 원래는 "지연 초기화 없이 마운트 후 useEffect에서 한 번 복원"하는 방식을 썼지만
 * (계산기 작업 82de74fe에서 지연 초기화가 하이드레이션을 깬 적이 있어서),
 * 이 프로젝트의 react-hooks 린트가 "effect 안에서의 setState"를 금지한다
 * (cascading render 경고). useSyncExternalStore는 getServerSnapshot으로 서버·첫
 * 클라이언트 렌더를 defaultValue로 고정하면서도 effect 없이 스토어와 동기화되므로,
 * 같은 목표(하이드레이션 불일치 없음)를 effect 없이 달성한다.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { routeIdOf } from '@/lib/nav-items';
import { useCacheStore } from '@/store/useCacheStore';

/**
 * @param subKey  라우트 안에서 이 상태를 구분하는 이름 (예: 'cost:expandedGroups').
 *                실제 저장 키는 `${routeIdOf(현재경로)}:${subKey}`다 — 탭이
 *                닫힐 때 캐시 브리지가 지우는 접두사(`${라우트}:*`)와 맞추기 위해서다.
 * @param defaultValue  초기값. 매 렌더 새 인스턴스(예: `new Set()`)를 넘기면
 *                       getSnapshot이 매번 다른 참조를 돌려줘 불필요한 리렌더가
 *                       생길 수 있다 — 호출부에서 모듈 스코프 상수나 useMemo로 고정해 넘겨라.
 */
export function useTabUiState<T>(
  subKey: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const pathname = usePathname();
  const key = `${routeIdOf(pathname ?? '')}:${subKey}`;

  const subscribe = useCallback(
    (onStoreChange: () => void) => useCacheStore.subscribe(onStoreChange),
    [],
  );
  const getSnapshot = useCallback(() => {
    const stored = useCacheStore.getState().ui[key];
    return stored !== undefined ? (stored as T) : defaultValue;
  }, [key, defaultValue]);
  // 서버(및 하이드레이션 이전 첫 클라이언트 렌더)에서는 스토어 내용을 알 수 없으니
  // 항상 defaultValue다. 그래야 서버 마크업과 클라이언트 첫 렌더가 일치한다.
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const stored = useCacheStore.getState().ui[key];
      const prev = stored !== undefined ? (stored as T) : defaultValue;
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      useCacheStore.getState().setUi(key, resolved);
    },
    [key, defaultValue],
  );

  return [value, update];
}
