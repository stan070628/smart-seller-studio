# 도매꾹 검색 기능 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도매꾹 탭 검색창에 텍스트를 입력하면 일치하는 상품이 즉시 조회되도록 수정한다.

**Architecture:** `useSourcingStore.ts`의 `setSearchQuery` 액션이 다른 필터 setter들과 달리 `fetchAnalysis()`를 호출하지 않는 설계 불일치가 원인이다. store 레벨에서 debounced `fetchAnalysis()` 호출을 추가하고, 컴포넌트의 중복 debounce 로직을 제거한다. Enter 키 즉시 검색도 함께 추가한다.

**Tech Stack:** Zustand, React useCallback, Vitest fake timers

---

## File Map

| 파일 | 상태 | 역할 |
|---|---|---|
| `src/store/useSourcingStore.ts` | 수정 | `setSearchQuery`에 debounced fetchAnalysis 추가 |
| `src/components/sourcing/DomeggookTab.tsx` | 수정 | handleSearchChange 단순화 + Enter 핸들러 추가 |
| `src/__tests__/store/useSourcingStore-search.test.ts` | 신규 | setSearchQuery debounce 동작 단위 테스트 |

---

## Task 1: useSourcingStore — setSearchQuery에 debounced fetchAnalysis 추가

**Files:**
- Modify: `src/store/useSourcingStore.ts:334-336`
- Test: `src/__tests__/store/useSourcingStore-search.test.ts`

현재 상태:
```typescript
setSearchQuery: (q: string) => {
  set({ searchQuery: q, page: 1 }, false, 'sourcing/setSearchQuery');
},
```

다른 모든 필터 setter는 `get().fetchAnalysis()`를 바로 호출하지만, `setSearchQuery`만 빠져있어 검색이 동작하지 않는다. 텍스트 입력은 매 keystroke마다 호출되므로 debounce가 필요하다.

- [ ] **Step 1: 테스트 파일 작성 (failing)**

`src/__tests__/store/useSourcingStore-search.test.ts` 생성:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSourcingStore } from '@/store/useSourcingStore';

describe('useSourcingStore — setSearchQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // fetchAnalysis를 mock해서 호출 추적
    const store = useSourcingStore.getState();
    vi.spyOn(store, 'fetchAnalysis').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // store 상태 초기화
    useSourcingStore.setState({ searchQuery: '', page: 1 });
  });

  it('setSearchQuery 호출 시 searchQuery 상태가 업데이트된다', () => {
    useSourcingStore.getState().setSearchQuery('디스팬서');
    expect(useSourcingStore.getState().searchQuery).toBe('디스팬서');
  });

  it('setSearchQuery 호출 시 page가 1로 리셋된다', () => {
    useSourcingStore.setState({ page: 3 });
    useSourcingStore.getState().setSearchQuery('테스트');
    expect(useSourcingStore.getState().page).toBe(1);
  });

  it('setSearchQuery 호출 후 300ms가 지나면 fetchAnalysis가 호출된다', async () => {
    const fetchAnalysis = vi.spyOn(useSourcingStore.getState(), 'fetchAnalysis').mockResolvedValue(undefined);
    useSourcingStore.getState().setSearchQuery('디스팬서');
    expect(fetchAnalysis).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
  });

  it('300ms 내에 연속 호출 시 마지막 호출만 fetchAnalysis를 실행한다', async () => {
    const fetchAnalysis = vi.spyOn(useSourcingStore.getState(), 'fetchAnalysis').mockResolvedValue(undefined);
    useSourcingStore.getState().setSearchQuery('디');
    vi.advanceTimersByTime(100);
    useSourcingStore.getState().setSearchQuery('디스');
    vi.advanceTimersByTime(100);
    useSourcingStore.getState().setSearchQuery('디스팬서');
    vi.advanceTimersByTime(300);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/store/useSourcingStore-search.test.ts 2>&1 | tail -10
```

Expected: `fetchAnalysis` 관련 테스트 FAIL (현재 setSearchQuery가 fetchAnalysis를 호출하지 않음)

- [ ] **Step 3: useSourcingStore.ts 수정 — 파일 상단에 모듈 레벨 debounce 타이머 추가**

`src/store/useSourcingStore.ts` 파일 최상단 import 블록 바로 아래(첫 번째 변수 선언 앞)에 추가:

```typescript
// 검색 debounce 타이머 — 텍스트 입력 시 과도한 API 호출 방지
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
```

정확히 어디에 넣을지: 파일에서 `import` 구문이 끝나고 `create(` 또는 `export` 구문이 시작되기 전 위치.

```bash
grep -n "^import\|^let\|^const\|^export\|^function" src/store/useSourcingStore.ts | head -10
```
를 실행해서 정확한 위치를 확인한 후 삽입한다.

- [ ] **Step 4: setSearchQuery 수정 — debounced fetchAnalysis 추가**

`src/store/useSourcingStore.ts`의 `setSearchQuery` 블록을 찾아 교체:

현재 코드 (334-336줄 근처):
```typescript
setSearchQuery: (q: string) => {
  set({ searchQuery: q, page: 1 }, false, 'sourcing/setSearchQuery');
},
```

교체할 코드:
```typescript
setSearchQuery: (q: string) => {
  set({ searchQuery: q, page: 1 }, false, 'sourcing/setSearchQuery');
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    get().fetchAnalysis();
  }, 300);
},
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx vitest run src/__tests__/store/useSourcingStore-search.test.ts 2>&1 | tail -10
```

Expected: `4 passed`

- [ ] **Step 6: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "useSourcingStore" | head -5
```

Expected: 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add src/store/useSourcingStore.ts src/__tests__/store/useSourcingStore-search.test.ts
git commit -m "fix: setSearchQuery에 debounced fetchAnalysis 추가 — 검색 동작 수정"
```

---

## Task 2: DomeggookTab — handleSearchChange 단순화 + Enter 즉시 검색

**Files:**
- Modify: `src/components/sourcing/DomeggookTab.tsx:844-855, 1316-1328`

Task 1에서 store가 debounce를 책임지게 됐으므로, 컴포넌트의 중복 debounce 로직을 제거한다. 또한 Enter 키를 누르면 즉시 검색이 실행되도록 핸들러를 추가한다.

- [ ] **Step 1: handleSearchChange 단순화**

`src/components/sourcing/DomeggookTab.tsx`에서 현재 코드 찾기:

```typescript
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchAnalysis();
      }, 300);
    },
    [setSearchQuery, fetchAnalysis],
  );
```

다음으로 교체:

```typescript
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery],
  );
```

- [ ] **Step 2: debounceRef 관련 코드 정리**

`debounceRef`는 이제 `handleSearchChange`에서만 사용하고 있었다. `debounceRef` 선언 줄을 찾아서 삭제한다:

찾을 코드:
```typescript
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

삭제한다. (단, 파일 다른 곳에서 `debounceRef`를 사용하는지 먼저 확인)

```bash
grep -n "debounceRef" src/components/sourcing/DomeggookTab.tsx
```

`debounceRef`가 이 두 줄(`const debounceRef = ...`와 `debounceRef.current`) 외에 더 나온다면 삭제하지 말고 그대로 둔다.

- [ ] **Step 3: Enter 키 핸들러 추가**

`handleSearchChange` 바로 아래에 추가:

```typescript
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fetchAnalysis();
      }
    },
    [fetchAnalysis],
  );
```

- [ ] **Step 4: 검색 input에 onKeyDown 연결**

검색 input 요소를 찾는다 (`value={searchQuery}` 와 `onChange={handleSearchChange}` 가 있는 곳):

현재:
```tsx
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="상품명 검색..."
```

다음으로 교체:
```tsx
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="상품명 검색..."
```

- [ ] **Step 5: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "DomeggookTab" | head -5
```

Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/DomeggookTab.tsx
git commit -m "fix: DomeggookTab handleSearchChange 단순화 + Enter 즉시 검색 추가"
```
