# FIFO 재고초과 노출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매>재고로 FIFO 계산이 실패한 상품을 조용한 0 대신 경고 배지 + "확인 필요" + 상세 안내로 노출한다.

**Architecture:** `products/route.ts`가 `calculateFifo` throw 시 `fifo_error: true`를 응답에 실어 보낸다. 행 컴포넌트(`ProductRow`/`GroupRow`)는 `OverstockBadge`를 표시하고, `ProductRow`는 실현손익 셀을 "확인 필요"로, `ProductDetailPanel`은 안내 줄을 렌더한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + React Testing Library.

**설계 문서:** `docs/superpowers/specs/2026-07-06-fifo-overstock-surfacing-design.md`

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다. `<tr>` 반환 컴포넌트는 `render(<table><tbody>{...}</tbody></table>)`로 감싼다.

---

## File Structure

- **Modify** `src/app/api/cost-management/products/route.ts` — `fifo_error` 플래그.
- **Modify** `src/components/orders/CostManagementTab.tsx` — `ProductRow` 타입에 `fifo_error`; DetailPanel에 `fifoError` 전달.
- **Create** `src/components/orders/cost-table/OverstockBadge.tsx` — ⚠ 재고초과 배지.
- **Modify** `src/components/orders/cost-table/ProductRow.tsx` — 배지 + "확인 필요".
- **Modify** `src/components/orders/cost-table/ProductDetailPanel.tsx` — 안내 줄.
- **Modify** `src/components/orders/cost-table/GroupRow.tsx` — 자식 초과 시 배지.

---

## Task 1: API `fifo_error` 플래그 + 타입

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`
- Modify: `src/components/orders/CostManagementTab.tsx` (타입만)

- [ ] **Step 1: route.ts — 플래그 선언·설정** — `products/route.ts:189-202` 영역.
  현재:
```ts
      let fifoResult: FifoSummary = { current_stock: 0, stock_value: 0, total_realized_profit: 0, sale_details: [] };
      try {
        const batches: PurchaseBatch[] = batchesToUse.map((e) => ({
          id: e.id,
          received_at: e.received_at,
          quantity: e.quantity,
          unit_cost: e.unit_cost,
          unit_shipping_fee: e.unit_shipping_fee,
          unit_rg_shipping_fee: e.unit_rg_shipping_fee ?? 0,
        }));
        fifoResult = calculateFifo(batches, salesToUse, feeRate);
      } catch (e) {
        console.warn(`FIFO 계산 실패 product=${p.id}:`, e instanceof Error ? e.message : e);
      }
```
  변경(`let fifoError = false;` 추가, catch에서 `fifoError = true;`):
```ts
      let fifoResult: FifoSummary = { current_stock: 0, stock_value: 0, total_realized_profit: 0, sale_details: [] };
      let fifoError = false;
      try {
        const batches: PurchaseBatch[] = batchesToUse.map((e) => ({
          id: e.id,
          received_at: e.received_at,
          quantity: e.quantity,
          unit_cost: e.unit_cost,
          unit_shipping_fee: e.unit_shipping_fee,
          unit_rg_shipping_fee: e.unit_rg_shipping_fee ?? 0,
        }));
        fifoResult = calculateFifo(batches, salesToUse, feeRate);
      } catch (e) {
        fifoError = true;
        console.warn(`FIFO 계산 실패 product=${p.id}:`, e instanceof Error ? e.message : e);
      }
```

- [ ] **Step 2: route.ts — 응답 필드 추가** — 응답 객체(`winner_status: winnerStatus,` 있는 return 블록, `products/route.ts:255` 근처)에 한 줄 추가:
```ts
        fifo_error: fifoError,
```

- [ ] **Step 3: ProductRow 타입에 필드 추가** — `CostManagementTab.tsx`의 `interface ProductRow`에서 `winner_status: 'winner' | 'watch' | 'normal';` 다음 줄에 추가:
```ts
  fifo_error: boolean;
```

- [ ] **Step 4: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음(무관한 `ImageLabel3x3Editor.tsx` 제외).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost-management): products API에 fifo_error(재고초과) 플래그"
```

---

## Task 2: `OverstockBadge` 컴포넌트

**Files:**
- Create: `src/components/orders/cost-table/OverstockBadge.tsx`
- Test: `src/__tests__/components/cost-table-overstock-badge.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/components/cost-table-overstock-badge.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverstockBadge } from '@/components/orders/cost-table/OverstockBadge';

describe('OverstockBadge', () => {
  it('재고초과 경고 텍스트와 툴팁을 렌더한다', () => {
    render(<OverstockBadge />);
    const el = screen.getByText(/재고초과/);
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('title', expect.stringContaining('초과'));
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-overstock-badge.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/orders/cost-table/OverstockBadge.tsx`

```tsx
'use client';

import React from 'react';

/** 판매 수량이 입고 수량을 초과해 FIFO 계산이 불가능한 상품 경고 배지. */
export function OverstockBadge() {
  return (
    <span
      title="판매 수량이 입고 수량을 초과했습니다"
      style={{
        fontSize: 11,
        background: '#dc2626',
        color: '#fff',
        padding: '2px 6px',
        borderRadius: 20,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ 재고초과
    </span>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-overstock-badge.test.tsx` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/cost-table/OverstockBadge.tsx src/__tests__/components/cost-table-overstock-badge.test.tsx
git commit -m "feat(cost-management): 재고초과 경고 배지 OverstockBadge"
```

---

## Task 3: ProductRow — 배지 + "확인 필요"

**Files:**
- Modify: `src/components/orders/cost-table/ProductRow.tsx`
- Test: `src/__tests__/components/cost-table-product-row.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/__tests__/components/cost-table-product-row.test.tsx`의 `describe` 안에 추가:

```tsx
  it('fifo_error면 재고초과 배지와 실현손익 "확인 필요"를 렌더한다', () => {
    renderRow({ product: { ...product, fifo_error: true } });
    expect(screen.getByText(/재고초과/)).toBeInTheDocument();
    expect(screen.getByText('확인 필요')).toBeInTheDocument();
  });

  it('fifo_error가 아니면 재고초과 배지가 없다', () => {
    renderRow({ product: { ...product, fifo_error: false } });
    expect(screen.queryByText(/재고초과/)).not.toBeInTheDocument();
  });
```

(참고: 기존 `product` 픽스처에 `fifo_error`가 없으면 `renderRow`가 `{ ...product, fifo_error: ... }`로 덮으므로 별도 수정 불필요. 단 기존 다른 테스트가 `product`에 `fifo_error` 없이 렌더해도 `p.fifo_error`는 `undefined`(falsy)라 배지 미표시 — 정상.)

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-product-row.test.tsx` → FAIL (배지/확인 필요 없음).

- [ ] **Step 3: RowProduct 타입 + import** — `ProductRow.tsx`:
  (a) import 추가: `import { OverstockBadge } from './OverstockBadge';`
  (b) `interface RowProduct`의 `winner_status: 'winner' | 'watch' | 'normal';` 다음 줄에 `fifo_error?: boolean;` 추가.

- [ ] **Step 4: 상품명 옆 배지** — `<WinnerBadge status={p.winner_status} />`(라인 101) 다음 줄에 추가:
```tsx
          {p.fifo_error && <OverstockBadge />}
```

- [ ] **Step 5: 실현손익 셀 "확인 필요"** — 실현손익 `<td>` 내부(라인 122-126)를 교체:
  현재:
```tsx
        {p.sale_count === 0 ? (
          <span style={{ color: '#ccc' }}>—</span>
        ) : (
          `${fmt(p.total_realized_profit)}원`
        )}
```
  변경:
```tsx
        {p.fifo_error ? (
          <span style={{ color: '#dc2626' }}>확인 필요</span>
        ) : p.sale_count === 0 ? (
          <span style={{ color: '#ccc' }}>—</span>
        ) : (
          `${fmt(p.total_realized_profit)}원`
        )}
```

- [ ] **Step 6: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-product-row.test.tsx` → PASS (기존 + 신규 2).

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/cost-table/ProductRow.tsx src/__tests__/components/cost-table-product-row.test.tsx
git commit -m "feat(cost-management): ProductRow 재고초과 배지 + 실현손익 확인 필요"
```

---

## Task 4: ProductDetailPanel 안내 줄 + 배선

**Files:**
- Modify: `src/components/orders/cost-table/ProductDetailPanel.tsx`
- Modify: `src/components/orders/CostManagementTab.tsx` (DetailPanel 호출 2곳)
- Test: `src/__tests__/components/cost-table-detail-panel.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/__tests__/components/cost-table-detail-panel.test.tsx`의 `describe` 안에:

```tsx
  it('fifoError면 재고초과 안내 줄을 렌더한다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} fifoError />,
    );
    expect(screen.getByText(/입고 수량을 초과/)).toBeInTheDocument();
  });

  it('fifoError가 없으면 안내 줄이 없다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    expect(screen.queryByText(/입고 수량을 초과/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-detail-panel.test.tsx` → FAIL.

- [ ] **Step 3: Props에 fifoError 추가** — `ProductDetailPanel.tsx`의 `interface Props`에 `fifoError?: boolean;` 추가하고, 구조분해(`product, colSpan, ...`)에 `fifoError`를 추가.

- [ ] **Step 4: 안내 줄 렌더** — `<td colSpan={colSpan} ...>`의 여는 태그 바로 다음, 수치 스트립 `<div>` 앞에 추가:
```tsx
        {fifoError && (
          <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, fontWeight: 500 }}>
            ⚠ 판매 수량이 입고 수량을 초과했습니다. 입고를 추가하거나 판매 내역을 확인하세요. (재고·실현손익이 정확히 계산되지 않습니다.)
          </div>
        )}
```

- [ ] **Step 5: CostManagementTab 배선** — `CostManagementTab.tsx`의 두 `<ProductDetailPanel ... />` 호출부에 `fifoError={child.fifo_error}` (그룹 자식 쪽)와 `fifoError={p.fifo_error}` (standalone 쪽)를 각각 추가.

- [ ] **Step 6: 테스트·타입 확인** — Run: `npx vitest run src/__tests__/components/cost-table-detail-panel.test.tsx` (PASS) 및 `npx tsc --noEmit` (신규 에러 없음).

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/cost-table/ProductDetailPanel.tsx src/components/orders/CostManagementTab.tsx src/__tests__/components/cost-table-detail-panel.test.tsx
git commit -m "feat(cost-management): 상세 패널에 재고초과 안내 줄"
```

---

## Task 5: GroupRow — 자식 초과 시 배지

**Files:**
- Modify: `src/components/orders/cost-table/GroupRow.tsx`
- Test: `src/__tests__/components/cost-table-group-row.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/__tests__/components/cost-table-group-row.test.tsx`의 `describe` 안에:

```tsx
  it('자식 중 fifo_error가 있으면 재고초과 배지를 렌더한다', () => {
    const g = { ...group, children: [{ id: 'a', sale_quantity: 5, hidden: false, fifo_error: true }, { id: 'b', sale_quantity: 3, hidden: false }] };
    renderGroup({ group: g });
    expect(screen.getByText(/재고초과/)).toBeInTheDocument();
  });

  it('자식에 fifo_error가 없으면 배지가 없다', () => {
    renderGroup();
    expect(screen.queryByText(/재고초과/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/components/cost-table-group-row.test.tsx` → FAIL.

- [ ] **Step 3: 구현** — `GroupRow.tsx`:
  (a) import 추가: `import { OverstockBadge } from './OverstockBadge';`
  (b) 컴포넌트 상단(`const allHidden ...` 근처)에 추가:
```ts
  const hasOverstock = group.children.some((c) => (c as { fifo_error?: boolean }).fifo_error);
```
  (c) 상품명 렌더(라인 32 `{group.productName}`)를 배지와 함께 감싸기:
```tsx
        <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', display: 'flex', alignItems: 'center', gap: 6 }}>
          {group.productName}
          {hasOverstock && <OverstockBadge />}
        </div>
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/components/cost-table-group-row.test.tsx` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/cost-table/GroupRow.tsx src/__tests__/components/cost-table-group-row.test.tsx
git commit -m "feat(cost-management): GroupRow 자식 재고초과 시 배지"
```

---

## Task 6: 전체 검증

- [ ] **Step 1: 관련 테스트 전체**
  Run: `npx vitest run src/__tests__/components/cost-table-overstock-badge.test.tsx src/__tests__/components/cost-table-product-row.test.tsx src/__tests__/components/cost-table-detail-panel.test.tsx src/__tests__/components/cost-table-group-row.test.tsx`
  Expected: 전부 PASS.

- [ ] **Step 2: tsc** — Run: `npx tsc --noEmit` → 무관한 `ImageLabel3x3Editor.tsx` 에러만.

- [ ] **Step 3: 수동 검증(선택)** — 재고초과 상품이 있으면 `/orders?tab=cost`에서 해당 행에 ⚠ 재고초과 배지 + 실현손익 "확인 필요", 상세 펼치면 안내 줄이 보이는지. (재고초과 데이터 없으면 생략 — 로직은 컴포넌트 테스트로 커버.)

---

## Self-Review 노트

- **스펙 커버리지:** API 플래그(§2)=Task 1, 리프행 배지+확인 필요(§3)=Task 3, 상세 안내(§4)=Task 4, 그룹 배지(§5)=Task 5, OverstockBadge(§6)=Task 2, 테스트(§7)=각 Task. 커버됨.
- **범위 밖(§9):** 재고초과 방지·fifo-summary·필터 — 태스크 없음(의도).
- **타입 일관성:** `fifo_error`(Task 1 route/type → Task 3·4·5 사용), `OverstockBadge`(Task 2 → Task 3·5), `fifoError` prop(Task 4). ProductRow는 `product={p}`로 `p.fifo_error`를 직접 읽음(추가 prop 불필요); DetailPanel만 `fifoError` prop 배선.
- **의존:** Task 4 Step 5의 DetailPanel 호출 2곳(그룹 자식/standalone)은 원본에서 `child`/`p` 변수명 확인 후 배선.
