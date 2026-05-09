# 주문/매출 탭 재편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주문/매출 탭의 4개 서브탭(주문관리·매출분석·채널설정·원가관리)을 3개(주문·배송·수익·원가·채널설정)로 재편하고, 매출분석 기능을 원가관리에 흡수한다.

**Architecture:** `OrdersClient.tsx`에서 analytics 탭을 제거하고 탭 레이블을 변경한다. `CostManagementTab.tsx`에 `AnalyticsTab`의 API fetch 로직을 이식해 상단 섹션으로 추가한다. 두 섹션(API 기반 실제 매출 / DB 기반 원가)은 동일한 기간 필터를 공유하되 독립적으로 로딩된다.

**Tech Stack:** React, Next.js App Router, TypeScript, lucide-react, `/api/orders/coupang`, `/api/orders/naver`, `/api/cost-management/products`

---

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `src/components/orders/OrdersClient.tsx` | 수정 — analytics 탭 제거, 레이블 변경 |
| `src/components/orders/CostManagementTab.tsx` | 수정 — 분석 섹션 추가, getDateRange 모듈 수준으로 추출 |
| `src/components/orders/AnalyticsTab.tsx` | 삭제 |

변경 없음: `OrdersTab.tsx`, `ChannelsTab.tsx`, `SaleEntryPanel.tsx`, `CostEntryDrawer.tsx`, `AddProductModal.tsx`, `ShippingGroupModal.tsx`, 모든 API 라우트

---

## Task 1: OrdersClient.tsx — 탭 구조 재편

**Files:**
- Modify: `src/components/orders/OrdersClient.tsx`

- [ ] **Step 1: OrdersClient.tsx 전체를 아래 코드로 교체한다**

변경 사항: `analytics` 서브탭 제거, `SubTab` 타입에서 `'analytics'` 제거, `AnalyticsTab` import 제거, 레이블 `주문관리→주문·배송` / `원가관리→수익·원가`, 아이콘 교체.

```tsx
'use client';

import React, { useState } from 'react';
import { ShoppingCart, BarChart3, Settings, ClipboardList } from 'lucide-react';
import OrdersTab from './OrdersTab';
import ChannelsTab from './ChannelsTab';
import CostManagementTab from './CostManagementTab';

type SubTab = 'orders' | 'channels' | 'cost';

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문·배송', icon: <ClipboardList size={14} /> },
  { id: 'cost', label: '수익·원가', icon: <BarChart3 size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
];

export default function OrdersClient() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('orders');

  return (
    <div style={{ backgroundColor: '#f5f5f7', minHeight: '100%' }}>
      <main style={{ maxWidth: '1100px', width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShoppingCart size={18} color="#be0014" />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#18181b', margin: 0 }}>주문 / 매출</h1>
            <p style={{ fontSize: '12px', color: '#71717a', margin: 0 }}>주문 배송 · 수익·원가 관리 · 채널 설정</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '12px', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: '20px', border: '1px solid #e5e5e5' }}>
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: activeSubTab === tab.id ? 600 : 500,
                color: activeSubTab === tab.id ? '#be0014' : '#71717a',
                backgroundColor: activeSubTab === tab.id ? 'rgba(190,0,20,0.07)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {activeSubTab === 'orders' && <OrdersTab />}
        {activeSubTab === 'cost' && <CostManagementTab />}
        {activeSubTab === 'channels' && <ChannelsTab />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 개발 서버에서 탭이 3개로 줄었는지, 각 탭 이름이 올바른지 확인한다**

```bash
# 개발 서버가 실행 중이면 브라우저에서 /orders 접근
# 주문·배송 / 수익·원가 / 채널설정 3탭이 보여야 함
# 각 탭 전환이 정상 작동해야 함
```

- [ ] **Step 3: 커밋한다**

```bash
git add src/components/orders/OrdersClient.tsx
git commit -m "refactor(orders): 탭 구조 4→3개 재편, analytics 탭 제거"
```

---

## Task 2: CostManagementTab.tsx — 실제 매출 섹션 추가

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

이 작업은 단계적으로 진행한다. 먼저 모듈 수준 유틸리티를 추출하고, 그 다음 분석 로직을 추가한다.

- [ ] **Step 1: 파일 상단 import에 lucide-react 아이콘을 추가한다**

현재 import:
```tsx
import { Plus, Truck, Search, Trash2 } from 'lucide-react';
```

변경 후:
```tsx
import { Plus, Truck, Search, Trash2, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
```

- [ ] **Step 2: `getDateRange` 함수를 모듈 수준으로 추출한다**

현재 `getDateRange`는 `load` 콜백 내부에 중첩 정의되어 있다. 이를 파일 상단(컴포넌트 바깥)으로 꺼낸다.

`'use client';` 바로 아래, import 블록 뒤에 아래 코드를 추가한다:

```tsx
// ─── 타입 ──────────────────────────────────────────────────────────────────

interface OrderItem {
  sellerProductName: string;
  shippingCount: number;
  orderPrice: number;
}

interface UnifiedOrder {
  status: string;
  orderedAt: string;
  platform: 'coupang' | 'naver';
  orderItems: OrderItem[];
}

interface ApiRevenue {
  totalRevenue: number;
  totalOrders: number;
  cancelCount: number;
  coupangRevenue: number;
  naverRevenue: number;
  coupangOrders: number;
  naverOrders: number;
  prevTotalRevenue: number;
  prevTotalOrders: number;
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────

type Preset = 'this_month' | 'last_month' | '3months' | '6months' | 'all' | 'custom';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDateRange(p: Preset, customFrom: string, customTo: string): { from: string; to: string } | null {
  const today = new Date();
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'all') return null;
  if (p === 'custom') {
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return null;
  }
  if (p === 'this_month') {
    return {
      from: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: fmtDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (p === 'last_month') {
    return {
      from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: fmtDate(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  if (p === '3months') {
    return {
      from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
      to: fmtDate(today),
    };
  }
  return {
    from: fmtDate(new Date(today.getFullYear(), today.getMonth() - 5, 1)),
    to: fmtDate(today),
  };
}

const CANCELLED = new Set([
  'CANCEL_REQUEST', 'CANCEL_DONE', 'RETURN_REQUEST', 'RETURN_DONE',
  'CANCELED', 'RETURNED',
]);

async function fetchOrdersForPeriod(from: string, to: string): Promise<{ orders: UnifiedOrder[]; coupangError: string | null; naverError: string | null }> {
  const params = new URLSearchParams({ from, to });
  const [coupangResult, naverResult] = await Promise.allSettled([
    fetch(`/api/orders/coupang?${params}`).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? '쿠팡 주문 조회 실패');
      return (json.data?.items ?? []) as Array<{ status: string; orderedAt: string; orderItems: OrderItem[] }>;
    }),
    fetch(`/api/orders/naver?${params}`).then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? '네이버 주문 조회 실패');
      return (json.data?.items ?? []) as Array<{ status: string; orderedAt: string; orderItems: OrderItem[] }>;
    }),
  ]);
  const orders: UnifiedOrder[] = [];
  if (coupangResult.status === 'fulfilled') {
    orders.push(...coupangResult.value.map((o) => ({ ...o, platform: 'coupang' as const })));
  }
  if (naverResult.status === 'fulfilled') {
    orders.push(...naverResult.value.map((o) => ({ ...o, platform: 'naver' as const })));
  }
  return {
    orders,
    coupangError: coupangResult.status === 'rejected' ? (coupangResult.reason instanceof Error ? coupangResult.reason.message : '조회 실패') : null,
    naverError: naverResult.status === 'rejected' ? (naverResult.reason instanceof Error ? naverResult.reason.message : '조회 실패') : null,
  };
}

function computeApiRevenue(curr: UnifiedOrder[], prev: UnifiedOrder[]): ApiRevenue {
  const active = (orders: UnifiedOrder[]) => orders.filter((o) => !CANCELLED.has(o.status));
  const sum = (orders: UnifiedOrder[]) => active(orders).reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0);

  const currActive = active(curr);
  const coupangActive = currActive.filter((o) => o.platform === 'coupang');
  const naverActive = currActive.filter((o) => o.platform === 'naver');

  return {
    totalRevenue: sum(curr),
    totalOrders: currActive.length,
    cancelCount: curr.filter((o) => CANCELLED.has(o.status)).length,
    coupangRevenue: coupangActive.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0),
    naverRevenue: naverActive.reduce((s, o) => s + o.orderItems.reduce((is, i) => is + i.orderPrice, 0), 0),
    coupangOrders: coupangActive.length,
    naverOrders: naverActive.length,
    prevTotalRevenue: sum(prev),
    prevTotalOrders: active(prev).length,
  };
}

function changePct(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function fmtRevenue(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}천만`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString();
}
```

- [ ] **Step 3: 기존 파일에서 중복 선언을 제거하고 `load` 콜백을 정리한다**

아래 3가지를 제거/수정한다:

**(a)** 컴포넌트 상단의 `type Preset` 선언 제거 (이미 모듈 수준에 선언됨):
```tsx
// 이 줄 삭제:
type Preset = 'this_month' | 'last_month' | '3months' | '6months' | 'all' | 'custom';
```

**(b)** `load` 콜백 전체를 아래로 교체 (`const today`, `fmtDate`, 중첩 `getDateRange` 모두 제거):
```tsx
const load = useCallback(async () => {
  setLoading(true);
  try {
    const range = getDateRange(preset, customFrom, customTo);
    const qs = range ? `?from=${range.from}&to=${range.to}` : '';
    const res = await fetch(`/api/cost-management/products${qs}`);
    const json = await res.json();
    if (json.success) {
      setProducts(json.data);
      setSummary(json.summary ?? { total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
    }
  } finally {
    setLoading(false);
  }
}, [preset, customFrom, customTo]);
```

- [ ] **Step 4: 컴포넌트에 분석 관련 state를 추가한다**

`export default function CostManagementTab()` 내부, 기존 state 선언들 아래에 추가:

```tsx
const [apiRevenue, setApiRevenue] = useState<ApiRevenue | null>(null);
const [apiLoading, setApiLoading] = useState(false);
const [apiWarnings, setApiWarnings] = useState<string[]>([]);
```

- [ ] **Step 5: `fetchApiRevenue` 콜백을 추가한다**

`load` 콜백 정의 바로 아래에 추가:

```tsx
const fetchApiRevenue = useCallback(async () => {
  const range = getDateRange(preset, customFrom, customTo);
  if (!range) {
    setApiRevenue(null);
    return;
  }
  setApiLoading(true);
  setApiWarnings([]);
  try {
    const { from, to } = range;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const daysDiff = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    const prevTo = new Date(fromDate.getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - daysDiff * 86_400_000);

    const [currResult, prevResult] = await Promise.all([
      fetchOrdersForPeriod(from, to),
      fetchOrdersForPeriod(toDateStr(prevFrom), toDateStr(prevTo)),
    ]);

    const warnings: string[] = [];
    if (currResult.coupangError) warnings.push(`쿠팡: ${currResult.coupangError}`);
    if (currResult.naverError) warnings.push(`네이버: ${currResult.naverError}`);
    setApiWarnings(warnings);
    setApiRevenue(computeApiRevenue(currResult.orders, prevResult.orders));
  } catch {
    setApiWarnings(['API 매출 조회 중 오류가 발생했습니다.']);
    setApiRevenue(null);
  } finally {
    setApiLoading(false);
  }
}, [preset, customFrom, customTo]);
```

- [ ] **Step 6: `useEffect`를 `fetchApiRevenue`도 함께 트리거하도록 수정한다**

현재:
```tsx
useEffect(() => { load(); }, [load]);
```

변경 후:
```tsx
useEffect(() => { load(); fetchApiRevenue(); }, [load, fetchApiRevenue]);
```

- [ ] **Step 7: JSX — 기간 필터 바로 아래, 기존 요약 카드 위에 섹션 A를 삽입한다**

기존 `{/* 요약 카드 — 기간 집계 */}` 주석 바로 위에 아래 블록을 삽입:

```tsx
      {/* 섹션 A — 실제 매출 (API 기반) */}
      {preset === 'all' ? (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', fontSize: '12px', color: '#92400e' }}>
          전체 기간 선택 시 API 매출 조회는 생략됩니다. 특정 기간을 선택해주세요.
        </div>
      ) : apiLoading ? (
        <div style={{ textAlign: 'center', padding: '24px', color: '#71717a', fontSize: '12px', marginBottom: '12px' }}>
          실제 매출 데이터를 불러오는 중...
        </div>
      ) : (
        <>
          {apiWarnings.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertCircle size={14} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400e' }}>일부 채널 조회 실패</span>
                {apiWarnings.map((w, i) => (
                  <p key={i} style={{ fontSize: '11px', color: '#92400e', margin: '2px 0 0' }}>{w}</p>
                ))}
              </div>
            </div>
          )}
          {apiRevenue && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', marginBottom: '6px' }}>
                실제 매출 <span style={{ fontWeight: 400 }}>(쿠팡 + 네이버 API · 취소/반품 제외)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '10px' }}>
                {/* 총 매출 */}
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>실제 총 매출</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#18181b' }}>{fmtRevenue(apiRevenue.totalRevenue)}원</div>
                  {(() => {
                    const pct = changePct(apiRevenue.totalRevenue, apiRevenue.prevTotalRevenue);
                    return pct !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                        {pct >= 0 ? <TrendingUp size={11} color="#16a34a" /> : <TrendingDown size={11} color="#dc2626" />}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '+' : ''}{pct}%</span>
                        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전기 대비</span>
                      </div>
                    ) : <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>비교 데이터 없음</div>;
                  })()}
                </div>
                {/* 주문 건수 */}
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>주문 건수</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#18181b' }}>{apiRevenue.totalOrders}건</div>
                  {(() => {
                    const pct = changePct(apiRevenue.totalOrders, apiRevenue.prevTotalOrders);
                    return pct !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                        {pct >= 0 ? <TrendingUp size={11} color="#16a34a" /> : <TrendingDown size={11} color="#dc2626" />}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>{pct >= 0 ? '+' : ''}{pct}%</span>
                        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>전기 대비</span>
                      </div>
                    ) : <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>비교 데이터 없음</div>;
                  })()}
                </div>
                {/* 쿠팡 */}
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>쿠팡</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#be0014' }}>{fmtRevenue(apiRevenue.coupangRevenue)}원</div>
                  <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>{apiRevenue.coupangOrders}건</div>
                </div>
                {/* 네이버 */}
                <div style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
                  <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>네이버</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#03c75a' }}>{fmtRevenue(apiRevenue.naverRevenue)}원</div>
                  <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '4px' }}>{apiRevenue.naverOrders}건</div>
                </div>
              </div>
              {/* 취소/반품 */}
              {apiRevenue.cancelCount > 0 && (
                <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '10px' }}>
                  취소/반품 {apiRevenue.cancelCount}건 제외됨
                </div>
              )}
            </>
          )}
        </>
      )}

      <div style={{ height: '1px', background: '#e5e5e5', margin: '4px 0 14px' }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717a', marginBottom: '8px' }}>
        원가·수익 <span style={{ fontWeight: 400 }}>(수동 입력 기반)</span>
      </div>
```

- [ ] **Step 8: TypeScript 컴파일 오류가 없는지 확인한다**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -30
```

오류가 있으면 해당 줄을 수정한다. 예상되는 오류 유형: `ProductRow` 인터페이스와 기존 필드명 불일치, `useCallback` 의존성 배열 경고.

- [ ] **Step 9: 브라우저에서 "수익·원가" 탭 동작을 확인한다**

```
확인 항목:
1. 탭 진입 시 "이번 달" 기간으로 두 섹션 모두 자동 조회됨
2. 섹션 A — 실제 총 매출, 주문 건수, 쿠팡/네이버 금액 카드 표시
3. 구분선 아래 섹션 B — 관리 상품 수, 총 매입비, 기간 총 매출, 실현손익 카드 표시
4. 기간 버튼 변경 시 두 섹션 모두 재조회됨
5. "전체" 기간 선택 시 섹션 A에 경고 문구 표시
6. 쿠팡/네이버 API 미연동 상태면 섹션 A에 경고 배너 표시, 섹션 B/C는 정상
7. 상품 테이블, 드로어, 상품 추가 버튼 모두 기존과 동일하게 동작
```

- [ ] **Step 10: 커밋한다**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost): 수익·원가 탭에 API 실제 매출 섹션 추가"
```

---

## Task 3: AnalyticsTab.tsx 삭제

**Files:**
- Delete: `src/components/orders/AnalyticsTab.tsx`

- [ ] **Step 1: AnalyticsTab.tsx를 git에서 삭제한다**

```bash
git rm src/components/orders/AnalyticsTab.tsx
```

- [ ] **Step 2: 삭제 후 빌드·타입 오류가 없는지 확인한다**

```bash
npx tsc --noEmit 2>&1 | head -20
```

`AnalyticsTab`을 import하는 파일이 남아 있으면 해당 파일도 수정한다. Task 1에서 `OrdersClient.tsx`를 이미 수정했으므로 추가 참조가 없어야 한다.

- [ ] **Step 3: 커밋한다**

```bash
git commit -m "chore(orders): AnalyticsTab.tsx 삭제 (기능이 수익·원가 탭으로 이동)"
```

---

## 최종 검증

- [ ] `/orders` 페이지 접근 시 탭 3개(주문·배송 / 수익·원가 / 채널설정) 표시
- [ ] "주문·배송" 탭: 기존 주문 목록 정상 표시
- [ ] "수익·원가" 탭: 섹션 A(실제 매출) → 구분선 → 섹션 B(원가 요약) → 섹션 C(상품 테이블) 순서로 표시
- [ ] "채널설정" 탭: 변경 없음
- [ ] TypeScript 오류 없음 (`npx tsc --noEmit`)
