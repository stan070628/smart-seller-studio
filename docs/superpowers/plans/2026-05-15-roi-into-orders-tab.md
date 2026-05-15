# ROI → 주문/매출 탭 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 독립된 `/roi` 페이지를 제거하고, 기존 `주문/매출` 페이지의 서브탭 중 하나로 ROI를 통합한다. 동시에 원가 데이터 소스를 fuzzy-match하던 `sourcing_items`에서, 사용자가 직접 입력한 `product_costs` + `cost_entries` 테이블로 교체해 마진율 계산 정확도를 높인다.

**Architecture:** `OrdersClient`에 `'roi'` 서브탭을 추가하고, 기존 `RoiPageClient`를 해당 탭 아래에 렌더링한다. `/api/roi` route의 `fetchCostMap` 함수를 Render PostgreSQL의 `product_costs`/`cost_entries` 테이블을 직접 조회하도록 수정한다. AppNav에서 ROI 메뉴를 제거하고, `/app/roi/` 디렉터리(page.tsx, layout.tsx)를 삭제한다.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Render PostgreSQL (pg pool)

---

## File Map

| 파일 | 변경 |
|---|---|
| `src/components/AppNav.tsx` | ROI 관리 nav item 제거 |
| `src/app/api/roi/route.ts` | `fetchCostMap` → `product_costs` + `cost_entries` 조회로 교체 |
| `src/components/orders/OrdersClient.tsx` | `'roi'` 서브탭 추가, `RoiPageClient` 렌더링 |
| `src/app/roi/page.tsx` | 삭제 |
| `src/app/roi/layout.tsx` | 삭제 |

변경하지 않는 파일:
- `src/components/roi/RoiPageClient.tsx`
- `src/components/roi/RoiGoalWidget.tsx`
- `src/components/roi/SkuTable.tsx`
- `src/components/roi/SkuDetailPanel.tsx`
- `src/lib/roi/calculations.ts`
- `src/lib/roi/types.ts`

---

## Task 1: AppNav에서 ROI 관리 메뉴 제거

**Files:**
- Modify: `src/components/AppNav.tsx:8-16`

- [ ] **Step 1: NAV_ITEMS에서 ROI 항목 제거**

`src/components/AppNav.tsx` 열기. `NAV_ITEMS` 배열에서 `{ href: '/roi', label: 'ROI 관리' }` 라인을 삭제한다.

변경 전:
```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
  { href: '/roi', label: 'ROI 관리' },
];
```

변경 후:
```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/AppNav.tsx
git commit -m "feat(nav): ROI 관리 메뉴 제거 — 주문/매출 탭으로 통합"
```

---

## Task 2: /api/roi — 원가 소스를 product_costs로 교체

**Files:**
- Modify: `src/app/api/roi/route.ts`

현재 `fetchCostMap`은 `sourcing_items` 테이블(원가관리 탭과 무관한 소싱 DB)을 fuzzy-match하여 원가를 가져온다. 이 함수를 사용자가 수동 입력한 `product_costs` + `cost_entries`(가중평균 원가)를 조회하도록 교체한다.

`product_costs` 테이블 컬럼: `id`, `product_name`, `seller_product_id`, `platform_fee_rate`, `user_id`
`cost_entries` 테이블 컬럼: `product_cost_id`, `unit_cost`, `unit_shipping_fee`, `quantity`, `user_id`

- [ ] **Step 1: `CostStat` 인터페이스에 `feeRate` 필드 추가**

`src/app/api/roi/route.ts` 상단의 `CostStat` 인터페이스를 수정한다:

```typescript
interface CostStat {
  costPrice: number;
  deliveryFee: number;
  feeRate: number;
}
```

- [ ] **Step 2: `fetchCostMap` 함수 시그니처에 `userId` 추가**

```typescript
async function fetchCostMap(
  products: WingProduct[],
  userId: string,
): Promise<Map<number, CostStat>>
```

- [ ] **Step 3: `fetchCostMap` 본문을 product_costs 조회로 교체**

기존 `sourcing_items` 쿼리를 아래로 완전히 교체한다:

```typescript
async function fetchCostMap(
  products: WingProduct[],
  userId: string,
): Promise<Map<number, CostStat>> {
  const pool = getSourcingPool();

  // 가중평균 원가·배송비를 SQL에서 직접 계산
  const { rows } = await pool.query<{
    product_name: string;
    platform_fee_rate: number;
    weighted_avg_cost: number;
    weighted_avg_shipping: number;
  }>(
    `SELECT
       pc.product_name,
       pc.platform_fee_rate,
       COALESCE(
         SUM(ce.unit_cost * ce.quantity) FILTER (WHERE ce.id IS NOT NULL)
         / NULLIF(SUM(ce.quantity) FILTER (WHERE ce.id IS NOT NULL), 0),
         0
       ) AS weighted_avg_cost,
       COALESCE(
         SUM(ce.unit_shipping_fee * ce.quantity) FILTER (WHERE ce.id IS NOT NULL)
         / NULLIF(SUM(ce.quantity) FILTER (WHERE ce.id IS NOT NULL), 0),
         0
       ) AS weighted_avg_shipping
     FROM product_costs pc
     LEFT JOIN cost_entries ce
       ON ce.product_cost_id = pc.id AND ce.user_id = $1
     WHERE pc.user_id = $1
     GROUP BY pc.product_name, pc.platform_fee_rate`,
    [userId],
  );

  const result = new Map<number, CostStat>();
  for (const p of products) {
    const namePrefix = p.vendorItemName.slice(0, 10);
    const matched =
      rows.find((r) => r.product_name === p.vendorItemName) ??
      rows.find(
        (r) =>
          r.product_name.includes(namePrefix) ||
          p.vendorItemName.includes(r.product_name.slice(0, 10)),
      );
    if (matched && matched.weighted_avg_cost > 0) {
      result.set(p.vendorItemId, {
        costPrice: Number(matched.weighted_avg_cost),
        deliveryFee: Number(matched.weighted_avg_shipping),
        feeRate: Number(matched.platform_fee_rate),
      });
    }
  }
  return result;
}
```

- [ ] **Step 4: GET 핸들러에서 `fetchCostMap` 호출 시 `userId` 전달**

GET 핸들러 안의 Step 2 호출부를 수정한다:

```typescript
// ── Step 2: product_costs에서 원가·배송비 조회 (name 매칭) ──────────────
const costMap = await fetchCostMap(wingProducts, userId).catch(() => new Map<number, CostStat>());
```

- [ ] **Step 5: SKU 계산 루프에서 feeRate를 costMap에서 우선 사용**

`resolveCoupangFee(null)` 호출 제거 후, 상품별로 costMap의 feeRate를 사용하도록 변경한다.

기존:
```typescript
const feeResult = resolveCoupangFee(null); // 카테고리 미연동 → 기본 10.8%

const skus: SkuRoiData[] = wingProducts.map((p) => {
  const cost = costMap.get(p.vendorItemId) ?? { costPrice: 0, deliveryFee: 0 };
  // ...
  const marginAmount = calcMargin(p.sellingPrice, cost.costPrice, feeResult.rate, cost.deliveryFee);
```

변경 후:
```typescript
const DEFAULT_FEE_RATE = 0.108; // product_costs 미등록 상품의 기본 수수료율

const skus: SkuRoiData[] = wingProducts.map((p) => {
  const cost = costMap.get(p.vendorItemId) ?? { costPrice: 0, deliveryFee: 0, feeRate: DEFAULT_FEE_RATE };
  // ...
  const marginAmount = calcMargin(p.sellingPrice, cost.costPrice, cost.feeRate, cost.deliveryFee);
```

SkuRoiData 반환 시 `feeRate` 필드도 `cost.feeRate`로 변경:
```typescript
return {
  // ...
  feeRate: cost.feeRate,
  // ...나머지는 동일
};
```

- [ ] **Step 6: import에서 `resolveCoupangFee` 제거**

`src/app/api/roi/route.ts` 상단의 아래 라인을 삭제한다:
```typescript
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
```

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/roi/route.ts
git commit -m "feat(roi/api): 원가 소스를 product_costs+cost_entries로 교체"
```

---

## Task 3: OrdersClient에 ROI 서브탭 추가

**Files:**
- Modify: `src/components/orders/OrdersClient.tsx`

- [ ] **Step 1: `RoiPageClient` import 추가**

`src/components/orders/OrdersClient.tsx` 상단에 import를 추가한다:

```typescript
import { RoiPageClient } from '@/components/roi/RoiPageClient';
```

- [ ] **Step 2: `SubTab` 타입에 `'roi'` 추가**

```typescript
type SubTab = 'orders' | 'channels' | 'cost' | 'roi';
```

- [ ] **Step 3: `SUB_TABS` 배열에 ROI 항목 추가**

`TrendingUp` 아이콘을 import에 추가한 뒤:
```typescript
import { ShoppingCart, BarChart3, Settings, ClipboardList, TrendingUp } from 'lucide-react';
```

`SUB_TABS` 배열:
```typescript
const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문·배송', icon: <ClipboardList size={14} /> },
  { id: 'cost', label: '수익·원가', icon: <BarChart3 size={14} /> },
  { id: 'roi', label: 'ROI', icon: <TrendingUp size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
];
```

- [ ] **Step 4: ROI 탭 렌더링 추가**

기존 조건부 렌더링 블록 아래에 추가:

```typescript
{activeSubTab === 'orders' && <OrdersTab />}
{activeSubTab === 'cost' && <CostManagementTab />}
{activeSubTab === 'roi' && (
  <div style={{ background: '#18181b', borderRadius: '12px', padding: '4px' }}>
    <RoiPageClient initialData={[]} />
  </div>
)}
{activeSubTab === 'channels' && <ChannelsTab />}
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/OrdersClient.tsx
git commit -m "feat(orders): ROI 서브탭 추가"
```

---

## Task 4: /app/roi/ 페이지·레이아웃 삭제

**Files:**
- Delete: `src/app/roi/page.tsx`
- Delete: `src/app/roi/layout.tsx`

- [ ] **Step 1: 파일 삭제**

```bash
rm src/app/roi/page.tsx
rm src/app/roi/layout.tsx
rmdir src/app/roi
```

- [ ] **Step 2: 빌드 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -20
```

Expected: 에러 없음 (또는 기존 pre-existing 에러만)

- [ ] **Step 3: ROI 계산 테스트 통과 확인**

```bash
npx vitest run src/lib/roi/
```

Expected:
```
Test Files  1 passed (1)
    Tests  17 passed (17)
```

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore(roi): 독립 /roi 페이지 삭제 — 주문/매출 탭으로 통합 완료"
```

---

## 검증 체크리스트

- [ ] AppNav에 `ROI 관리` 메뉴가 보이지 않음
- [ ] `/roi` URL 직접 접근 시 404 표시
- [ ] `주문/매출` 페이지에 `[주문·배송] [수익·원가] [ROI] [채널설정]` 탭이 보임
- [ ] ROI 탭 클릭 시 SKU 테이블이 렌더링됨
- [ ] `수익·원가` 탭에 원가가 입력된 상품의 경우 ROI 탭에서 마진율이 89.2%가 아닌 실제 값으로 표시
- [ ] `수익·원가` 탭 기존 기능(원가 입력, FIFO 손익)이 정상 동작함
