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

/**
 * 모듈 스코프 구독 핸들.
 * AppShell은 라우트마다 재마운트되므로, 컴포넌트 스코프에 두면
 * 재마운트 순서에 따라 구독 해제/재구독 사이에 틈이 생긴다.
 * 모듈 스코프에 한 번만 만들어 그 틈 자체를 없앤다.
 */
let unsubscribe: (() => void) | null = null;

/**
 * 구독을 시작하고 해제 함수를 돌려준다.
 * 이미 구독 중이면 기존 것을 그대로 준다 — AppShell이 라우트마다
 * 재마운트되므로 멱등해야 한다. 여러 번 불러도 구독은 하나만 생긴다.
 */
export function startTabCacheBridge(): () => void {
  if (unsubscribe) return unsubscribe;

  const stop = useTabStore.subscribe((state, prev) => {
    const now = new Set(state.tabs.map((t) => t.id));
    const gone = prev.tabs.map((t) => t.id).filter((id) => !now.has(id));

    for (const id of gone) {
      useCacheStore.getState().invalidate(`${id}:*`);
    }
  });

  unsubscribe = () => {
    stop();
    // 다음 startTabCacheBridge() 호출이 새로 구독할 수 있도록 되돌린다.
    // 없으면 해제 후 재시작한 테스트/세션이 죽은 구독을 계속 재사용하게 된다.
    unsubscribe = null;
  };

  return unsubscribe;
}
