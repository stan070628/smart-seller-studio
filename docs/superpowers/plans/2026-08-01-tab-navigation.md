# 탭 내비게이션 + 화면 상태 캐시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상단 탭 바로 열어둔 화면을 오가고, 탭으로 돌아왔을 때 API 재호출 없이 이전 모습을 즉시 복원한다.

**Architecture:** zustand 스토어 두 개를 둔다. `useTabStore`는 탭 목록을 `localStorage`에 영속하고, `useCacheStore`는 키별 응답을 메모리에 담는다. 화면은 `useCachedFetch` 훅으로 기존 `useEffect`+`fetch`를 한 줄 치환한다. 탭이 닫히면 브리지 모듈이 해당 라우트 접두사의 캐시를 해제한다. **라우팅 구조는 변경하지 않는다.**

**Tech Stack:** Next.js 16 (App Router), React 19, zustand 5 (+ `persist`·`devtools` 미들웨어), vitest + @testing-library/react, Playwright

**설계 문서:** `docs/superpowers/specs/2026-08-01-tab-navigation-design.md`

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `src/lib/nav-items.tsx` | 생성 | `NAV_ITEMS` 정의 + `routeIdOf`·`labelForHref` |
| `src/types/tab.ts` | 생성 | `Tab` 타입 |
| `src/store/useTabStore.ts` | 생성 | 탭 목록·활성 탭·LRU·영속 |
| `src/store/useCacheStore.ts` | 생성 | 키별 데이터·스크롤 위치 |
| `src/store/tab-cache-bridge.ts` | 생성 | 탭 소멸 감지 → 캐시 해제 |
| `src/hooks/useCachedFetch.ts` | 생성 | SWR 조회 훅 |
| `src/components/TabBar.tsx` | 생성 | 탭 바 렌더링 |
| `src/components/AppShell.tsx` | 수정 | `NAV_ITEMS` 제거, `TabBar` 삽입, 주소 구독 |
| `src/components/sourcing/ShortlistTab.tsx` | 수정 | 첫 캐시 적용 대상 |

테스트는 기존 관례대로 `src/__tests__/` 아래 같은 구조로 둔다.

---

## Task 1: 내비게이션 항목 분리

`NAV_ITEMS`가 `AppShell.tsx` 안에 있어 `TabBar`가 쓸 수 없다. 별도 모듈로 옮기고 라벨 유도 함수를 붙인다.

**Files:**
- Create: `src/lib/nav-items.tsx`
- Create: `src/types/tab.ts`
- Modify: `src/components/AppShell.tsx:9-95` (타입·`NAV_ITEMS` 제거 후 import)
- Test: `src/__tests__/lib/nav-items.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * nav-items.test.ts
 * 경로에서 탭 식별자와 라벨을 유도하는 함수 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { routeIdOf, labelForHref } from '@/lib/nav-items';

describe('routeIdOf', () => {
  it('첫 경로 세그먼트를 식별자로 쓴다', () => {
    expect(routeIdOf('/sourcing')).toBe('sourcing');
  });

  it('쿼리스트링을 무시한다', () => {
    expect(routeIdOf('/sourcing?tab=discovery&page=3')).toBe('sourcing');
  });

  it('하위 경로도 첫 세그먼트로 묶는다', () => {
    expect(routeIdOf('/listing/detail-maker')).toBe('listing');
  });

  it('루트는 dashboard로 본다', () => {
    expect(routeIdOf('/')).toBe('dashboard');
  });
});

describe('labelForHref', () => {
  it('최상위 항목의 라벨을 찾는다', () => {
    expect(labelForHref('/orders')).toBe('주문/매출');
  });

  it('쿼리가 붙어도 찾는다', () => {
    expect(labelForHref('/orders?tab=cost')).toBe('주문/매출');
  });

  it('하위 항목이 있으면 더 구체적인 라벨을 쓴다', () => {
    expect(labelForHref('/listing/detail-maker')).toBe('상품상세 자동만들기');
  });

  it('등록되지 않은 경로는 식별자를 라벨로 쓴다', () => {
    expect(labelForHref('/unknown-page')).toBe('unknown-page');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/nav-items.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/nav-items"`

- [ ] **Step 3: 구현**

`src/types/tab.ts` 생성:

```ts
/**
 * tab.ts
 * 상단 탭 내비게이션 타입
 */

export type Tab = {
  /** 라우트 첫 세그먼트. 탭의 고유 식별자 */
  id: string;
  /** 쿼리스트링을 포함한 전체 경로 */
  href: string;
  /** 탭에 표시할 이름 */
  label: string;
  /** 마지막으로 활성화된 시각 (ms). LRU 밀어내기 기준 */
  lastActiveAt: number;
  /** 편집 중이면 true. 상한 계산과 밀어내기에서 제외된다 */
  isDirty: boolean;
};
```

`src/lib/nav-items.tsx` 생성 — `AppShell.tsx:9-95`의 타입 선언과 `NAV_ITEMS` 배열을 **그대로 잘라 붙이고** 아래 두 함수를 덧붙인다. 아이콘 JSX가 들어 있어 확장자는 `.tsx`다.

```tsx
/**
 * nav-items.tsx
 * 사이드바 내비게이션 항목 정의와 경로→탭 정보 유도 함수
 *
 * AppShell과 TabBar가 함께 쓴다.
 */

export type NavChild = { href: string; label: string; icon: React.ReactNode };
export type NavItem = { href: string; label: string; icon: React.ReactNode; children?: NavChild[] };

export const NAV_ITEMS: NavItem[] = [
  /* AppShell.tsx:12-95의 배열을 그대로 옮긴다 */
];

/** 경로에서 탭 식별자(첫 세그먼트)를 얻는다. 캐시 키 접두사와 같은 값이다. */
export function routeIdOf(href: string): string {
  const path = href.split('?')[0];
  return path.split('/').filter(Boolean)[0] ?? 'dashboard';
}

/**
 * 경로에 맞는 탭 라벨을 얻는다.
 * 하위 항목을 먼저 확인해 더 구체적인 라벨을 고른다.
 */
export function labelForHref(href: string): string {
  const path = href.split('?')[0];

  for (const item of NAV_ITEMS) {
    for (const child of item.children ?? []) {
      if (path === child.href || path.startsWith(`${child.href}/`)) return child.label;
    }
  }
  for (const item of NAV_ITEMS) {
    if (path === item.href || path.startsWith(`${item.href}/`)) return item.label;
  }
  return routeIdOf(href);
}
```

`src/components/AppShell.tsx`에서 `NavChild`·`NavItem` 타입 선언과 `NAV_ITEMS` 배열(9-95행)을 삭제하고 상단에 추가:

```tsx
import { NAV_ITEMS } from '@/lib/nav-items';
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/nav-items.test.ts`
Expected: PASS (8 tests)

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/nav-items.tsx src/types/tab.ts src/components/AppShell.tsx src/__tests__/lib/nav-items.test.ts
git commit -m "refactor(nav): NAV_ITEMS를 별도 모듈로 분리하고 경로→라벨 유도 함수 추가"
```

---

## Task 2: 탭 스토어 — 열기·닫기·활성화

**Files:**
- Create: `src/store/useTabStore.ts`
- Test: `src/__tests__/store/useTabStore.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * useTabStore.test.ts
 * 탭 열기·닫기·활성화 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore } from '@/store/useTabStore';

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('openTab', () => {
  it('없던 탭을 만들고 활성화한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe('sourcing');
    expect(result.current.tabs[0].label).toBe('소싱');
    expect(result.current.activeId).toBe('sourcing');
  });

  it('같은 라우트를 다시 열면 새 탭을 만들지 않고 href를 갱신한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/sourcing?tab=discovery&page=3'));

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].href).toBe('/sourcing?tab=discovery&page=3');
  });

  it('다시 열면 lastActiveAt이 커진다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    const first = result.current.tabs[0].lastActiveAt;

    act(() => result.current.openTab('/orders'));
    act(() => result.current.openTab('/sourcing'));

    const sourcing = result.current.tabs.find((t) => t.id === 'sourcing')!;
    expect(sourcing.lastActiveAt).toBeGreaterThanOrEqual(first);
  });
});

describe('closeTab', () => {
  it('탭을 제거한다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.tabs.map((t) => t.id)).toEqual(['orders']);
  });

  it('활성 탭을 닫으면 바로 왼쪽 탭이 활성화된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.openTab('/orders'));
    act(() => result.current.openTab('/plan'));
    act(() => result.current.closeTab('orders'));
    act(() => result.current.closeTab('plan'));

    expect(result.current.activeId).toBe('sourcing');
  });

  it('마지막 탭을 닫으면 활성 탭이 없다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.closeTab('sourcing'));

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });

  it('없는 탭을 닫아도 아무 일도 없다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing'));
    act(() => result.current.closeTab('nope'));

    expect(result.current.tabs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/store/useTabStore.test.ts`
Expected: FAIL — `Failed to resolve import "@/store/useTabStore"`

- [ ] **Step 3: 구현**

```ts
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

        set({ tabs: next, activeId: id }, false, 'openTab');
      },

      closeTab: (id) => {
        const { tabs, activeId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx === -1) return;

        const next = tabs.filter((t) => t.id !== id);
        const nextActive =
          activeId === id ? (next[Math.max(0, idx - 1)]?.id ?? null) : activeId;

        set({ tabs: next, activeId: nextActive }, false, 'closeTab');
      },

      setDirty: (id, dirty) => {
        set(
          (s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t)) }),
          false,
          'setDirty',
        );
      },
    }),
    { name: 'TabStore' },
  ),
);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/store/useTabStore.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/store/useTabStore.ts src/__tests__/store/useTabStore.test.ts
git commit -m "feat(tabs): 탭 스토어 열기·닫기·활성화"
```

---

## Task 3: 탭 스토어 — 상한과 편집 보호

`isDirty`가 아닌 탭 기준 6개를 넘으면 그중 가장 오래된 것을 닫는다. `isDirty` 탭은 상한 계산과 밀어내기 양쪽에서 빠진다.

**Files:**
- Modify: `src/store/useTabStore.ts`
- Test: `src/__tests__/store/useTabStore-eviction.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * useTabStore-eviction.test.ts
 * 탭 상한(6개)과 편집 중 탭 보호 단위 테스트
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore } from '@/store/useTabStore';

/** lastActiveAt이 겹치지 않도록 시간을 통제한다 */
let clock = 1_000;

beforeEach(() => {
  clock = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
  useTabStore.setState({ tabs: [], activeId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SEVEN = ['/dashboard', '/sourcing', '/listing', '/label', '/orders', '/plan', '/editor'];

describe('상한', () => {
  it('7번째를 열면 가장 오래된 탭이 밀려난다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs).toHaveLength(6);
    expect(result.current.tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(result.current.tabs.map((t) => t.id)).toContain('editor');
  });

  it('최근에 다시 본 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.slice(0, 6).forEach((href) => act(() => result.current.openTab(href)));
    act(() => result.current.openTab('/dashboard')); // 가장 오래된 것을 다시 봄
    act(() => result.current.openTab('/editor'));    // 7번째

    expect(result.current.tabs.map((t) => t.id)).toContain('dashboard');
    expect(result.current.tabs.map((t) => t.id)).not.toContain('sourcing');
  });

  it('방금 연 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    SEVEN.forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.activeId).toBe('editor');
    expect(result.current.tabs.map((t) => t.id)).toContain('editor');
  });
});

describe('편집 보호', () => {
  it('편집 중인 탭은 밀려나지 않는다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs.map((t) => t.id)).toContain('dashboard');
  });

  it('편집 중인 탭은 상한 계산에서 빠져 7개까지 열린다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));

    expect(result.current.tabs).toHaveLength(7);
  });

  it('편집이 끝나면 그때 상한을 다시 계산해 밀어낸다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/dashboard'));
    act(() => result.current.setDirty('dashboard', true));
    SEVEN.slice(1).forEach((href) => act(() => result.current.openTab(href)));
    expect(result.current.tabs).toHaveLength(7);

    act(() => result.current.setDirty('dashboard', false));

    expect(result.current.tabs).toHaveLength(6);
    expect(result.current.tabs.map((t) => t.id)).not.toContain('dashboard');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/store/useTabStore-eviction.test.ts`
Expected: FAIL — 첫 테스트에서 `expect(received).toHaveLength(6)` / received length 7

- [ ] **Step 3: 구현**

`src/store/useTabStore.ts`에 상수와 헬퍼를 추가한다.

```ts
/** isDirty가 아닌 탭의 최대 개수 */
export const MAX_TABS = 6;

/**
 * 상한을 넘으면 오래된 탭부터 제거한다.
 * isDirty 탭과 protectId 탭은 대상이 아니며 상한 계산에도 넣지 않는다.
 */
function evict(tabs: Tab[], protectId: string | null): Tab[] {
  const counted = tabs.filter((t) => !t.isDirty);
  const overflow = counted.length - MAX_TABS;
  if (overflow <= 0) return tabs;

  const victims = counted
    .filter((t) => t.id !== protectId)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, overflow)
    .map((t) => t.id);

  return tabs.filter((t) => !victims.includes(t.id));
}
```

`openTab`의 `set` 호출을 교체한다.

```ts
        set({ tabs: evict(next, id), activeId: id }, false, 'openTab');
```

`setDirty`를 교체한다. dirty가 풀릴 때 상한을 다시 계산해야 한다.

```ts
      setDirty: (id, dirty) => {
        const { tabs, activeId } = get();
        const next = tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t));
        set({ tabs: dirty ? next : evict(next, activeId) }, false, 'setDirty');
      },
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/store/useTabStore-eviction.test.ts`
Expected: PASS (6 tests)

Run: `npx vitest run src/__tests__/store/useTabStore.test.ts`
Expected: PASS (7 tests) — 기존 테스트가 깨지지 않았는지 확인

- [ ] **Step 5: 커밋**

```bash
git add src/store/useTabStore.ts src/__tests__/store/useTabStore-eviction.test.ts
git commit -m "feat(tabs): 탭 상한 6개와 편집 중 탭 보호"
```

---

## Task 4: 탭 스토어 — localStorage 영속

**Files:**
- Modify: `src/store/useTabStore.ts`
- Test: `src/__tests__/store/useTabStore-persist.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * useTabStore-persist.test.ts
 * 탭 목록의 localStorage 영속 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabStore, TAB_STORAGE_KEY } from '@/store/useTabStore';

beforeEach(() => {
  localStorage.clear();
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('영속', () => {
  it('탭을 열면 localStorage에 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/sourcing?tab=discovery&page=3'));

    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).state.tabs[0].href).toBe('/sourcing?tab=discovery&page=3');
  });

  it('활성 탭도 저장된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/orders'));

    expect(JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)!).state.activeId).toBe('orders');
  });

  it('isDirty는 false로 저장한다 — 재시작 후 편집 상태가 남으면 안 된다', () => {
    const { result } = renderHook(() => useTabStore());
    act(() => result.current.openTab('/editor'));
    act(() => result.current.setDirty('editor', true));

    const saved = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)!).state.tabs[0];
    expect(saved.isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/store/useTabStore-persist.test.ts`
Expected: FAIL — `TAB_STORAGE_KEY` export 없음

- [ ] **Step 3: 구현**

`src/store/useTabStore.ts`의 import와 `create` 호출을 수정한다.

```ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
```

```ts
/** localStorage 키 */
export const TAB_STORAGE_KEY = 'sss-tabs';
```

`create` 호출을 `persist`로 한 겹 감싼다. `devtools(persist(...))` 순서다.

```ts
export const useTabStore = create<TabState>()(
  devtools(
    persist(
      (set, get) => ({
        /* Task 2·3에서 만든 본문 그대로 */
      }),
      {
        name: TAB_STORAGE_KEY,
        // 편집 상태는 세션을 넘기지 않는다
        partialize: (s) => ({
          tabs: s.tabs.map((t) => ({ ...t, isDirty: false })),
          activeId: s.activeId,
        }),
        merge: (persisted, current) => {
          const merged = { ...current, ...(persisted as Partial<TabState>) };
          // 복원 시점에 상한을 다시 적용한다.
          // 저장 당시 isDirty였던 탭이 false로 풀려 초과 상태로 들어올 수 있다.
          return { ...merged, tabs: evict(merged.tabs, [merged.activeId]) };
        },
      },
    ),
    { name: 'TabStore' },
  ),
);
```

### 🔴 `merge`가 없으면 상한이 무기한 깨진다

`partialize`가 저장 시 `isDirty`를 전부 `false`로 만든다. 그래서 **"non-dirty 6개 + dirty 1개 = 7탭"** 상태로 종료하면 재시작 때 **non-dirty 7탭**이 복원된다. 이는 예외가 아니라 편집 보호 기능이 정상적으로 만드는 상태다.

그 상태에서 `AppShell`이 첫 렌더에 현재 경로로 `openTab`을 부르면 **멱등성 가드에 걸려 early return**하므로 `evict`가 돌지 않는다. 사용자가 다른 탭으로 이동해야만 6으로 수렴하며, **한 화면만 쓰는 세션에서는 상한이 영영 복구되지 않는다.**

`merge`에서 `evict`를 한 번 태우면 복원 직후에 정리된다.

- [ ] **Step 4: 복원 시 상한 적용 테스트 추가**

```ts
  it('저장 당시 편집 중이던 탭 때문에 초과 상태로 복원되면 그 자리에서 정리한다', () => {
    // non-dirty 6개 + dirty 1개 = 7탭을 저장한 상황을 직접 만든다
    const tabs = ['dashboard', 'sourcing', 'listing', 'label', 'orders', 'plan', 'editor'].map(
      (id, i) => ({
        id,
        href: `/${id}`,
        label: id,
        lastActiveAt: 100 + i,
        isDirty: false,
      }),
    );
    localStorage.setItem(
      TAB_STORAGE_KEY,
      JSON.stringify({ state: { tabs, activeId: 'editor' }, version: 0 }),
    );

    useTabStore.persist.rehydrate();

    expect(useTabStore.getState().tabs).toHaveLength(6);
    expect(useTabStore.getState().tabs.map((t) => t.id)).not.toContain('dashboard');
    expect(useTabStore.getState().activeId).toBe('editor');
  });
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/__tests__/store/`
Expected: PASS — 탭 스토어 테스트 3개 파일 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/store/useTabStore.ts src/__tests__/store/useTabStore-persist.test.ts
git commit -m "feat(tabs): 탭 목록을 localStorage에 영속"
```

---

## Task 5: 탭 바 컴포넌트

**Files:**
- Create: `src/components/TabBar.tsx`
- Test: `src/__tests__/components/TabBar.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
/**
 * TabBar.test.tsx
 * 탭 바 렌더링과 상호작용 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabBar from '@/components/TabBar';
import { useTabStore } from '@/store/useTabStore';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('TabBar', () => {
  it('열린 탭을 모두 그린다', () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    expect(screen.getByText('소싱')).toBeInTheDocument();
    expect(screen.getByText('주문/매출')).toBeInTheDocument();
  });

  it('탭이 하나여도 표시한다 — 숨기면 레이아웃이 밀린다', () => {
    useTabStore.getState().openTab('/sourcing');
    const { container } = render(<TabBar />);

    expect(container.querySelector('[data-testid="tab-bar"]')).toBeInTheDocument();
  });

  it('탭이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<TabBar />);

    expect(container.querySelector('[data-testid="tab-bar"]')).toBeNull();
  });

  it('탭을 클릭하면 그 href로 이동한다', async () => {
    useTabStore.getState().openTab('/sourcing?tab=discovery&page=3');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByText('소싱'));

    expect(push).toHaveBeenCalledWith('/sourcing?tab=discovery&page=3');
  });

  it('닫기를 누르면 탭이 사라진다', async () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('소싱 탭 닫기'));

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['orders']);
  });

  it('활성 탭을 닫으면 왼쪽 탭으로 이동한다', async () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('주문/매출 탭 닫기'));

    expect(push).toHaveBeenCalledWith('/sourcing');
  });

  it('편집 중인 탭에 표시가 붙는다', () => {
    useTabStore.getState().openTab('/editor');
    useTabStore.getState().setDirty('editor', true);
    render(<TabBar />);

    expect(screen.getByLabelText('편집 중')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/TabBar.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/TabBar"`

- [ ] **Step 3: 구현**

```tsx
'use client';

/**
 * TabBar.tsx
 * 메인 영역 최상단 가로 탭 바
 *
 * 탭 상태만 알고 캐시는 모른다. 둘의 연결은 tab-cache-bridge가 맡는다.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/design-tokens';
import { useTabStore } from '@/store/useTabStore';

const TAB_BAR_HEIGHT = 36;

export default function TabBar() {
  const router = useRouter();
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const closeTab = useTabStore((s) => s.closeTab);

  // 서버에는 localStorage가 없어 탭이 0개인데 클라이언트는 복원된 탭을 그린다.
  // 마운트 전에는 아무것도 그리지 않아 하이드레이션 불일치를 막는다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || tabs.length === 0) return null;

  function handleClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const wasActive = activeId === id;
    closeTab(id);
    if (wasActive) {
      const next = useTabStore.getState();
      router.push(next.tabs.find((t) => t.id === next.activeId)?.href ?? '/dashboard');
    }
  }

  return (
    <div
      data-testid="tab-bar"
      style={{
        height: TAB_BAR_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: C.bg,
        borderBottom: `1px solid ${C.border}`,
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            onClick={() => router.push(tab.href)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px 0 12px',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? C.text : C.textSub,
              backgroundColor: active ? C.card : 'transparent',
              borderRight: `1px solid ${C.border}`,
              borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab.isDirty && (
              <span aria-label="편집 중" style={{ color: C.accent, fontSize: 14, lineHeight: 1 }}>
                ●
              </span>
            )}
            <span>{tab.label}</span>
            <button
              type="button"
              aria-label={`${tab.label} 탭 닫기`}
              onClick={(e) => handleClose(e, tab.id)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: C.textMuted,
                fontSize: 13,
                lineHeight: 1,
                padding: '2px 3px',
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

> 마지막 갱신 시각 표시는 Task 9에서 캐시가 생긴 뒤 붙인다. 지금은 표시할 값이 없다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/components/TabBar.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/TabBar.tsx src/__tests__/components/TabBar.test.tsx
git commit -m "feat(tabs): 탭 바 컴포넌트"
```

---

## Task 6: AppShell 연결 — 1단계 완료

주소가 바뀌면 `openTab`을 부른다. 사이드바 클릭이든 코드상 `router.push`든 한 곳에서 처리된다.

**Files:**
- Modify: `src/components/AppShell.tsx`
- Test: `src/__tests__/components/AppShell-tabs.test.tsx`

### 🔴 SSR 하이드레이션 불일치를 먼저 막는다

`persist`(Task 4)가 붙은 스토어를 서버 렌더링되는 컴포넌트에서 읽으면 **서버와 클라이언트의 첫 렌더 결과가 달라진다.** 서버에는 `localStorage`가 없어 탭이 0개인데, 클라이언트는 복원된 탭을 그린다. Next.js가 하이드레이션 불일치 오류를 낸다.

`TabBar`가 마운트 전에는 아무것도 그리지 않게 한다.

```tsx
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || tabs.length === 0) return null;
```

`TabBar`(Task 5)에 이 처리를 넣고, Task 5의 테스트는 `@testing-library/react`가 클라이언트 렌더만 하므로 그대로 통과한다. **Task 5를 구현할 때 함께 넣는다.**

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
/**
 * AppShell-tabs.test.tsx
 * 주소 변화가 탭으로 반영되는지 확인
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import AppShell from '@/components/AppShell';
import { useTabStore } from '@/store/useTabStore';

let pathname = '/sourcing';
let search = new URLSearchParams('tab=discovery');

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/alerts/AlertList', () => ({
  default: () => null,
}));

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeId: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true, rows: [] }) }));
});

describe('AppShell 탭 연동', () => {
  it('진입한 주소가 탭으로 열린다', () => {
    render(<AppShell>본문</AppShell>);

    const { tabs, activeId } = useTabStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].href).toBe('/sourcing?tab=discovery');
    expect(activeId).toBe('sourcing');
  });

  it('주소가 바뀌면 탭이 따라 바뀐다', () => {
    const { rerender } = render(<AppShell>본문</AppShell>);

    pathname = '/orders';
    search = new URLSearchParams();
    rerender(<AppShell>본문</AppShell>);

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['sourcing', 'orders']);
    expect(useTabStore.getState().activeId).toBe('orders');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/AppShell-tabs.test.tsx`
Expected: FAIL — `expect(received).toHaveLength(1)` / received length 0

- [ ] **Step 3: 구현**

`src/components/AppShell.tsx` 상단 import에 추가:

```tsx
import { usePathname, useSearchParams } from 'next/navigation';
import TabBar from '@/components/TabBar';
import { useTabStore } from '@/store/useTabStore';
```

`usePathname()` 아래에 추가:

```tsx
  const searchParams = useSearchParams();
  const openTab = useTabStore((s) => s.openTab);

  // 주소가 바뀔 때마다 탭에 반영한다.
  // 사이드바 클릭·router.push·뒤로가기가 모두 여기로 모인다.
  useEffect(() => {
    const qs = searchParams.toString();
    openTab(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams, openTab]);
```

메인 영역 `div`의 자식으로 `TabBar`를 넣는다. 기존 `{children}` 바로 앞이다.

```tsx
      <div
        style={{
          flex: 1,
          overflow: mainOverflow,
          display: mainDisplay === 'flex' ? 'flex' : undefined,
          flexDirection: mainDisplay === 'flex' ? 'column' : undefined,
          minWidth: 0,
        }}
      >
        <TabBar />
        {children}
      </div>
```

### 🔴 `/label`이 잘린다 — 배선 전에 먼저 고친다

`src/app/label/layout.tsx`가 `<AppShell mainOverflow="hidden">`이라 메인 영역이 **블록 + `overflow: hidden`**이다. 그 안의 `LabelPageWrapper`는 `height: 100%`(= 100vh)를 쓴다. 여기에 탭 바 36px를 얹으면 콘텐츠가 `36px + 100vh`가 되는데 컨테이너가 `hidden`이라 **스크롤도 안 되고 하단 36px가 그냥 잘린다.** 라벨 편집기의 미리보기·인쇄 패널 바닥이 접근 불가가 된다.

`/editor`는 `mainDisplay="flex"`라 안전하다. 같은 한 줄을 `/label`에도 준다.

```tsx
// src/app/label/layout.tsx
return <AppShell mainOverflow="hidden" mainDisplay="flex">{children}</AppShell>;
```

컬럼 flex가 되면 `LabelPageWrapper`의 `height: 100%`가 flex-basis처럼 동작하고 기본 `flex-shrink: 1`이 남은 높이에 맞춰 줄여준다.

### 탭 바를 스크롤에 고정한다

`mainOverflow='auto'`인 화면에서 탭 바는 일반 블록 자식이라 본문과 함께 스크롤되어 사라진다. `TabBar`의 컨테이너 스타일에 세 줄을 더하면 해소된다.

```tsx
        position: 'sticky',
        top: 0,
        zIndex: 20,
```

블록+`auto` 경로에서는 스크롤포트가 메인 `div`이고 탭 바가 그 직계 자식이라 sticky가 정상 동작한다. flex+`hidden` 경로에서는 스크롤이 없어 무해하다. `zIndex: 20`이면 본문의 sticky 테이블 헤더(`zIndex: 1~2`) 위, 사이드바 알림 드롭다운(`zIndex: 1000`) 아래에 놓인다. **기존 스크롤 동작은 건드리지 않는다.**

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/components/AppShell-tabs.test.tsx`
Expected: PASS (2 tests)

Run: `npm run lint`
Expected: 오류 없음

- [ ] **Step 4-2: 🔴 프로덕션 빌드 확인 — dev 서버만으로는 못 잡는다**

Run: `npm run build`
Expected: EXIT 0

**`useSearchParams()`는 정적 프리렌더를 무력화한다.** `AppShell`이 10개 라우트 레이아웃에서 쓰이므로, Suspense 경계 없이 이 훅을 부르면 정적 생성되는 페이지가 전부 빌드에서 터진다. **dev 모드는 정적 프리렌더를 하지 않으므로 이 문제를 구조적으로 감지할 수 없다.**

그래서 `useSearchParams` 호출을 작은 자식 컴포넌트로 격리하고 `<Suspense>`로 감싼다. `AppShell` 본체는 프리렌더 안전한 상태로 남는다.

```tsx
/** 주소 변화를 탭에 반영한다. useSearchParams를 쓰므로 Suspense 안에 격리한다 */
function TabSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTab = useTabStore((s) => s.openTab);

  useEffect(() => {
    const qs = searchParams.toString();
    openTab(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams, openTab]);

  return null;
}
```

`AppShell` 안에서는 이렇게 쓴다.

```tsx
        <Suspense fallback={null}>
          <TabSync />
        </Suspense>
        <TabBar />
        {children}
```

- [ ] **Step 5: 직접 확인**

Run: `npm run dev`

브라우저에서 확인할 것:
1. `/dashboard` 진입 → 탭 1개 표시
2. 사이드바로 소싱·주문 이동 → 탭 3개
3. 탭 클릭 → 해당 화면 이동
4. 7개째 화면 열기 → 가장 오래된 탭이 사라짐
5. **새로고침 → 탭 목록 유지**
6. 🔴 **`/label` 진입 → 하단이 잘리지 않는지 확인.** 미리보기·인쇄 패널 바닥까지 보여야 한다
7. 본문이 긴 화면(소싱 목록)에서 아래로 스크롤 → **탭 바가 상단에 붙어 있어야 한다**
8. 화면 전환 시 본문이 위아래로 밀리는 순간이 없어야 한다
9. 🔴 **브라우저 콘솔에 하이드레이션 경고가 없는지 확인.** `TabBar`의 `mounted` 가드는 단위 테스트로 겨냥할 수 없다 — zustand가 `getServerSnapshot`으로 항상 초기 상태를 주기 때문에 서버 렌더 테스트는 가드 없이도 통과한다. **이 가드가 실제로 일하는지는 브라우저 콘솔에서만 확인된다.** 탭이 여러 개 저장된 상태로 새로고침해서 볼 것

- [ ] **Step 6: 커밋**

```bash
git add src/components/AppShell.tsx src/__tests__/components/AppShell-tabs.test.tsx
git commit -m "feat(tabs): AppShell에 탭 바 연결 — 1단계 완료"
```

---

## Task 7: 캐시 스토어

**Files:**
- Create: `src/store/useCacheStore.ts`
- Test: `src/__tests__/store/useCacheStore.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * useCacheStore.test.ts
 * 키별 응답 캐시 스토어 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCacheStore } from '@/store/useCacheStore';

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
});

describe('setEntry', () => {
  it('데이터와 시각을 저장한다', () => {
    useCacheStore.getState().setEntry('orders:list', { rows: [1, 2] });

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toEqual({ rows: [1, 2] });
    expect(e.error).toBeNull();
    expect(e.fetchedAt).toBeGreaterThan(0);
  });

  it('다시 저장하면 error가 지워진다', () => {
    useCacheStore.getState().setError('orders:list', '실패');
    useCacheStore.getState().setEntry('orders:list', { rows: [] });

    expect(useCacheStore.getState().entries['orders:list'].error).toBeNull();
  });
});

describe('setError', () => {
  it('이전 데이터를 지우지 않는다', () => {
    useCacheStore.getState().setEntry('orders:list', { rows: [1] });
    useCacheStore.getState().setError('orders:list', '네트워크 오류');

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toEqual({ rows: [1] });
    expect(e.error).toBe('네트워크 오류');
  });

  it('캐시가 없던 키에도 엔트리를 만든다', () => {
    useCacheStore.getState().setError('orders:list', '실패');

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toBeUndefined();
    expect(e.error).toBe('실패');
  });
});

describe('invalidate', () => {
  beforeEach(() => {
    const s = useCacheStore.getState();
    s.setEntry('orders:list', 1);
    s.setEntry('orders:costs', 2);
    s.setEntry('sourcing:shortlist', 3);
    s.setScroll('orders', 120);
  });

  it('정확히 일치하는 키만 지운다', () => {
    useCacheStore.getState().invalidate('orders:list');

    expect(Object.keys(useCacheStore.getState().entries).sort()).toEqual([
      'orders:costs',
      'sourcing:shortlist',
    ]);
  });

  it('별표는 접두사로 일괄 삭제한다', () => {
    useCacheStore.getState().invalidate('orders:*');

    expect(Object.keys(useCacheStore.getState().entries)).toEqual(['sourcing:shortlist']);
  });

  it('접두사 삭제 시 같은 라우트의 스크롤 위치도 지운다', () => {
    useCacheStore.getState().invalidate('orders:*');

    expect(useCacheStore.getState().scroll['orders']).toBeUndefined();
  });

  it('없는 키를 지워도 오류가 나지 않는다', () => {
    expect(() => useCacheStore.getState().invalidate('nope:*')).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/store/useCacheStore.test.ts`
Expected: FAIL — `Failed to resolve import "@/store/useCacheStore"`

- [ ] **Step 3: 구현**

```ts
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

function matches(key: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
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
          'setEntry',
        ),

      setError: (key, error) =>
        set(
          (s) => ({
            entries: {
              ...s.entries,
              [key]: {
                data: s.entries[key]?.data,
                fetchedAt: s.entries[key]?.fetchedAt ?? 0,
                error,
              },
            },
          }),
          false,
          'setError',
        ),

      invalidate: (pattern) =>
        set(
          (s) => {
            const entries = Object.fromEntries(
              Object.entries(s.entries).filter(([k]) => !matches(k, pattern)),
            );
            // `orders:*` 형태면 같은 라우트의 스크롤 위치도 함께 버린다
            const prefix = pattern.endsWith(':*') ? pattern.slice(0, -2) : null;
            const scroll = prefix
              ? Object.fromEntries(
                  Object.entries(s.scroll).filter(
                    ([k]) => k !== prefix && !k.startsWith(`${prefix}#`),
                  ),
                )
              : s.scroll;
            return { entries, scroll };
          },
          false,
          'invalidate',
        ),

      setScroll: (key, y) =>
        set((s) => ({ scroll: { ...s.scroll, [key]: y } }), false, 'setScroll'),
    }),
    { name: 'CacheStore' },
  ),
);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/store/useCacheStore.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/store/useCacheStore.ts src/__tests__/store/useCacheStore.test.ts
git commit -m "feat(cache): 키별 응답 캐시 스토어"
```

---

## Task 8: useCachedFetch — 캐시 히트와 미스

**Files:**
- Create: `src/hooks/useCachedFetch.ts`
- Test: `src/__tests__/hooks/useCachedFetch.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * useCachedFetch.test.ts
 * SWR 조회 훅 — 캐시 히트·미스 동작
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCachedFetch } from '@/hooks/useCachedFetch';
import { useCacheStore } from '@/store/useCacheStore';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [1, 2, 3] }) });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('캐시가 없을 때', () => {
  it('처음에는 isLoading이 참이다', () => {
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('응답이 오면 데이터를 준다', async () => {
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ items: [1, 2, 3] });
  });

  it('select로 필요한 부분만 꺼낸다', async () => {
    const { result } = renderHook(() =>
      useCachedFetch<number[]>('t:list', '/api/t', {
        select: (j) => (j as { items: number[] }).items,
      }),
    );

    await waitFor(() => expect(result.current.data).toEqual([1, 2, 3]));
  });
});

describe('캐시가 있을 때', () => {
  it('첫 렌더부터 데이터가 있고 isLoading은 거짓이다', () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ items: [9] });
  });

  it('캐시를 보여주면서 뒤에서 다시 불러온다', async () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    expect(result.current.data).toEqual({ items: [9] });
    await waitFor(() => expect(result.current.data).toEqual({ items: [1, 2, 3] }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('enabled', () => {
  it('거짓이면 요청하지 않는다', () => {
    renderHook(() => useCachedFetch('t:list', '/api/t', { enabled: false }));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/hooks/useCachedFetch.test.ts`
Expected: FAIL — `Failed to resolve import "@/hooks/useCachedFetch"`

- [ ] **Step 3: 구현**

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/hooks/useCachedFetch.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useCachedFetch.ts src/__tests__/hooks/useCachedFetch.test.ts
git commit -m "feat(cache): useCachedFetch 훅 — 캐시 히트·미스"
```

---

## Task 9: useCachedFetch — 중복 제거와 실패 처리

**Files:**
- Test: `src/__tests__/hooks/useCachedFetch-resilience.test.ts`

Task 8의 구현이 이미 두 동작을 담고 있다. 이 태스크는 **동작을 테스트로 고정**한다. 테스트가 실패하면 구현을 고친다.

- [ ] **Step 1: 테스트 작성**

```ts
/**
 * useCachedFetch-resilience.test.ts
 * 동시 요청 합치기와 실패 시 이전 데이터 유지
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCachedFetch } from '@/hooks/useCachedFetch';
import { useCacheStore } from '@/store/useCacheStore';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('동시 요청', () => {
  it('같은 주소를 동시에 부르면 한 번만 요청한다', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [1] }) });

    const a = renderHook(() => useCachedFetch('t:list', '/api/t'));
    const b = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(a.result.current.data).toBeDefined());
    await waitFor(() => expect(b.result.current.data).toBeDefined());

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('실패', () => {
  it('실패해도 이전 데이터를 지우지 않는다', async () => {
    useCacheStore.getState().setEntry('t:list', { items: [9] });
    mockFetch.mockRejectedValue(new Error('네트워크 오류'));

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('네트워크 오류'));
    expect(result.current.data).toEqual({ items: [9] });
  });

  it('캐시가 없이 실패하면 로딩이 끝나고 오류만 남는다', async () => {
    mockFetch.mockRejectedValue(new Error('실패'));

    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));

    await waitFor(() => expect(result.current.error).toBe('실패'));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('다시 성공하면 오류가 사라진다', async () => {
    mockFetch.mockRejectedValueOnce(new Error('실패'));
    const { result } = renderHook(() => useCachedFetch('t:list', '/api/t'));
    await waitFor(() => expect(result.current.error).toBe('실패'));

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [7] }) });
    await result.current.refetch();

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data).toEqual({ items: [7] });
  });
});
```

- [ ] **Step 2: 실행해 현재 상태 확인**

Run: `npx vitest run src/__tests__/hooks/useCachedFetch-resilience.test.ts`
Expected: PASS (4 tests). 실패하면 Task 8의 `run` 함수를 고쳐 통과시킨다.

- [ ] **Step 3: 탭 바에 갱신 시각 표시**

`src/components/TabBar.tsx`에서 활성 탭에 마지막 갱신 시각을 보여준다. 스펙의 "낡은 값으로 판정" 대응이다.

import에 추가 (`useEffect`·`useState`는 Task 5에서 이미 들어가 있다):

```tsx
import { useCacheStore } from '@/store/useCacheStore';
```

컴포넌트 안, `if (!mounted || tabs.length === 0)` 앞에 추가:

```tsx
  const entries = useCacheStore((s) => s.entries);
  const [, forceTick] = useState(0);

  // 상대 시각 표시를 30초마다 갱신한다
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  /** 해당 라우트에서 가장 최근에 갱신된 시각 */
  function lastFetchedAt(routeId: string): number | null {
    const times = Object.entries(entries)
      .filter(([k]) => k.startsWith(`${routeId}:`))
      .map(([, e]) => e.fetchedAt)
      .filter((t) => t > 0);
    return times.length ? Math.max(...times) : null;
  }

  function relative(ts: number): string {
    const min = Math.floor((Date.now() - ts) / 60_000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    return `${Math.floor(min / 60)}시간 전`;
  }
```

`<span>{tab.label}</span>` 바로 뒤에 추가:

```tsx
            {(() => {
              const ts = lastFetchedAt(tab.id);
              return ts ? (
                <span style={{ fontSize: 10, color: C.textMuted }}>· {relative(ts)}</span>
              ) : null;
            })()}
```

- [ ] **Step 4: 기존 테스트 확인**

Run: `npx vitest run src/__tests__/components/TabBar.test.tsx`
Expected: PASS (7 tests) — 갱신 시각은 캐시가 비어 있으면 표시되지 않으므로 기존 단언이 유지된다

- [ ] **Step 5: 커밋**

```bash
git add src/components/TabBar.tsx src/__tests__/hooks/useCachedFetch-resilience.test.ts
git commit -m "feat(cache): 요청 중복 제거·실패 시 데이터 유지 고정, 탭에 갱신 시각 표시"
```

---

## Task 10: 탭 소멸 시 캐시 해제

탭 스토어와 캐시 스토어는 서로를 모른다. 둘을 잇는 코드를 한 곳에 둔다.

**Files:**
- Create: `src/store/tab-cache-bridge.ts`
- Modify: `src/components/AppShell.tsx`
- Test: `src/__tests__/store/tab-cache-bridge.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
/**
 * tab-cache-bridge.test.ts
 * 탭이 사라지면 그 라우트의 캐시가 해제되는지 확인
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTabCacheBridge } from '@/store/tab-cache-bridge';
import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';

let stop: () => void;

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeId: null });
  useCacheStore.setState({ entries: {}, scroll: {} });
  stop = startTabCacheBridge();
});

afterEach(() => {
  stop();
});

describe('탭 소멸 → 캐시 해제', () => {
  it('탭을 닫으면 그 라우트의 캐시가 사라진다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);
    useCacheStore.getState().setEntry('orders:costs', [2]);
    useCacheStore.getState().setEntry('sourcing:shortlist', [3]);

    useTabStore.getState().closeTab('orders');

    expect(Object.keys(useCacheStore.getState().entries)).toEqual(['sourcing:shortlist']);
  });

  it('밀려난 탭의 캐시도 사라진다', () => {
    ['/dashboard', '/sourcing', '/listing', '/label', '/orders', '/plan'].forEach((h) =>
      useTabStore.getState().openTab(h),
    );
    useCacheStore.getState().setEntry('dashboard:summary', [1]);

    useTabStore.getState().openTab('/editor'); // 7번째 → dashboard 밀려남

    expect(useCacheStore.getState().entries['dashboard:summary']).toBeUndefined();
  });

  it('탭이 유지되면 캐시도 유지된다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);

    useTabStore.getState().openTab('/orders?tab=cost');

    expect(useCacheStore.getState().entries['orders:list']).toBeDefined();
  });

  it('구독을 멈추면 더 이상 해제하지 않는다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('orders:list', [1]);

    stop();
    useTabStore.getState().closeTab('orders');

    expect(useCacheStore.getState().entries['orders:list']).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/store/tab-cache-bridge.test.ts`
Expected: FAIL — `Failed to resolve import "@/store/tab-cache-bridge"`

- [ ] **Step 3: 구현**

```ts
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
```

`src/components/AppShell.tsx`에 구독을 건다. import에 추가:

```tsx
import { startTabCacheBridge } from '@/store/tab-cache-bridge';
```

컴포넌트 안 다른 `useEffect` 옆에 추가:

```tsx
  // 탭이 사라지면 그 라우트의 캐시를 해제한다
  useEffect(() => startTabCacheBridge(), []);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/store/tab-cache-bridge.test.ts`
Expected: PASS (4 tests)

Run: `npx vitest run src/__tests__/`
Expected: 전체 통과

- [ ] **Step 5: 커밋**

```bash
git add src/store/tab-cache-bridge.ts src/components/AppShell.tsx src/__tests__/store/tab-cache-bridge.test.ts
git commit -m "feat(cache): 탭이 닫히면 해당 라우트 캐시 해제"
```

---

## Task 11: 소싱 쇼트리스트에 캐시 적용 — 2단계 완료

첫 적용 대상이다. 단일 GET이고 응답이 `{ items }` 형태라 치환이 명확하다.

**Files:**
- Modify: `src/components/sourcing/ShortlistTab.tsx:102-155`
- Test: `src/__tests__/components/ShortlistTab-cache.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
/**
 * ShortlistTab-cache.test.tsx
 * 쇼트리스트가 캐시를 쓰는지 확인
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ShortlistTab from '@/components/sourcing/ShortlistTab';
import { useCacheStore } from '@/store/useCacheStore';

const mockFetch = vi.fn();

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ items: [] }),
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('쇼트리스트 캐시', () => {
  it('마운트하면 캐시에 sourcing:shortlist 키가 생긴다', async () => {
    render(<ShortlistTab />);

    await waitFor(() =>
      expect(useCacheStore.getState().entries['sourcing:shortlist']).toBeDefined(),
    );
  });

  it('캐시가 있으면 두 번째 마운트에서 즉시 목록을 그린다', async () => {
    useCacheStore.getState().setEntry('sourcing:shortlist', {
      items: [
        {
          itemNo: 12345678,
          title: '테스트 상품',
          memo: null,
          addedAt: '2026-08-01T00:00:00.000Z',
          domeStatus: 'onsale',
          domePrice: 3300,
          domeInventory: 100,
          domeMoq: 1,
          deliIsFree: false,
          deliType: 'tiered',
          deliUnitQty: 30,
          deliFee: 3000,
          coupangP25: 9900,
          coupangSampleN: 91,
          orderQty: 10,
          unitDeliFee: 300,
          effectiveCost: 3600,
          logisticsSize: 'xsmall',
          breakEvenPrice: 8995,
          margin: 3506,
          marginRate: 35.4,
          verdict: 'pass',
          verifiedAt: '2026-08-01T00:00:00.000Z',
          buyKrwTotal: null,
          buyCnyTotal: null,
          orderQty1688: null,
          exchangeRate1688: null,
          intlShipPerUnit: null,
          pastedAt1688: null,
          isArchived: false,
        } satisfies ShortlistItem,
      ],
    });

    render(<ShortlistTab />);

    expect(screen.getByText('테스트 상품')).toBeInTheDocument();
  });
});
```

픽스처는 `src/types/shortlist.ts`의 `ShortlistItem`을 따른다. 파일 상단에 타입을 import한다.

```tsx
import type { ShortlistItem } from '@/types/shortlist';
```

`satisfies ShortlistItem`을 붙였으므로 필드가 어긋나면 `tsc`가 잡는다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/ShortlistTab-cache.test.tsx`
Expected: FAIL — 첫 테스트에서 `entries['sourcing:shortlist']`가 `undefined`

- [ ] **Step 3: 구현**

`src/components/sourcing/ShortlistTab.tsx`를 고친다.

import에 추가:

```tsx
import { useCachedFetch } from '@/hooks/useCachedFetch';
```

`const [items, setItems] = useState<ShortlistItem[]>([]);`(102행)와 `const [error, setError] = useState<string | null>(null);`(107행), 그리고 `load`(136-151행)·`useEffect`(153-155행)를 아래로 교체한다.

```tsx
  const {
    data: items = [],
    isLoading: loading,
    error,
    refetch,
  } = useCachedFetch<ShortlistItem[]>('sourcing:shortlist', '/api/sourcing/shortlist', {
    select: (json) => (json as { items: ShortlistItem[] }).items,
  });

  // 목록이 처음 도착하면 주문 수량 입력칸의 기본값을 맞춘다
  useEffect(() => {
    if (items.length > 0) setOrderQty(items[0].orderQty);
    // 목록 길이가 0→N으로 바뀔 때만 반영한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
```

`load()`를 호출하던 자리를 전부 `refetch()`로 바꾼다. 대상은 `add`·`verifyAll`·`applyOrderQty`·`remove`이며, `load({ silent: true })` 형태도 `refetch()`로 통일한다. 캐시가 이전 목록을 계속 보여주므로 `silent` 구분이 필요 없다.

`setLoading`·`setItems` 호출은 지운다. `loading`과 목록은 이제 훅이 준다.

### 🔴 `setError`는 지우지 않는다 — 오류 출처가 둘이다

훅의 `error`는 **조회 실패만** 담는다. 그런데 `ShortlistTab`은 쓰기 경로 다섯 곳에서 `setError`를 부른다 — `add`(`'추가하지 못했습니다.'`)·`verifyAll`·`patchItem`·`applyOrderQty`·`remove`, 그리고 각 작업 시작 시 `setError(null)`로 배너를 지운다. **훅은 이것들을 담을 자리가 없다.**

로컬 상태를 남기고 두 출처를 합친다.

```tsx
  const [writeError, setWriteError] = useState<string | null>(null);
  const {
    data: items = [],
    isLoading: loading,
    error: loadError,
    refetch,
  } = useCachedFetch<ShortlistItem[]>('sourcing:shortlist', '/api/sourcing/shortlist', {
    select: (json) => (json as { items: ShortlistItem[] }).items,
    errorMessage: '목록을 불러오지 못했습니다.',
  });

  // 쓰기 오류를 먼저 보여준다 — 방금 한 행동의 결과가 더 급하다
  const error = writeError ?? loadError;
```

기존 `setError(...)` 호출을 `setWriteError(...)`로 바꾸면 된다. 화면에 쓰는 `error`는 위에서 합친 값이다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/components/ShortlistTab-cache.test.tsx`
Expected: PASS (2 tests)

Run: `npx tsc --noEmit`
Expected: 오류 없음 — `setItems` 등이 남아 있으면 여기서 잡힌다

- [ ] **Step 5: 직접 확인**

Run: `npm run dev`

1. `/sourcing` 소싱리스트 탭 진입 → 목록 로딩
2. 주문/매출로 이동 후 소싱으로 복귀
3. **목록이 즉시 보이고 로딩 화면이 없어야 한다**
4. 브라우저 네트워크 탭에서 복귀 시 `/api/sourcing/shortlist` 요청이 뜨는지 확인 (백그라운드 갱신이므로 떠야 정상)
5. 소싱 탭을 ✕로 닫고 다시 열면 로딩이 한 번 나타나야 한다 (캐시 해제 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/ShortlistTab.tsx src/__tests__/components/ShortlistTab-cache.test.tsx
git commit -m "feat(sourcing): 쇼트리스트에 캐시 적용 — 2단계 완료"
```

---

## Task 12: e2e — 전체 흐름

**Files:**
- Create: `e2e/tab-navigation.spec.ts`

기존 `e2e/sourcing-flow.spec.ts`가 로그인 없이 `page.goto('/sourcing')`으로 시작한다. 같은 관례를 따른다.

**캐시 동작은 e2e에서 검증하지 않는다.** 소싱 화면이 발굴·검증·실행 3단 탭 구조라 쇼트리스트까지 도달하는 경로가 길고, 그 경로가 바뀌면 탭 테스트가 함께 깨진다. 캐시는 Task 11의 단위 테스트가 이미 잡는다. 여기서는 **탭 바 자체의 동작**만 본다.

- [ ] **Step 1: 테스트 작성**

```ts
/**
 * tab-navigation.spec.ts
 * 탭 이동 · 캐시 · 재시작 복원 전체 흐름
 */

import { test, expect } from '@playwright/test';

/** 사이드바 링크. 탭 바에도 같은 이름이 있으므로 aside로 범위를 좁힌다 */
function sidebarLink(page: import('@playwright/test').Page, name: string) {
  return page.locator('aside').getByRole('link', { name });
}

test.describe('탭 내비게이션', () => {
  test('화면을 오가면 탭이 쌓이고 클릭으로 돌아간다', async ({ page }) => {
    await page.goto('/sourcing');
    await expect(page.getByTestId('tab-bar')).toBeVisible();

    await sidebarLink(page, '주문/매출').click();
    await expect(page).toHaveURL(/\/orders/);

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('소싱')).toBeVisible();
    await expect(bar.getByText('주문/매출')).toBeVisible();

    await bar.getByText('소싱').click();
    await expect(page).toHaveURL(/\/sourcing/);
  });

  test('탭 하나만 있어도 탭 바가 보인다', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('tab-bar').getByText('대시보드')).toBeVisible();
  });

  test('새로고침해도 탭이 복원된다', async ({ page }) => {
    await page.goto('/sourcing');
    await sidebarLink(page, '주문/매출').click();
    await expect(page).toHaveURL(/\/orders/);

    await page.reload();

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('소싱')).toBeVisible();
    await expect(bar.getByText('주문/매출')).toBeVisible();
  });

  test('탭을 닫으면 사라진다', async ({ page }) => {
    await page.goto('/sourcing');
    await sidebarLink(page, '주문/매출').click();

    await page.getByLabel('소싱 탭 닫기').click();

    await expect(page.getByTestId('tab-bar').getByText('소싱')).toHaveCount(0);
  });

  test('7번째 화면을 열면 가장 오래된 탭이 밀려난다', async ({ page }) => {
    await page.goto('/dashboard');
    for (const name of ['소싱', '상품등록', '라벨 인쇄', '주문/매출', '플랜', '에디터']) {
      await sidebarLink(page, name).click();
    }

    const bar = page.getByTestId('tab-bar');
    await expect(bar.getByText('대시보드')).toHaveCount(0);
    await expect(bar.getByText('에디터')).toBeVisible();
  });
});
```

> 마지막 테스트는 `localStorage`에 이전 탭이 남아 있으면 실패한다. Playwright는 테스트마다 새 컨텍스트를 쓰므로 기본 설정에서는 안전하다. `playwright.config.ts`에서 `storageState`를 공유하도록 바꾼다면 테스트 앞에 `page.evaluate(() => localStorage.clear())`를 넣어야 한다.

- [ ] **Step 2: 실행**

Run: `npx playwright test e2e/tab-navigation.spec.ts`
Expected: PASS (5 tests)

사이드바 링크 이름은 `src/lib/nav-items.tsx`의 `label`과 정확히 같아야 한다. 실패하면 그 값을 확인해 맞춘다.

- [ ] **Step 3: 커밋**

```bash
git add e2e/tab-navigation.spec.ts
git commit -m "test(e2e): 탭 이동·캐시·복원 전체 흐름"
```

---

## 후속 계획

이 계획은 설계 문서의 1·2단계를 담는다. 나머지는 별도 계획으로 다룬다.

| 단계 | 내용 | 비고 |
|---|---|---|
| **3** | 나머지 화면을 `useCachedFetch`로 점진 치환 | Task 11이 패턴이다. 화면마다 응답 형태(`items`·`rows`·`data`)만 다르다 |
| **4** | `useScrollRestore`·`useTabDirty` 적용 | 스크롤 복원, 에디터·상품등록에 편집 표시 |

3단계에서 화면을 치환할 때마다 **쓰기 경로에 `refetch()` 또는 `invalidate()`가 붙었는지 확인**한다. 빠뜨리면 저장 후 낡은 목록이 남는다.

### 3단계 제외 대상 — 이 훅으로 치환할 수 없는 패턴

효과 기반 GET 44곳 중 **약 26곳이 치환 가능**하고, 나머지는 다른 도구가 필요하다. 화면 #15쯤에서 발견하지 말고 미리 적어둔다.

| 패턴 | 예 | 이유 |
|---|---|---|
| 여러 API 병합 | `OrdersTab.tsx:344` | 4개를 `allSettled`로 부르고 각각 오류 상태가 따로다. 결과를 병합·정렬해 하나의 목록으로 만든다 |
| 런타임 개수만큼 호출 | `ShippingGroupModal.tsx:43` | `Promise.all`로 상품 N개를 부른다. **훅을 N번 부를 수 없다** |
| 자체 폴링 | `DiscoveryTab.tsx:229` | 스스로 재예약하며 정체를 감지한다. 폴링이 이미 최신성을 보장한다 |
| 이어붙이는 페이지네이션 | `useCostcoProducts.ts` | 무한 스크롤로 결과를 누적한다. 캐시가 "마지막 응답"만 담는 모델과 안 맞는다 |
| 연쇄 의존 조회 | 4곳 | 앞 응답이 다음 요청의 입력이다 |
| `.blob()` 응답 | 8곳 | 전부 버튼 핸들러에서 부른다. 애초에 효과 기반이 아니다 |

### 3단계 전에 풀어야 할 두 가지

**필터가 있는 화면의 캐시 키.** `CostcoTab.tsx:397`은 조건부 파라미터 8개에 검색어와 페이지까지 붙인다. 캐시 키가 그것을 전부 담으면 `<라우트>:<세부>` 규칙이 무너지고 Task 10의 접두사 해제가 안 걸린다. 게다가 `useCacheStore`에는 TTL도 LRU도 상한도 없어서 **키 입력 한 글자마다 엔트리가 하나씩 생긴다.** 새 키는 항상 캐시 미스라 `isLoading`이 매번 참이 되어 **SWR 이득이 0인 곳에서 캐시만 자란다.** 설계의 "메모리 상한은 탭 6개 제한이 대신한다"는 가정이 여기서 깨진다.

**같은 엔드포인트를 두 경로가 쓰는 경우.** `/api/sourcing/costco`를 `CostcoTab`(치환 가능)과 `useCostcoProducts`(치환 불가)가 함께 부른다. 한쪽만 치환하면 캐시가 갈라지고, `CostcoTab.handleCollect`의 POST는 어느 쪽도 무효화하지 못한다.

---

## 자체 점검 결과

계획을 설계 문서와 대조한 기록이다.

| 설계 항목 | 담당 태스크 |
|---|---|
| `TabBar` | Task 5 |
| `useTabStore` (열기·닫기·LRU·dirty·영속) | Task 2·3·4 |
| `useCacheStore` | Task 7 |
| `useCachedFetch` (SWR·dedup·실패 유지) | Task 8·9 |
| `nav-items` 분리·라벨 유도 | Task 1 |
| 탭 닫힘 → 캐시 해제 | Task 10 |
| 마지막 갱신 시각 표시 | Task 9 Step 3 |
| 첫 화면 적용 | Task 11 |
| e2e | Task 12 |
| `useScrollRestore`·`useTabDirty` 화면 적용 | **후속 계획 4단계** |

`useTabDirty` 훅 자체는 `useTabStore.setDirty`를 감싸는 한 줄이라, 실제 사용처가 생기는 4단계에서 만든다. Task 3의 편집 보호 로직은 `setDirty`를 직접 호출해 테스트한다.
