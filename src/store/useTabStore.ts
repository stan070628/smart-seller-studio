/**
 * useTabStore.ts
 * 상단 탭 내비게이션 상태
 *
 * 탭 1개 = 라우트 1개다. 같은 라우트를 다른 쿼리로 열면
 * 새 탭이 아니라 기존 탭의 href를 갱신한다.
 */

import { create } from 'zustand';
import { createJSONStorage, devtools, persist, type PersistOptions } from 'zustand/middleware';
import { labelForHref, routeIdOf } from '@/lib/nav-items';
import type { Tab } from '@/types/tab';

/** isDirty가 아닌 탭의 최대 개수 */
export const MAX_TABS = 6;

/** localStorage 키. 이 코드베이스의 다른 sss_* 키와 맞춰 밑줄을 쓴다 */
export const TAB_STORAGE_KEY = 'sss_tabs';

/**
 * 상한을 넘으면 오래된 탭부터 제거한다.
 * isDirty 탭은 상한 계산과 밀어내기 양쪽에서 빠진다.
 * protect 탭은 상한 계산에는 들어가지만 희생자가 되지는 않는다.
 */
function evict(tabs: Tab[], protect: readonly (string | null)[]): Tab[] {
  // 총 개수가 상한 이내면 dirty를 세어볼 필요도 없다
  if (tabs.length <= MAX_TABS) return tabs;

  const counted = tabs.filter((t) => !t.isDirty);
  const overflow = counted.length - MAX_TABS;
  if (overflow <= 0) return tabs;

  const victims = new Set(
    counted
      .filter((t) => !protect.includes(t.id))
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, overflow)
      .map((t) => t.id),
  );

  return tabs.filter((t) => !victims.has(t.id));
}

export interface TabState {
  tabs: Tab[];
  activeId: string | null;
  /** 화면 진입 시 호출. 없으면 생성, 있으면 href 갱신 후 활성화 */
  openTab(href: string): void;
  closeTab(id: string): void;
  setDirty(id: string, dirty: boolean): void;
}

/** localStorage에 저장하는 부분. 액션은 저장하지 않는다 */
export type PersistedTabState = Pick<TabState, 'tabs' | 'activeId'>;

/** 저장값이 Tab 배열의 모양인지 확인한다. 아니면 복원을 포기한다. */
function isTabArray(value: unknown): value is Tab[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        t !== null &&
        typeof t === 'object' &&
        typeof (t as Tab).id === 'string' &&
        typeof (t as Tab).href === 'string' &&
        typeof (t as Tab).label === 'string' &&
        typeof (t as Tab).lastActiveAt === 'number' &&
        typeof (t as Tab).isDirty === 'boolean',
    )
  );
}

/**
 * persist 설정.
 * partialize와 merge는 한 쌍이다 — partialize가 isDirty를 씻어 상한을 깨뜨리고,
 * merge가 복원 시점에 evict로 되돌린다. 한쪽만 바꾸면 상한이 조용히 무너진다.
 */
export const tabPersistOptions: PersistOptions<TabState, PersistedTabState> = {
  name: TAB_STORAGE_KEY,
  // 탭 저장은 최선 노력이다. 저장이 막혀도 화면 이동은 막히면 안 된다.
  // zustand는 setItem의 throw를 액션 호출자까지 전파하므로 여기서 삼킨다.
  storage: createJSONStorage(() => ({
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value);
      } catch {
        // 사파리 쿠키 차단·프라이빗 모드·용량 초과. 이번 세션은 저장 없이 동작한다
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  })),
  // 편집 상태는 세션을 넘기지 않는다
  partialize: (s) => ({
    tabs: s.tabs.map((t) => ({ ...t, isDirty: false })),
    activeId: s.activeId,
  }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<PersistedTabState> | undefined;
    if (!saved || !isTabArray(saved.tabs)) return current;

    // 복원 시점에 상한을 다시 적용한다.
    // 저장 당시 isDirty였던 탭이 false로 풀려 초과 상태로 들어올 수 있다.
    const tabs = evict(saved.tabs, [saved.activeId ?? null]);
    const activeId = tabs.some((t) => t.id === saved.activeId) ? saved.activeId! : null;

    return { ...current, tabs, activeId };
  },
};

export const useTabStore = create<TabState>()(
  devtools(
    persist(
      (set, get) => ({
        tabs: [],
        activeId: null,

        openTab: (href) => {
          const id = routeIdOf(href);
          const label = labelForHref(href);
          const now = Date.now();
          const { tabs, activeId } = get();
          const current = tabs.find((t) => t.id === id);

          // 이미 활성인 탭을 같은 주소로 다시 열면 아무것도 바꾸지 않는다.
          // 불필요한 배열 재생성으로 구독자가 다시 렌더되는 것을 막는다.
          if (current && current.href === href && current.label === label && activeId === id) return;

          const next = current
            ? tabs.map((t) => (t.id === id ? { ...t, href, label, lastActiveAt: now } : t))
            : [...tabs, { id, href, label, lastActiveAt: now, isDirty: false }];

          set({ tabs: evict(next, [id]), activeId: id }, false, 'tab/openTab');
        },

        closeTab: (id) => {
          const { tabs, activeId } = get();
          const idx = tabs.findIndex((t) => t.id === id);
          if (idx === -1) return;

          const next = tabs.filter((t) => t.id !== id);
          // idx는 삭제 전 배열 기준, next는 삭제 후 배열이다.
          // idx>=1 이면 next[idx-1]은 원래의 왼쪽 이웃과 같고,
          // idx===0 이면 클램프되어 next[0] = 원래의 오른쪽 이웃이 된다.
          const nextActive =
            activeId === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : activeId;

          set({ tabs: next, activeId: nextActive }, false, 'tab/closeTab');
        },

        setDirty: (id, dirty) => {
          const { tabs, activeId } = get();
          const target = tabs.find((t) => t.id === id);
          // 없는 탭이거나 이미 같은 값이면 아무것도 바꾸지 않는다.
          // 상태를 안 바꾸는 호출이 밀어내기를 유발해선 안 된다.
          if (!target || target.isDirty === dirty) return;

          const next = tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t));
          set({ tabs: dirty ? next : evict(next, [activeId, id]) }, false, 'tab/setDirty');
        },
      }),
      tabPersistOptions,
    ),
    { name: 'TabStore' },
  ),
);
