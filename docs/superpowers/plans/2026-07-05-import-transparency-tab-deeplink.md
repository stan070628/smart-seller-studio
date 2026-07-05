# 임포트 투명성 + 서브탭 URL 딥링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주문/매출 > 수익·원가 화면에서 (1) 서브탭 선택을 URL `?tab=` 파라미터로 딥링크·새로고침 유지하고, (2) "판매 가져오기" 임포트 결과를 채널별(신규/스킵/실패) 구조화 패널로 표시하며 마지막 동기화 시각을 노출한다.

**Architecture:** 탭 동기화는 기존 `ListingDashboard`가 쓰는 `useSearchParams`+`router.replace` 패턴을 그대로 이식한다(`OrdersClient`를 Suspense 경계로 감싼 뒤 내부 컴포넌트에서 URL 동기화). 임포트 결과는 3개 bulk-import 라우트가 이미 반환하는 `{ imported, skipped, total }`/`error`를 순수 함수 `buildImportSummary()`로 집계하고, `CostManagementTab`이 그 결과를 `alert()` 대신 dismissible 패널로 렌더한다.

**Tech Stack:** Next.js 16.2.1 (App Router, `next/navigation`), React 19, TypeScript, Vitest + React Testing Library.

---

## File Structure

- **Create** `src/components/orders/import-summary.ts` — 순수 집계 헬퍼 `buildImportSummary()` + 타입. 외부 의존성 없음. 단위 테스트 대상.
- **Modify** `src/components/orders/OrdersClient.tsx` — Suspense 래퍼 + 내부 컴포넌트로 분리, URL `?tab=` 초기화/동기화 추가.
- **Modify** `src/components/orders/CostManagementTab.tsx` — `runAllBulkImport`이 `buildImportSummary` 사용, `alert()` 제거, 결과 패널 + 마지막 동기화 시각 렌더.
- **Create** `src/__tests__/components/import-summary.test.ts` — 헬퍼 단위 테스트.
- **Create** `src/__tests__/components/orders-client-tabs.test.tsx` — 탭 URL 동기화 컴포넌트 테스트.

> **테스트 실행 주의:** 이 저장소는 인자 없는 `npx vitest run`이 `node_modules.nosync` 관련 라이브러리 테스트까지 돌려 대량 선재 실패가 난다. **반드시 파일 경로를 지정**해 실행한다.

---

## Task 1: 임포트 결과 집계 헬퍼 (`buildImportSummary`)

**Files:**
- Create: `src/components/orders/import-summary.ts`
- Test: `src/__tests__/components/import-summary.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/__tests__/components/import-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildImportSummary } from '@/components/orders/import-summary';

describe('buildImportSummary', () => {
  it('세 채널 모두 성공하면 채널별 결과와 총 신규 건수를 집계한다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 3, skipped: 1, total: 4 } } },
      { channel: '윙', json: { success: true, data: { imported: 2, skipped: 0, total: 2 } } },
      { channel: '네이버', json: { success: true, data: { imported: 0, skipped: 5, total: 5 } } },
    ]);
    expect(summary.channels).toEqual([
      { channel: 'RG', success: true, imported: 3, skipped: 1, total: 4 },
      { channel: '윙', success: true, imported: 2, skipped: 0, total: 2 },
      { channel: '네이버', success: true, imported: 0, skipped: 5, total: 5 },
    ]);
    expect(summary.totalImported).toBe(5);
    expect(summary.hasError).toBe(false);
  });

  it('실패한 채널은 error를 담고 hasError를 true로 만든다', () => {
    const summary = buildImportSummary([
      { channel: 'RG', json: { success: true, data: { imported: 1, skipped: 0, total: 1 } } },
      { channel: '윙', json: { success: false, error: '토큰 만료' } },
    ]);
    expect(summary.channels[1]).toEqual({
      channel: '윙', success: false, imported: 0, skipped: 0, total: 0, error: '토큰 만료',
    });
    expect(summary.hasError).toBe(true);
    expect(summary.totalImported).toBe(1);
  });

  it('data가 없거나 error가 없어도 안전한 기본값을 채운다', () => {
    const summary = buildImportSummary([
      { channel: '네이버', json: { success: false } },
    ]);
    expect(summary.channels[0]).toEqual({
      channel: '네이버', success: false, imported: 0, skipped: 0, total: 0, error: '실패',
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/components/import-summary.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/orders/import-summary"` (모듈 없음).

- [ ] **Step 3: 헬퍼 구현**

Create `src/components/orders/import-summary.ts`:

```ts
export interface BulkImportJson {
  success: boolean;
  data?: { imported: number; skipped: number; total: number };
  error?: string;
}

export interface ChannelImportResult {
  channel: string;
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
  error?: string;
}

export interface ImportSummary {
  channels: ChannelImportResult[];
  totalImported: number;
  hasError: boolean;
}

export function buildImportSummary(
  results: { channel: string; json: BulkImportJson }[],
): ImportSummary {
  const channels: ChannelImportResult[] = results.map(({ channel, json }) => {
    if (json.success) {
      return {
        channel,
        success: true,
        imported: json.data?.imported ?? 0,
        skipped: json.data?.skipped ?? 0,
        total: json.data?.total ?? 0,
      };
    }
    return {
      channel,
      success: false,
      imported: 0,
      skipped: 0,
      total: 0,
      error: json.error ?? '실패',
    };
  });

  return {
    channels,
    totalImported: channels.reduce((sum, c) => sum + c.imported, 0),
    hasError: channels.some((c) => !c.success),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/components/import-summary.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/import-summary.ts src/__tests__/components/import-summary.test.ts
git commit -m "feat(cost-management): 임포트 결과 집계 헬퍼 buildImportSummary 추가"
```

---

## Task 2: 서브탭 URL 딥링크 (`OrdersClient`)

**Files:**
- Modify: `src/components/orders/OrdersClient.tsx`
- Test: `src/__tests__/components/orders-client-tabs.test.tsx`

배경: `OrdersClient`는 서버 컴포넌트 `src/app/orders/page.tsx`가 직접 렌더한다. Next 16에서 `useSearchParams()`를 쓰는 클라이언트 컴포넌트는 `<Suspense>` 경계 안에 있어야 하므로, `OrdersClient`(export)는 Suspense 래퍼로 두고 실제 로직은 내부 컴포넌트 `OrdersClientInner`로 분리한다. 탭 동기화는 `ListingDashboard.tsx:2224-2232`의 `goTab` 패턴을 그대로 따른다. 기본 탭 `orders`는 파라미터를 넣지 않고, `cost`/`channels`만 `?tab=`에 기록한다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/__tests__/components/orders-client-tabs.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const replaceMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/orders',
}));

// 하위 탭 컴포넌트는 네트워크/무거운 로직을 가지므로 렌더만 확인되도록 스텁 처리
vi.mock('@/components/orders/OrdersTab', () => ({ default: () => <div>주문탭내용</div> }));
vi.mock('@/components/orders/CostManagementTab', () => ({ default: () => <div>수익원가탭내용</div> }));
vi.mock('@/components/orders/ChannelsTab', () => ({ default: () => <div>채널설정탭내용</div> }));

import OrdersClient from '@/components/orders/OrdersClient';

describe('OrdersClient — 서브탭 URL 동기화', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    for (const k of Array.from(searchParams.keys())) searchParams.delete(k);
  });

  it('기본은 주문·배송 탭을 렌더한다', () => {
    render(<OrdersClient />);
    expect(screen.getByText('주문탭내용')).toBeInTheDocument();
  });

  it('수익·원가 탭 클릭 시 URL ?tab=cost 로 동기화된다', () => {
    render(<OrdersClient />);
    fireEvent.click(screen.getByRole('button', { name: /수익·원가/ }));
    expect(replaceMock).toHaveBeenCalledWith('/orders?tab=cost', { scroll: false });
  });

  it('주문·배송 탭 클릭 시 tab 파라미터를 제거한다', () => {
    searchParams.set('tab', 'cost');
    render(<OrdersClient />);
    fireEvent.click(screen.getByRole('button', { name: /주문·배송/ }));
    expect(replaceMock).toHaveBeenCalledWith('/orders', { scroll: false });
  });

  it('URL ?tab=channels 로 진입하면 채널설정 탭을 렌더한다', () => {
    searchParams.set('tab', 'channels');
    render(<OrdersClient />);
    expect(screen.getByText('채널설정탭내용')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/components/orders-client-tabs.test.tsx`
Expected: FAIL — `?tab=cost` 동기화가 없어 `replaceMock` 미호출 / 초기 탭 동기화 없음.

- [ ] **Step 3: `OrdersClient` 구현 수정**

Replace the entire contents of `src/components/orders/OrdersClient.tsx` with:

```tsx
'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
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

function OrdersClientInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('orders');

  // URL ?tab= 파라미터에서 초기 탭 동기화
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'cost' || tab === 'channels') setActiveSubTab(tab);
    else setActiveSubTab('orders');
  }, [searchParams]);

  // 탭 전환 + URL 동기화 헬퍼 — 기본 탭(orders)은 파라미터를 제거
  const goTab = (id: SubTab) => {
    setActiveSubTab(id);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (id === 'orders') params.delete('tab');
    else params.set('tab', id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div style={{ backgroundColor: '#f5f5f7', minHeight: '100%' }}>
      <main style={{ width: '100%', padding: '28px 24px' }}>
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
              onClick={() => goTab(tab.id)}
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

export default function OrdersClient() {
  return (
    <Suspense fallback={null}>
      <OrdersClientInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/components/orders-client-tabs.test.tsx`
Expected: PASS (4 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/OrdersClient.tsx src/__tests__/components/orders-client-tabs.test.tsx
git commit -m "feat(cost-management): 주문/매출 서브탭 URL ?tab= 딥링크 동기화"
```

---

## Task 3: 임포트 결과 패널 + 마지막 동기화 시각 (`CostManagementTab`)

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx` (import 추가, state 추가, `runAllBulkImport` 교체, 렌더 2곳 추가)

이 태스크는 화면 통합이라 위 두 태스크처럼 격리된 단위 테스트를 붙이기 어렵다. 대신 (a) 헬퍼는 Task 1에서 이미 검증됨, (b) 타입/빌드 회귀는 `tsc`로 검증한다.

- [ ] **Step 1: 헬퍼 import 추가**

`src/components/orders/CostManagementTab.tsx` 상단 import 블록에 추가:

```ts
import { buildImportSummary, type ImportSummary } from './import-summary';
```

- [ ] **Step 2: state 추가**

`const [importingAll, setImportingAll] = useState(false);` (현재 214행) 바로 아래에 추가:

```ts
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
```

- [ ] **Step 3: `runAllBulkImport` 교체 (alert 제거 → 구조화 결과)**

현재 `runAllBulkImport` 함수 전체(271~312행: `async function runAllBulkImport() { ... }`)를 아래로 교체:

```ts
  async function runAllBulkImport() {
    setImportingAll(true);
    try {
      const range = getDateRange(preset, customFrom, customTo);
      const [rgRes, wingRes, naverRes] = await Promise.all([
        fetch('/api/cost-management/rg-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        fetch('/api/cost-management/wing-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(range ?? {}),
        }),
        fetch('/api/cost-management/naver-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(range ?? {}),
        }),
      ]);
      const [rgJson, wingJson, naverJson] = await Promise.all([
        rgRes.json(), wingRes.json(), naverRes.json(),
      ]);

      const summary = buildImportSummary([
        { channel: 'RG', json: rgJson },
        { channel: '윙', json: wingJson },
        { channel: '네이버', json: naverJson },
      ]);
      setImportResult(summary);
      setLastSyncedAt(
        new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      );
      load();
    } finally {
      setImportingAll(false);
    }
  }
```

- [ ] **Step 4: 마지막 동기화 시각 표기 추가**

"판매 가져오기" 버튼 블록(현재 1074~1080행 `<button onClick={runAllBulkImport} ...> ... </button>`) 바로 뒤에 추가:

```tsx
        {lastSyncedAt && (
          <span style={{ fontSize: '11px', color: '#a1a1aa', alignSelf: 'center' }}>
            마지막 동기화 {lastSyncedAt}
          </span>
        )}
```

- [ ] **Step 5: 임포트 결과 패널 렌더 추가**

`undoToast` 렌더 블록(현재 1208행 `{undoToast && ( ... )}`) **바로 위**에 추가:

```tsx
      {importResult && (
        <div style={{
          position: 'fixed', bottom: 84, right: 24,
          background: '#fff', color: '#18181b',
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
          zIndex: 9999, minWidth: 260, maxWidth: 340,
          border: '1px solid #e5e5e5',
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              판매 가져오기 — 신규 {importResult.totalImported}건
            </span>
            <button
              onClick={() => setImportResult(null)}
              aria-label="닫기"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a1a1aa', fontSize: 16, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {importResult.channels.map((c) => (
              <div key={c.channel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#52525b', fontWeight: 600 }}>{c.channel}</span>
                {c.success ? (
                  <span style={{ color: '#16a34a' }}>
                    신규 {c.imported} · 스킵 {c.skipped}
                  </span>
                ) : (
                  <span style={{ color: '#ef4444' }}>실패 — {c.error}</span>
                )}
              </div>
            ))}
          </div>
          {importResult.hasError && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#d97706' }}>
              일부 채널 조회에 실패했습니다. 채널 설정/토큰을 확인해 주세요.
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: 타입/빌드 회귀 확인**

Run: `npx tsc --noEmit`
Expected: PASS — 신규 에러 없음. (기존 에러가 있다면 이 diff와 무관함을 확인.)

- [ ] **Step 7: 기존 테스트 스모크 확인**

Run: `npx vitest run src/__tests__/components/import-summary.test.ts src/__tests__/components/orders-client-tabs.test.tsx`
Expected: PASS (전체 7 passed).

- [ ] **Step 8: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(cost-management): 판매 가져오기 결과를 구조화 패널로 표시 + 마지막 동기화 시각"
```

---

## Task 4: 수동 검증 (dev 서버)

- [ ] **Step 1: dev 서버 실행 후 확인**

Run: `npm run dev` (이미 떠 있으면 생략)

수동 체크리스트:
1. `/orders` 진입 → 기본 '주문·배송' 탭. 주소창에 `tab` 없음.
2. '수익·원가' 클릭 → 주소창이 `/orders?tab=cost`로 바뀜. **새로고침해도 '수익·원가' 유지.**
3. `/orders?tab=channels` 직접 입력 → '채널설정' 탭으로 진입.
4. '수익·원가'에서 '판매 가져오기' 클릭 → 완료 후 우하단에 채널별(RG/윙/네이버) 신규·스킵 패널 표시, `alert` 뜨지 않음. × 로 닫힘.
5. 버튼 옆 "마지막 동기화 M/D HH:MM" 노출.

- [ ] **Step 2: 검증 결과 기록**

문제 없으면 이 태스크 완료. 문제가 있으면 해당 Task로 돌아가 수정 후 재검증.

---

## Self-Review 노트

- **스펙 커버리지(§1.2):** 임포트 결과 요약 피드백(Task 1·3), 서브탭 URL 딥링크(Task 2), 마지막 동기화 시각(Task 3), 부분 실패 채널 표시(Task 1 `hasError` + Task 3 패널). 커버됨.
- **범위 밖(의도적 제외):** 임포트 진행 중 채널별 스텝 인디케이터(§1.2의 세부 항목)는 병렬 `Promise.all` 특성상 단계 표현이 부정확해 이번 스코프에서 제외. 완료 결과 투명성에 집중.
- **타입 일관성:** `ImportSummary`/`ChannelImportResult`/`BulkImportJson`은 Task 1에서 정의하고 Task 3에서 동일 이름으로 사용. bulk-import 라우트 3종의 실제 응답(`{ imported, skipped, total }` / `{ error }`)과 일치.
