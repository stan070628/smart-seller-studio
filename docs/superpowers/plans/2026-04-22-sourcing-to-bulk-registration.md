# 소싱탭 → 대량등록탭 연결 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱탭(도매꾹) 테이블에서 체크박스로 상품을 선택하고 "N개 상품 대량등록" 버튼을 눌러 등록탭 대량등록 큐에 자동으로 연결되도록 한다.

**Architecture:** `useListingStore`에 `pendingBulkItems: string[]` 상태를 추가해 두 탭 간 상품번호를 전달한다. 소싱탭에서 버튼 클릭 시 store에 저장 + 토스트 표시, `BulkImportPanel` 마운트 시 store를 읽어 큐를 초기화한다.

**Tech Stack:** React 18 (useEffect, useState), Zustand (useListingStore), Vitest + fs.readFileSync (정적 분석), Next.js router.push

---

## 파일 변경 범위

| 파일 | 변경 유형 | 역할 |
|------|---------|------|
| `src/store/useListingStore.ts` | 수정 | `pendingBulkItems` 상태 + 2개 액션 추가 |
| `src/__tests__/store/useListingStore-pendingBulk.test.ts` | 신규 | store 액션 단위 테스트 |
| `src/components/listing/BulkImportPanel.tsx` | 수정 | 마운트 시 pendingBulkItems 소비 |
| `src/__tests__/components/bulk-import-panel.test.ts` | 신규 | BulkImportPanel 소스 정적 분석 |
| `src/components/sourcing/DomeggookTab.tsx` | 수정 | 체크박스 컬럼 + 버튼 + 토스트 |
| `src/__tests__/components/domeggook-tab-bulk.test.ts` | 신규 | DomeggookTab 대량등록 기능 정적 분석 |

---

## Task 1: useListingStore — pendingBulkItems 상태 추가

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: ListingStore 인터페이스에 타입 추가**

`updateBrowseFilters` 선언 바로 아래(약 line 189)에 삽입:

```typescript
  // ─── 소싱탭 → 대량등록 연결 ─────────────────────────────────────────────
  pendingBulkItems: string[];
  addPendingBulkItems: (itemNos: string[]) => number;
  clearPendingBulkItems: () => void;
```

- [ ] **Step 2: 초기값 추가**

`browseFilters: { coupangStatus: '', naverStatus: '', keyword: '' },` 바로 아래(약 line 291)에 삽입:

```typescript
      pendingBulkItems: [],
```

- [ ] **Step 3: 액션 구현 추가**

`updateBrowseFilters: (patch) => set(...)` 바로 아래(약 line 296)에 삽입:

```typescript
      addPendingBulkItems: (itemNos) => {
        const existing = new Set(get().pendingBulkItems);
        const toAdd = itemNos.filter((n) => !existing.has(n));
        if (toAdd.length > 0) {
          set(
            (s) => ({ pendingBulkItems: [...s.pendingBulkItems, ...toAdd] }),
            false,
            'listing/addPendingBulkItems',
          );
        }
        return toAdd.length;
      },
      clearPendingBulkItems: () =>
        set({ pendingBulkItems: [] }, false, 'listing/clearPendingBulkItems'),
```

- [ ] **Step 4: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "feat(store): pendingBulkItems 상태 추가 — 소싱탭 대량등록 연결용"
```

---

## Task 2: useListingStore 단위 테스트

**Files:**
- Create: `src/__tests__/store/useListingStore-pendingBulk.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
/**
 * useListingStore-pendingBulk.test.ts
 * pendingBulkItems 액션 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListingStore } from '@/store/useListingStore';

function resetStore() {
  useListingStore.setState({ pendingBulkItems: [] });
}

describe('useListingStore — pendingBulkItems', () => {
  beforeEach(resetStore);

  it('addPendingBulkItems: 새 번호를 추가하고 추가된 수를 반환한다', () => {
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '87654321']);
    });
    expect(added!).toBe(2);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '87654321']);
  });

  it('addPendingBulkItems: 같은 호출 내 중복은 한 번만 추가된다', () => {
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '12345678', '87654321']);
    });
    expect(added!).toBe(2);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '87654321']);
  });

  it('addPendingBulkItems: 기존 상태에 있는 번호는 추가하지 않는다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678'] });
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678', '99991111']);
    });
    expect(added!).toBe(1);
    expect(result.current.pendingBulkItems).toEqual(['12345678', '99991111']);
  });

  it('addPendingBulkItems: 전부 중복이면 0을 반환하고 상태가 변하지 않는다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678'] });
    const { result } = renderHook(() => useListingStore());
    let added: number;
    act(() => {
      added = result.current.addPendingBulkItems(['12345678']);
    });
    expect(added!).toBe(0);
    expect(result.current.pendingBulkItems).toEqual(['12345678']);
  });

  it('clearPendingBulkItems: 목록을 비운다', () => {
    useListingStore.setState({ pendingBulkItems: ['12345678', '87654321'] });
    const { result } = renderHook(() => useListingStore());
    act(() => {
      result.current.clearPendingBulkItems();
    });
    expect(result.current.pendingBulkItems).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/store/useListingStore-pendingBulk.test.ts
```

Expected: 5개 테스트 모두 PASS (Task 1에서 이미 구현함)

- [ ] **Step 3: 커밋**

```bash
git add src/__tests__/store/useListingStore-pendingBulk.test.ts
git commit -m "test(store): pendingBulkItems 액션 단위 테스트 추가"
```

---

## Task 3: BulkImportPanel — pendingBulkItems 소비

**Files:**
- Modify: `src/components/listing/BulkImportPanel.tsx`

- [ ] **Step 1: import에 useEffect 추가 및 useListingStore import 추가**

현재 line 3:
```typescript
import React, { useState } from 'react';
```
→ 교체:
```typescript
import React, { useState, useEffect } from 'react';
```

line 5 아래에 삽입:
```typescript
import { useListingStore } from '@/store/useListingStore';
```

- [ ] **Step 2: 컴포넌트 내 store 소비 코드 추가**

`export default function BulkImportPanel()` 함수 본문 안, `const { items, isRunning, ...} = useImportQueue();` 바로 위에 삽입:

```typescript
  const { pendingBulkItems, clearPendingBulkItems } = useListingStore();

  useEffect(() => {
    if (pendingBulkItems.length > 0) {
      const count = initQueue(pendingBulkItems.join('\n'));
      clearPendingBulkItems();
      if (count > 0) setInitialized(true);
    }
  // initQueue / clearPendingBulkItems는 stable refs — deps 불필요
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

주의: `useEffect`가 `initQueue`를 호출하므로 `useImportQueue()` 구조분해 이후에 위치해야 한다. 실제 순서:

```typescript
  const {
    items,
    isRunning,
    initQueue,
    startProcessing,
    stopProcessing,
    getItemNoForRegister,
    clearFailed,
    readyCount,
    failedCount,
  } = useImportQueue();

  const { pendingBulkItems, clearPendingBulkItems } = useListingStore();

  useEffect(() => {
    if (pendingBulkItems.length > 0) {
      const count = initQueue(pendingBulkItems.join('\n'));
      clearPendingBulkItems();
      if (count > 0) setInitialized(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: 정적 분석 테스트 작성**

`src/__tests__/components/bulk-import-panel.test.ts` 생성:

```typescript
/**
 * bulk-import-panel.test.ts
 * BulkImportPanel이 pendingBulkItems를 마운트 시 소비하는지 정적 분석
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../components/listing/BulkImportPanel.tsx'),
  'utf-8',
);

describe('BulkImportPanel — pendingBulkItems 소비', () => {
  it('useListingStore를 import한다', () => {
    expect(SOURCE).toContain("from '@/store/useListingStore'");
  });

  it('pendingBulkItems와 clearPendingBulkItems를 구조분해한다', () => {
    expect(SOURCE).toContain('pendingBulkItems');
    expect(SOURCE).toContain('clearPendingBulkItems');
  });

  it('useEffect로 마운트 시 initQueue를 호출한다', () => {
    expect(SOURCE).toContain("pendingBulkItems.join('\\n')");
    expect(SOURCE).toContain('clearPendingBulkItems()');
  });
});
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/bulk-import-panel.test.ts
```

Expected: 3개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/BulkImportPanel.tsx \
        src/__tests__/components/bulk-import-panel.test.ts
git commit -m "feat(bulk): 마운트 시 pendingBulkItems 자동 소비"
```

---

## Task 4: DomeggookTab — 체크박스 + 버튼 + 토스트

**Files:**
- Modify: `src/components/sourcing/DomeggookTab.tsx`

### Step 4-1: 상수 및 import 추가

- [ ] **Step 1: 정적 분석 테스트 먼저 작성**

`src/__tests__/components/domeggook-tab-bulk.test.ts` 생성:

```typescript
/**
 * domeggook-tab-bulk.test.ts
 * DomeggookTab 소싱탭→대량등록 연결 기능 정적 분석
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../components/sourcing/DomeggookTab.tsx'),
  'utf-8',
);

describe('DomeggookTab — 대량등록 연결', () => {
  it('CHECKBOX_COL_W 상수가 정의되어 있다', () => {
    expect(SOURCE).toContain('CHECKBOX_COL_W');
  });

  it('useListingStore를 import한다', () => {
    expect(SOURCE).toContain("from '@/store/useListingStore'");
  });

  it('selectedIds 상태가 Set으로 선언된다', () => {
    expect(SOURCE).toContain('selectedIds');
    expect(SOURCE).toContain('new Set()');
  });

  it('bulkToast 상태가 선언된다', () => {
    expect(SOURCE).toContain('bulkToast');
  });

  it('handleBulkSend 함수가 정의되어 있다', () => {
    expect(SOURCE).toContain('handleBulkSend');
    expect(SOURCE).toContain('addPendingBulkItems');
  });

  it('체크박스 thead th가 추가되어 있다', () => {
    expect(SOURCE).toContain('type="checkbox"');
    expect(SOURCE).toContain('allCurrentSelected');
  });

  it('대량등록 버튼이 filterbar에 존재한다', () => {
    expect(SOURCE).toContain('대량등록');
    expect(SOURCE).toContain('selectedCount');
  });

  it('toast overlay가 존재한다', () => {
    expect(SOURCE).toContain('bulkToast.visible');
    expect(SOURCE).toContain('등록탭 바로가기');
  });

  it('# th의 sticky left가 CHECKBOX_COL_W를 사용한다', () => {
    expect(SOURCE).toContain('left: CHECKBOX_COL_W');
  });

  it('상품명 th/td의 sticky left가 CHECKBOX_COL_W + NUM_COL_W를 사용한다', () => {
    expect(SOURCE).toContain('CHECKBOX_COL_W + NUM_COL_W');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/domeggook-tab-bulk.test.ts
```

Expected: 10개 테스트 모두 FAIL (아직 구현 전)

### Step 4-2: 상수 + import + 상태 추가

- [ ] **Step 3: `CHECKBOX_COL_W` 상수 추가**

`DomeggookTab.tsx` 파일 상단의 `NUM_COL_W` 상수 바로 아래에 삽입:

```typescript
// 체크박스 컬럼 총 시각 너비 (sticky left 계산에 사용)
const CHECKBOX_COL_W = 44;
```

- [ ] **Step 4: `useListingStore` import 추가**

`import { useSourcingStore, ... } from '@/store/useSourcingStore';` 바로 아래에 삽입:

```typescript
import { useListingStore } from '@/store/useListingStore';
```

- [ ] **Step 5: 컴포넌트 내 상태 + 핸들러 추가**

`const router = useRouter();` 바로 아래에 삽입:

```typescript
  // ── 소싱탭 → 대량등록 연결 ─────────────────────────────────────────────────
  const { addPendingBulkItems, setListingMode } = useListingStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkToast, setBulkToast] = useState<{ count: number; visible: boolean }>({
    count: 0,
    visible: false,
  });

  const allCurrentSelected =
    sortedItems.length > 0 && sortedItems.every((item) => selectedIds.has(item.id));
  const selectedCount = sortedItems.filter((item) => selectedIds.has(item.id)).length;

  const handleSelectAll = () => {
    if (allCurrentSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedItems.map((item) => item.id)));
    }
  };

  const handleCheckboxToggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSend = () => {
    const itemNosToSend = sortedItems
      .filter((item) => selectedIds.has(item.id))
      .map((item) => String(item.itemNo));
    const added = addPendingBulkItems(itemNosToSend);
    setBulkToast({ count: added, visible: true });
    setSelectedIds(new Set());
    setTimeout(() => setBulkToast((prev) => ({ ...prev, visible: false })), 3000);
  };

  const handleBulkToastNavigate = () => {
    setListingMode('bulk');
    router.push('/listing');
  };
```

주의: `sortedItems`는 line 933의 useMemo로 계산된다. 위 코드 블록 전체를 `sortedItems` useMemo 닫는 `);` 바로 아래에 삽입해야 한다 (line ~960). `router`는 line 779에 이미 정의되어 있다.

### Step 4-3: 테이블 sticky 레이아웃 수정

- [ ] **Step 6: # thead th의 sticky left 수정**

파일 내 `thead`의 `#` 컬럼 th를 찾아(약 line 1530):

```typescript
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                    width: '40px',
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    backgroundColor: C.tableHeader,
                    overflow: 'hidden',
                  }}
                >
                  #
                </th>
```

→ `left: 0` → `left: CHECKBOX_COL_W` 로 변경:

```typescript
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                    width: '40px',
                    position: 'sticky',
                    left: CHECKBOX_COL_W,
                    zIndex: 2,
                    backgroundColor: C.tableHeader,
                    overflow: 'hidden',
                  }}
                >
                  #
                </th>
```

- [ ] **Step 7: 상품명 thead th의 sticky left 수정**

`상품명` th에서 `left: \`${NUM_COL_W}px\`` → `left: \`${CHECKBOX_COL_W + NUM_COL_W}px\``:

```typescript
                  // 변경 전
                  left: `${NUM_COL_W}px`,
                  // 변경 후
                  left: `${CHECKBOX_COL_W + NUM_COL_W}px`,
```

- [ ] **Step 8: # tbody td의 sticky left 수정**

tbody의 `# 순번` td에서 `left: 0` → `left: CHECKBOX_COL_W`:

```typescript
                    // 변경 전
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    // 변경 후
                    position: 'sticky',
                    left: CHECKBOX_COL_W,
                    zIndex: 1,
```

- [ ] **Step 9: 상품명 tbody td의 sticky left 수정**

tbody의 `상품명 + 카테고리` td에서:

```typescript
                // 변경 전
                <td style={{ padding: '10px 12px', maxWidth: '260px', position: 'sticky', left: `${NUM_COL_W}px`, zIndex: 1, backgroundColor: C.card, overflow: 'hidden' }}>
                // 변경 후
                <td style={{ padding: '10px 12px', maxWidth: '260px', position: 'sticky', left: `${CHECKBOX_COL_W + NUM_COL_W}px`, zIndex: 1, backgroundColor: C.card, overflow: 'hidden' }}>
```

### Step 4-4: 체크박스 thead th 추가

- [ ] **Step 10: 체크박스 헤더 컬럼 추가**

`# thead th` 바로 앞에 삽입:

```typescript
                {/* 체크박스 (소싱→대량등록) */}
                <th
                  style={{
                    padding: '9px 8px',
                    textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                    width: `${CHECKBOX_COL_W}px`,
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    backgroundColor: C.tableHeader,
                  }}
                  onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
                >
                  <input
                    type="checkbox"
                    checked={allCurrentSelected}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer', width: 14, height: 14 }}
                  />
                </th>
```

### Step 4-5: 체크박스 tbody td 추가

- [ ] **Step 11: 체크박스 행 셀 추가**

tbody 각 `<tr>` 내 `# 순번` td 바로 앞에 삽입:

```typescript
                    {/* 체크박스 */}
                    <td
                      style={{
                        padding: '10px 8px',
                        textAlign: 'center',
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        backgroundColor: C.card,
                      }}
                      onClick={(e) => handleCheckboxToggle(item.id, e)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => {}}
                        style={{ cursor: 'pointer', width: 14, height: 14, pointerEvents: 'none' }}
                      />
                    </td>
```

### Step 4-6: 필터바에 대량등록 버튼 추가

- [ ] **Step 12: 대량등록 버튼을 filterbar에 추가**

`법적 검토` 버튼 바로 앞에 삽입 (약 line 1030 근처, `ShieldCheck` 버튼 앞):

```typescript
          {/* 대량등록 버튼 */}
          <button
            onClick={handleBulkSend}
            disabled={selectedCount === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              backgroundColor: selectedCount > 0 ? C.btnPrimaryBg : C.btnSecondaryBg,
              color: selectedCount > 0 ? C.btnPrimaryText : C.textSub,
              cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedCount === 0 ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <ShoppingCart size={12} />
            {selectedCount > 0 ? `${selectedCount}개 대량등록` : '대량등록'}
          </button>
```

참고: `ShoppingCart`는 이미 파일 상단에서 `import { ..., ShoppingCart } from 'lucide-react';` 로 임포트되어 있다.

### Step 4-7: 토스트 추가

- [ ] **Step 13: 토스트 overlay 추가**

컴포넌트 return 문 내 최상위 `<div>` 바로 안쪽 첫 번째 자식으로 삽입:

```typescript
      {/* 소싱→대량등록 토스트 */}
      {bulkToast.visible && (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 9999,
            background: '#1e293b',
            color: '#fff',
            borderRadius: 10,
            padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 13,
            minWidth: 240,
          }}
        >
          <span>
            {bulkToast.count > 0
              ? `✓ ${bulkToast.count}개 큐에 추가됨`
              : '모두 이미 큐에 있는 상품입니다'}
          </span>
          {bulkToast.count > 0 && (
            <button
              onClick={handleBulkToastNavigate}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              등록탭 바로가기 →
            </button>
          )}
        </div>
      )}
```

### Step 4-8: 테스트 + 커밋

- [ ] **Step 14: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/domeggook-tab-bulk.test.ts
```

Expected: 10개 테스트 모두 PASS

- [ ] **Step 15: 전체 테스트 회귀 확인**

```bash
npx vitest run
```

Expected: 기존 테스트 포함 전체 PASS (실패 있으면 수정 후 진행)

- [ ] **Step 16: 커밋**

```bash
git add src/components/sourcing/DomeggookTab.tsx \
        src/__tests__/components/domeggook-tab-bulk.test.ts
git commit -m "feat(sourcing): 소싱탭→대량등록 연결 — 체크박스 + 버튼 + 토스트"
```

---

## Task 5: 타입 체크 + 최종 확인

- [ ] **Step 1: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음. 에러 발생 시 해당 파일 수정 후 재확인.

- [ ] **Step 2: 전체 테스트 최종 실행**

```bash
npx vitest run
```

Expected: 전체 PASS

- [ ] **Step 3: 최종 커밋**

```bash
git add -p
git commit -m "feat: 소싱탭→대량등록탭 연결 기능 완성"
```

---

## 알려진 제한사항 (v1)

- 소싱탭에서 등록탭으로 이동 후 이전 큐는 항상 초기화됨 (route 이동 시 컴포넌트 재마운트)
- 필터/페이지 변경 시 체크박스 선택이 유지되나 선택된 항목이 현재 페이지에 없을 수 있음 — 버튼은 현재 페이지 기준 count 표시
- 코스트코탭 등 다른 소싱 탭 연결은 이번 범위 외
