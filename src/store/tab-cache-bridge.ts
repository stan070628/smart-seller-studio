/**
 * tab-cache-bridge.ts
 * 탭 스토어와 캐시 스토어를 잇는 유일한 지점
 *
 * 탭이 사라지면(수동 닫기·LRU 밀어내기 모두) 그 라우트 접두사의
 * 캐시를 해제해 메모리를 회수한다.
 *
 * 두 스토어는 서로를 import하지 않는다. 결합은 여기 한 곳뿐이다.
 */

import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';

/** 구독을 시작하고, 해제 함수를 돌려준다 */
export function startTabCacheBridge(): () => void {
  return useTabStore.subscribe((state, prev) => {
    const now = new Set(state.tabs.map((t) => t.id));
    const gone = prev.tabs.map((t) => t.id).filter((id) => !now.has(id));

    for (const id of gone) {
      useCacheStore.getState().invalidate(`${id}:*`);
    }
  });
}
