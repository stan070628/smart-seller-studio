/**
 * useTabStore.ts
 * 상단 탭 내비게이션 상태
 *
 * 탭 1개 = 라우트 1개다. 같은 라우트를 다른 쿼리로 열면
 * 새 탭이 아니라 기존 탭의 href를 갱신한다.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { labelForHref, routeIdOf } from '@/lib/nav-items';
import type { Tab } from '@/types/tab';

export interface TabState {
  tabs: Tab[];
  activeId: string | null;
  /** 화면 진입 시 호출. 없으면 생성, 있으면 href 갱신 후 활성화 */
  openTab(href: string): void;
  closeTab(id: string): void;
  touchTab(id: string): void;
  setDirty(id: string, dirty: boolean): void;
}

export const useTabStore = create<TabState>()(
  devtools(
    (set, get) => ({
      tabs: [],
      activeId: null,

      openTab: (href) => {
        const id = routeIdOf(href);
        const label = labelForHref(href);
        const now = Date.now();
        const { tabs } = get();
        const exists = tabs.some((t) => t.id === id);

        const next = exists
          ? tabs.map((t) => (t.id === id ? { ...t, href, label, lastActiveAt: now } : t))
          : [...tabs, { id, href, label, lastActiveAt: now, isDirty: false }];

        set({ tabs: next, activeId: id }, false, 'tab/openTab');
      },

      closeTab: (id) => {
        const { tabs, activeId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx === -1) return;

        const next = tabs.filter((t) => t.id !== id);
        const nextActive =
          activeId === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : activeId;

        set({ tabs: next, activeId: nextActive }, false, 'tab/closeTab');
      },

      touchTab: (id) => {
        set(
          (s) => ({
            tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t)),
            activeId: id,
          }),
          false,
          'tab/touchTab',
        );
      },

      setDirty: (id, dirty) => {
        set(
          (s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t)) }),
          false,
          'tab/setDirty',
        );
      },
    }),
    { name: 'TabStore' },
  ),
);
