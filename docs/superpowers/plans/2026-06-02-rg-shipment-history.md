# 로켓그로스 입고 이력 조회 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로켓그로스 입고 등록 시 이벤트를 기록하고, 수익 원가 탭에서 🕐 팝오버로 이력을 조회할 수 있게 한다.

**Architecture:** DB에 이벤트 테이블 2개를 추가하고, 기존 POST API 트랜잭션 안에 이벤트 INSERT를 추가한다. 별도 GET 엔드포인트로 이력을 조회하며, CostManagementTab의 RG 버튼 옆에 🕐 아이콘을 붙여 팝오버를 렌더링한다.

**Tech Stack:** PostgreSQL (Supabase), Next.js App Router Route Handler, React, Vitest

---

## 파일 구조

| 파일 | 변경 유형 | 역할 |
|------|-----------|------|
| `supabase/migrations/075_rg_shipment_events.sql` | 신규 | rg_shipment_events + rg_shipment_event_items 테이블 생성 |
| `src/app/api/cost-management/rg-shipments/route.ts` | 수정 | GET 추가, POST에 이벤트 INSERT 추가 |
| `src/__tests__/api/rg-shipments.test.ts` | 신규 | GET/POST 이벤트 저장 테스트 |
| `src/components/orders/RgShipmentHistoryPopover.tsx` | 신규 | 입고 이력 팝오버 컴포넌트 |
| `src/components/orders/CostManagementTab.tsx` | 수정 | RG 버튼 그룹화 + 팝오버 렌더링 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/075_rg_shipment_events.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/075_rg_shipment_events.sql
BEGIN;

CREATE TABLE IF NOT EXISTS rg_shipment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  shipped_at         date NOT NULL,
  total_shipping_fee integer NOT NULL CHECK (total_shipping_fee >= 0),
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_shipment_events_user
  ON rg_shipment_events (user_id, shipped_at DESC);

CREATE TABLE IF NOT EXISTS rg_shipment_event_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_event_id uuid REFERENCES rg_shipment_events(id) ON DELETE CASCADE,
  product_cost_id   uuid NOT NULL,
  product_name      text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_rg_fee       integer NOT NULL CHECK (unit_rg_fee >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rg_shipment_event_items_event
  ON rg_shipment_event_items (shipment_event_id);

COMMIT;
```

- [ ] **Step 2: 로컬 Supabase에 마이그레이션 적용**

```bash
npx supabase db push
```

Expected: 에러 없이 완료. 프로덕션 Supabase 대시보드에서 직접 SQL 실행해도 됨.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/075_rg_shipment_events.sql
git commit -m "feat: rg_shipment_events 테이블 추가"
```

---

## Task 2: GET API — 이력 조회 엔드포인트

**Files:**
- Modify: `src/app/api/cost-management/rg-shipments/route.ts`
- Test: `src/__tests__/api/rg-shipments.test.ts`

- [ ] **Step 1: 테스트 파일 생성 (실패 확인용)**

```typescript
// src/__tests__/api/rg-shipments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeGetRequest(params = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/rg-shipments${params}`,
    { method: 'GET' }
  );
}

describe('GET /api/cost-management/rg-shipments', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('이벤트 없으면 빈 배열 반환', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('이벤트 목록을 반환한다', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'event-uuid-1',
          shipped_at: '2026-05-28',
          total_shipping_fee: 22750,
          created_at: '2026-05-28T10:00:00Z',
          items: [
            { product_name: '상품A', quantity: 100, unit_rg_fee: 152 },
          ],
        },
      ],
    });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await GET(makeGetRequest());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].shipped_at).toBe('2026-05-28');
    expect(json.data[0].items[0].product_name).toBe('상품A');
  });

  it('limit 파라미터가 쿼리에 반영된다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { GET } = await import('@/app/api/cost-management/rg-shipments/route');
    await GET(makeGetRequest('?limit=5'));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT/i);
    expect(params).toContain(5);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/rg-shipments.test.ts
```

Expected: `GET` is not a function — GET 핸들러가 아직 없으므로 실패

- [ ] **Step 3: GET 핸들러 구현**

`src/app/api/cost-management/rg-shipments/route.ts` 파일에서 **기존 `POST` 함수 바로 위**에 아래 함수를 추가한다. import와 interface는 이미 파일에 있으므로 건드리지 않는다.

```typescript
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         e.id,
         e.shipped_at::text,
         e.total_shipping_fee,
         e.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'product_name', i.product_name,
               'quantity',     i.quantity,
               'unit_rg_fee',  i.unit_rg_fee
             ) ORDER BY i.product_name
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS items
       FROM rg_shipment_events e
       LEFT JOIN rg_shipment_event_items i ON i.shipment_event_id = e.id
       WHERE e.user_id = $1
       GROUP BY e.id
       ORDER BY e.shipped_at DESC, e.created_at DESC
       LIMIT $2`,
      [user.userId, limit],
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('[rg-shipments GET]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
```

> 기존 `POST` 함수는 그대로 유지. GET만 파일 상단에 추가.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/rg-shipments.test.ts
```

Expected: 4개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/rg-shipments/route.ts \
        src/__tests__/api/rg-shipments.test.ts
git commit -m "feat: GET /api/cost-management/rg-shipments 이력 조회 엔드포인트 추가"
```

---

## Task 3: POST API 수정 — 이벤트 기록 추가

**Files:**
- Modify: `src/app/api/cost-management/rg-shipments/route.ts`
- Test: `src/__tests__/api/rg-shipments.test.ts`

- [ ] **Step 1: POST 이벤트 저장 테스트 추가**

`src/__tests__/api/rg-shipments.test.ts` 파일 끝에 아래 describe 블록 추가:

```typescript
function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/cost-management/rg-shipments',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/cost-management/rg-shipments — 이벤트 저장', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    // 쿼리 순서:
    // 0: BEGIN
    // 1: ownerCheck (id + product_name)
    // 2: stockRows
    // 3: batches
    // 4: UPDATE cost_entries (FIFO — 단일 배치 전량 소진)
    // 5: INSERT rg_shipment_events → event id 반환
    // 6: INSERT rg_shipment_event_items
    // 7: COMMIT
    mockClient.query
      .mockResolvedValueOnce({})                                                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'prod-uuid', product_name: '상품A' }] }) // ownerCheck
      .mockResolvedValueOnce({ rows: [{ total_stock: 100 }] })                    // stockRows
      .mockResolvedValueOnce({ rows: [{ id: 'entry-uuid-1', quantity: 100 }] })  // batches
      .mockResolvedValueOnce({})                                                  // UPDATE cost_entries
      .mockResolvedValueOnce({ rows: [{ id: 'event-uuid-1' }] })                 // INSERT rg_shipment_events
      .mockResolvedValueOnce({})                                                  // INSERT rg_shipment_event_items
      .mockResolvedValueOnce({});                                                 // COMMIT

    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) });
  });

  it('유효한 요청 시 rg_shipment_events에 INSERT됨', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(
      makePostRequest({
        shipped_at: '2026-05-28',
        total_shipping_fee: 15200,
        items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
      })
    );
    expect(res.status).toBe(200);
    const allSql = mockClient.query.mock.calls.map(([sql]: [string]) => sql);
    expect(allSql.some((s) => /INSERT INTO rg_shipment_events/i.test(s))).toBe(true);
    expect(allSql.some((s) => /INSERT INTO rg_shipment_event_items/i.test(s))).toBe(true);
  });

  it('INSERT 실패 시 트랜잭션 롤백됨', async () => {
    // INSERT rg_shipment_events에서 에러 발생
    mockClient.query
      .mockResolvedValueOnce({})                                                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'prod-uuid', product_name: '상품A' }] })
      .mockResolvedValueOnce({ rows: [{ total_stock: 100 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'entry-uuid-1', quantity: 100 }] })
      .mockResolvedValueOnce({})                                                  // UPDATE cost_entries
      .mockRejectedValueOnce(new Error('DB error'))                              // INSERT rg_shipment_events 실패
      .mockResolvedValueOnce({});                                                 // ROLLBACK

    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(
      makePostRequest({
        shipped_at: '2026-05-28',
        total_shipping_fee: 15200,
        items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
      })
    );
    expect(res.status).toBe(500);
    const allSql = mockClient.query.mock.calls.map(([sql]: [string]) => sql);
    expect(allSql.some((s) => /ROLLBACK/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/rg-shipments.test.ts
```

Expected: POST 이벤트 저장 테스트 2개 FAIL (rg_shipment_events INSERT 없음)

- [ ] **Step 3: POST 핸들러 수정**

`src/app/api/cost-management/rg-shipments/route.ts`의 기존 `POST` 함수에서 변경점 2곳:

**(A) ownerCheck 쿼리에 `product_name` 추가 + 이름 저장 Map 선언**

기존:
```typescript
// FIFO 배치 목록 (received_at ASC) 바로 위에 있는 for 루프 앞 부분
const { rows: ownerCheck } = await client.query(
  `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
  [product_cost_id, user.userId],
);
```

변경 후 — `POST` 함수 안, `let affectedEntries = 0;` 바로 위에 Map 선언 추가:
```typescript
const productNames = new Map<string, string>();
let affectedEntries = 0;
let splitEntries = 0;
```

그리고 ownerCheck 쿼리를 아래와 같이 변경:
```typescript
const { rows: ownerCheck } = await client.query(
  `SELECT id, product_name FROM product_costs WHERE id = $1 AND user_id = $2`,
  [product_cost_id, user.userId],
);
if (ownerCheck.length === 0) {
  await client.query('ROLLBACK');
  return NextResponse.json({ success: false, error: `product_cost_id ${product_cost_id} not found` }, { status: 404 });
}
productNames.set(product_cost_id, ownerCheck[0].product_name as string);
```

**(B) FIFO for 루프 완료 후, COMMIT 직전에 이벤트 INSERT 추가**

기존:
```typescript
await client.query('COMMIT');
return NextResponse.json({ success: true, data: { affected_entries: affectedEntries, split_entries: splitEntries } });
```

변경 후:
```typescript
// 입고 이벤트 기록
const { rows: eventRows } = await client.query(
  `INSERT INTO rg_shipment_events (user_id, shipped_at, total_shipping_fee)
   VALUES ($1, $2, $3) RETURNING id`,
  [user.userId, shipped_at, total_shipping_fee],
);
const eventId = eventRows[0].id as string;

for (const item of items as RgShipmentItem[]) {
  await client.query(
    `INSERT INTO rg_shipment_event_items
       (shipment_event_id, product_cost_id, product_name, quantity, unit_rg_fee)
     VALUES ($1, $2, $3, $4, $5)`,
    [eventId, item.product_cost_id, productNames.get(item.product_cost_id) ?? '', item.quantity, item.unit_rg_fee],
  );
}

await client.query('COMMIT');
return NextResponse.json({ success: true, data: { affected_entries: affectedEntries, split_entries: splitEntries } });
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/rg-shipments.test.ts
```

Expected: 전체 6개 테스트 PASS

- [ ] **Step 5: 전체 테스트 이상 없음 확인**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 기존 테스트 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/rg-shipments/route.ts \
        src/__tests__/api/rg-shipments.test.ts
git commit -m "feat: POST rg-shipments — 이벤트 INSERT 추가"
```

---

## Task 4: RgShipmentHistoryPopover 컴포넌트

**Files:**
- Create: `src/components/orders/RgShipmentHistoryPopover.tsx`

- [ ] **Step 1: 컴포넌트 파일 생성**

```typescript
// src/components/orders/RgShipmentHistoryPopover.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ShipmentEventItem {
  product_name: string;
  quantity: number;
  unit_rg_fee: number;
}

interface ShipmentEvent {
  id: string;
  shipped_at: string;
  total_shipping_fee: number;
  created_at: string;
  items: ShipmentEventItem[];
}

interface Props {
  onClose: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export default function RgShipmentHistoryPopover({ onClose }: Props) {
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/cost-management/rg-shipments?limit=20')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setEvents(json.data as ShipmentEvent[]);
        else setError(json.error ?? '조회 실패');
      })
      .catch(() => setError('네트워크 오류'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '6px',
        width: '340px', background: '#fff', borderRadius: '12px',
        border: '1px solid #bae6fd', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}
    >
      {/* 헤더 */}
      <div style={{ padding: '12px 16px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>📋 로켓그로스 입고 이력</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#7dd3fc' }}>최근 20건</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
            <X size={14} color="#7dd3fc" />
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#71717a' }}>
            불러오는 중...
          </div>
        )}
        {error && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
            {error}
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: '#a1a1aa' }}>
            아직 등록된 입고 이력이 없습니다
          </div>
        )}
        {events.map((event, idx) => {
          const totalQty = event.items.reduce((s, i) => s + i.quantity, 0);
          return (
            <div
              key={event.id}
              style={{ padding: '12px 16px', borderBottom: idx < events.length - 1 ? '1px solid #f0f9ff' : 'none' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>{event.shipped_at}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '10px' }}>
                  총 {fmt(event.total_shipping_fee)}원
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', color: '#52525b' }}>
                <thead>
                  <tr style={{ color: '#a1a1aa', borderBottom: '1px solid #f0f9ff' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>상품명</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>수량</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>단위배송비</th>
                  </tr>
                </thead>
                <tbody>
                  {event.items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 4px' }}>{item.product_name}</td>
                      <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 600, color: '#0369a1' }}>{fmt(item.quantity)}개</td>
                      <td style={{ textAlign: 'right', padding: '3px 4px', color: '#0369a1' }}>{fmt(item.unit_rg_fee)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ textAlign: 'right', fontSize: '10px', color: '#bae6fd', marginTop: '6px' }}>
                총 {fmt(totalQty)}개
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep RgShipmentHistoryPopover
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/components/orders/RgShipmentHistoryPopover.tsx
git commit -m "feat: RgShipmentHistoryPopover 컴포넌트 추가"
```

---

## Task 5: CostManagementTab — 버튼 그룹화 + 팝오버 연결

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: import 추가**

`src/components/orders/CostManagementTab.tsx` 상단 import 목록에 추가:

```typescript
import RgShipmentHistoryPopover from './RgShipmentHistoryPopover';
```

- [ ] **Step 2: state + ref 추가**

기존 `useState` 선언들 끝 부분에 추가 (예: `showRgModal` 선언 바로 다음):

```typescript
const [showRgHistory, setShowRgHistory] = useState(false);
const rgBtnGroupRef = useRef<HTMLDivElement>(null);
```

> `useRef`는 이미 파일 상단에 import되어 있음.

- [ ] **Step 3: RG 버튼을 버튼 그룹으로 교체**

기존 독립 버튼:
```typescript
<button
  onClick={() => setShowRgModal(true)}
  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '12px', cursor: 'pointer' }}
>
  <Package size={13} /> 로켓그로스 입고 등록
</button>
```

교체 후:
```typescript
<div ref={rgBtnGroupRef} style={{ position: 'relative', display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #bae6fd' }}>
  <button
    onClick={() => setShowRgModal(true)}
    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: '#fff', color: '#0369a1', border: 'none', fontSize: '12px', cursor: 'pointer' }}
  >
    <Package size={13} /> 로켓그로스 입고 등록
  </button>
  <button
    onClick={() => setShowRgHistory((prev) => !prev)}
    style={{
      padding: '8px 10px',
      background: showRgHistory ? '#e0f2fe' : '#f0f9ff',
      color: '#0369a1', border: 'none', borderLeft: '1px solid #bae6fd',
      fontSize: '13px', cursor: 'pointer', fontWeight: 700,
    }}
    title="입고 이력 보기"
  >
    🕐
  </button>
  {showRgHistory && (
    <RgShipmentHistoryPopover onClose={() => setShowRgHistory(false)} />
  )}
</div>
```

- [ ] **Step 4: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep CostManagementTab
```

Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: 수익 원가 탭 — RG 입고 이력 팝오버 연결"
```

---

## Task 6: 수동 동작 확인

- [ ] **Step 1: 개발 서버 시작**

```bash
npm run dev
```

- [ ] **Step 2: 주문매출 > 수익 원가 탭 접속**

- RG 버튼 오른쪽에 🕐 아이콘이 붙어 있는지 확인
- 🕐 클릭 → "아직 등록된 입고 이력이 없습니다" 표시 확인
- 팝오버 외부 클릭 시 닫히는지 확인

- [ ] **Step 3: 입고 등록 후 이력 확인**

- "📦 로켓그로스 입고 등록" 클릭 → 정상적으로 등록
- 등록 완료 후 🕐 클릭 → 방금 등록한 이벤트가 이력에 표시되는지 확인
- 날짜 / 총 배송비 / 상품별 수량·단위배송비 모두 올바른지 확인

- [ ] **Step 4: 최종 테스트 풀 실행**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: 전체 테스트 통과
