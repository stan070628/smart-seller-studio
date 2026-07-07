# alert/confirm → 토스트·확인 다이얼로그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** orders 컴포넌트의 브라우저 `alert()`(24)·`confirm()`(4)을 앱 스타일 토스트·확인 다이얼로그로 교체한다.

**Architecture:** 라이브러리 없이 모듈 싱글턴 store 2개(`toast`, `confirm`)를 만들고, 루트 layout에 `<Toaster/>`·`<ConfirmHost/>`를 1회 마운트한다. 호출부는 `toast.error(msg)` / `await confirmDialog(msg)`로 교체한다.

**Tech Stack:** Next.js 16, React 19 (`useSyncExternalStore`), TypeScript, Vitest + RTL.

**설계 문서:** `docs/superpowers/specs/2026-07-07-toast-confirm-design.md`

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다.

---

## File Structure

- **Create** `src/components/ui/toast.tsx` — toast store + `toast` API + `<Toaster/>`.
- **Create** `src/components/ui/confirm.tsx` — confirm store + `confirmDialog` + `<ConfirmHost/>`.
- **Modify** `src/components/ui/index.ts` — export.
- **Modify** `src/app/layout.tsx` — 마운트.
- **Modify** orders 6개 파일 — alert→toast, confirm→confirmDialog.

---

## Task 1: 토스트 시스템 `toast.tsx`

**Files:**
- Create: `src/components/ui/toast.tsx`
- Test: `src/__tests__/components/ui-toast.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/ui-toast.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { toast, Toaster } from '@/components/ui/toast';

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('toast.error가 빨강 메시지를 렌더하고 3.5초 후 사라진다', () => {
    render(<Toaster />);
    act(() => { toast.error('실패했어요'); });
    expect(screen.getByText('실패했어요')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.queryByText('실패했어요')).not.toBeInTheDocument();
  });

  it('toast.success 메시지도 렌더된다', () => {
    render(<Toaster />);
    act(() => { toast.success('완료!'); });
    expect(screen.getByText('완료!')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/ui-toast.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/ui/toast.tsx`

```tsx
'use client';

import React, { useSyncExternalStore } from 'react';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string; }

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return items; }

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => { items = items.filter((t) => t.id !== id); emit(); }, 3500);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((t) => (
        <div
          key={t.id}
          onClick={() => { items = items.filter((x) => x.id !== t.id); emit(); }}
          style={{
            background: t.kind === 'success' ? '#16a34a' : '#dc2626',
            color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 13,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)', cursor: 'pointer',
            maxWidth: 360, whiteSpace: 'pre-line',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/ui-toast.test.tsx` → PASS (2 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/ui/toast.tsx src/__tests__/components/ui-toast.test.tsx
git commit -m "feat(ui): 모듈 싱글턴 토스트(toast + Toaster)"
```

---

## Task 2: 확인 다이얼로그 `confirm.tsx`

**Files:**
- Create: `src/components/ui/confirm.tsx`
- Test: `src/__tests__/components/ui-confirm.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/ui-confirm.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { confirmDialog, ConfirmHost } from '@/components/ui/confirm';

describe('confirmDialog', () => {
  it('확인 클릭 시 true로 resolve된다', async () => {
    render(<ConfirmHost />);
    const p = confirmDialog('삭제할까요?');
    expect(await screen.findByText('삭제할까요?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await p).toBe(true);
  });

  it('취소 클릭 시 false로 resolve되고 닫힌다', async () => {
    render(<ConfirmHost />);
    const p = confirmDialog('지울까요?');
    expect(await screen.findByText('지울까요?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(await p).toBe(false);
    expect(screen.queryByText('지울까요?')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/ui-confirm.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/ui/confirm.tsx`

```tsx
'use client';

import React, { useSyncExternalStore } from 'react';

interface ConfirmOptions { message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; }
interface PendingConfirm extends ConfirmOptions { id: number; resolve: (v: boolean) => void; }

let pending: PendingConfirm | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return pending; }

export function confirmDialog(opts: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise<boolean>((resolve) => {
    pending = { id: nextId++, ...options, resolve };
    emit();
  });
}

function close(result: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(result);
}

export function ConfirmHost() {
  const p = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!p) return null;
  return (
    <div
      onClick={() => close(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', maxWidth: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 14, color: '#18181b', whiteSpace: 'pre-line', marginBottom: 16 }}>{p.message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => close(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#3f3f46' }}>{p.cancelLabel ?? '취소'}</button>
          <button onClick={() => close(true)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: p.danger ? '#dc2626' : '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>{p.confirmLabel ?? '확인'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/ui-confirm.test.tsx` → PASS (2 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/ui/confirm.tsx src/__tests__/components/ui-confirm.test.tsx
git commit -m "feat(ui): Promise 기반 확인 다이얼로그(confirmDialog + ConfirmHost)"
```

---

## Task 3: 마운트 + export

**Files:**
- Modify: `src/components/ui/index.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: ui/index.ts export 추가** — 끝에 추가:
```ts
export { toast, Toaster } from './toast';
export { confirmDialog, ConfirmHost } from './confirm';
```

- [ ] **Step 2: layout.tsx 마운트** — `<body className="h-full">{children}</body>`를 교체:
```tsx
      <body className="h-full">
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
```
그리고 파일 상단에 import 추가(layout은 서버 컴포넌트지만 클라이언트 컴포넌트를 자식으로 렌더 가능):
```tsx
import { Toaster } from "@/components/ui/toast";
import { ConfirmHost } from "@/components/ui/confirm";
```

- [ ] **Step 3: 타입/빌드 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음(무관한 `ImageLabel3x3Editor.tsx` 제외).

- [ ] **Step 4: 커밋**

```bash
git add src/components/ui/index.ts src/app/layout.tsx
git commit -m "feat(ui): 루트 layout에 Toaster·ConfirmHost 마운트"
```

---

## Task 4: orders 호출부 교체

**Files:** (모두 Modify)
- `src/components/orders/SaleEntryPanel.tsx`
- `src/components/orders/CostEntryDrawer.tsx`
- `src/components/orders/CostManagementTab.tsx`
- `src/components/orders/ShippingGroupModal.tsx`
- `src/components/orders/AddProductModal.tsx`
- `src/components/orders/RocketGrowthShipmentModal.tsx`

각 파일 상단에 필요한 import를 추가한다: alert 쓰는 파일엔 `import { toast } from '@/components/ui/toast';`, confirm 쓰는 파일엔 `import { confirmDialog } from '@/components/ui/confirm';`.

**alert 분류 (전수):** 아래 라인은 파일 편집 시 위치가 바뀔 수 있으니 **메시지 내용으로 찾아** 교체한다.

- **`toast.success`로 교체(성공/결과):**
  - `SaleEntryPanel.tsx`: `'다운로드쿠폰 정책이 저장되었습니다. 재임포트 시 적용됩니다.'`; `` `${imported}건 가져옴, ${skipped}건 중복 스킵` ``
  - `CostManagementTab.tsx`: `` `variants 일괄 설정 완료 — 총 ${total}개 상품, ${updated}개 업데이트, ${skipped}개 스킵` ``
- **`toast.error`로 교체(그 외 전부 — 실패/검증/안내):** 위 3개를 제외한 나머지 21개 alert. 즉 각 `alert(X)` → `toast.error(X)`.
  - 예: `alert(json.error ?? '저장에 실패했습니다.')` → `toast.error(json.error ?? '저장에 실패했습니다.')`
  - `alert('입고일과 수량을 입력해 주세요.')` → `toast.error('입고일과 수량을 입력해 주세요.')`
  - `SaleEntryPanel.tsx:112`의 정률쿠폰 안내(`"${c.promotionName}" — 정률 쿠폰입니다.\n...`)도 `toast.error`(주의 환기). `\n`은 `whiteSpace:'pre-line'`로 표시됨.

**confirm 교체 (4곳):** 감싼 함수가 async인지 확인 후 `await` 추가.
- `CostEntryDrawer.tsx:222` `if (!confirm('이 입고 건을 삭제할까요?')) return;` → `if (!(await confirmDialog({ message: '이 입고 건을 삭제할까요?', danger: true }))) return;`
- `SaleEntryPanel.tsx:168` `if (!confirm('이 판매 건을 삭제할까요?')) return;` → `if (!(await confirmDialog({ message: '이 판매 건을 삭제할까요?', danger: true }))) return;`
- `CostManagementTab.tsx:517` `if (!confirm(\`"${name}" 상품을 삭제할까요?\n입고 내역도 모두 함께 삭제됩니다.\`)) return;` → `if (!(await confirmDialog({ message: \`"${name}" 상품을 삭제할까요?\n입고 내역도 모두 함께 삭제됩니다.\`, danger: true }))) return;`
- `RocketGrowthShipmentModal.tsx:48` `const ok = window.confirm(...);` → `const ok = await confirmDialog({ message: <기존 메시지>, danger: true });` (기존 메시지 문자열 유지). 감싼 함수에 `async` 없으면 추가.

- [ ] **Step 1: SaleEntryPanel.tsx** — import 2개(toast, confirmDialog) 추가; alert 11개(2 success/9 error) + confirm 1개 교체. 감싼 삭제 함수 async 확인.
- [ ] **Step 2: CostEntryDrawer.tsx** — import 2개; alert 5개(all error) + confirm 1개 교체.
- [ ] **Step 3: CostManagementTab.tsx** — import 2개; alert 5개(1 success/4 error) + confirm 1개 교체.
- [ ] **Step 4: ShippingGroupModal.tsx** — import toast; alert 1개(error).
- [ ] **Step 5: AddProductModal.tsx** — import toast; alert 1개(error).
- [ ] **Step 6: RocketGrowthShipmentModal.tsx** — import 2개; alert 1개(error) + confirm 1개.

- [ ] **Step 7: 교체 누락 검증** — Run:
  `grep -rnE "alert\(|confirm\(|window\.(alert|confirm)" src/components/orders/`
  Expected: **0건**(빈 출력).

- [ ] **Step 8: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음. (confirm 교체로 `await` 추가한 함수가 async인지 확인; 아니면 `async` 추가.)

- [ ] **Step 9: 커밋**

```bash
git add src/components/orders/
git commit -m "feat(cost-management): orders alert/confirm을 토스트·확인 다이얼로그로 교체"
```

---

## Task 5: 전체 검증

- [ ] **Step 1: UI 테스트** — Run: `npx vitest run src/__tests__/components/ui-toast.test.tsx src/__tests__/components/ui-confirm.test.tsx` → PASS (4 passed).
- [ ] **Step 2: 교체 grep 0 재확인** — Run: `grep -rcE "alert\(|confirm\(" src/components/orders/ | grep -v ':0' || echo "clean"` → `clean`.
- [ ] **Step 3: tsc** — Run: `npx tsc --noEmit` → 무관한 `ImageLabel3x3Editor.tsx` 에러만.
- [ ] **Step 4: 수동 검증(선택)** — dev 서버에서 판매 저장 실패→빨강 토스트, 삭제→확인 다이얼로그(확인/취소) 동작.

---

## Self-Review 노트

- **스펙 커버리지:** 토스트(§2)=Task 1, confirm(§3)=Task 2, 마운트(§4)=Task 3, 교체(§5)=Task 4, 테스트(§6)=Task 1·2·5. 커버됨.
- **범위 밖(§8):** orders 외 alert·큐잉·undo 토스트·기존 하단 패널 — 태스크 없음(의도). 토스트는 좌하단(24)이라 우하단 undoToast/importResult와 겹치지 않음.
- **타입 일관성:** `toast.success/error(msg: string)`(Task 1 → Task 4), `confirmDialog(string | ConfirmOptions): Promise<boolean>`(Task 2 → Task 4, danger 옵션 사용), `Toaster`/`ConfirmHost` export(Task 1·2 → Task 3 마운트).
- **의존:** Task 4는 각 파일에서 confirm 감싼 함수의 async 여부를 확인해 `await` 정합. alert 분류(success 3 / error 21)는 메시지 내용 기준.
