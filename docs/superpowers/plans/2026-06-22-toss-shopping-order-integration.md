# 토스쇼핑 주문 조회 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 토스쇼핑 주문 내역을 쿠팡/네이버와 동일한 `OrdersTab` 화면에 통합 표시한다.

**Architecture:** 기존 coupang/naver 패턴을 그대로 따른다. `toss-shopping-client.ts`에서 Bearer JWT 인증으로 API 호출, `/api/orders/toss/route.ts`에서 캐싱 후 정규화, `OrdersTab.tsx`에서 병렬 fetch로 통합 렌더링한다.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Toss Shopping API v3 (`https://shopping-fep.toss.im`)

---

## 파일 맵

| 작업 | 파일 |
|------|------|
| 신규 | `src/lib/listing/toss-shopping-client.ts` |
| 신규 | `src/app/api/orders/toss/route.ts` |
| 신규 | `src/__tests__/api/toss-orders.test.ts` |
| 수정 | `src/types/orders.ts` — `OrderPlatform` + `PLATFORM_INFO`에 `'toss'` 추가 |
| 수정 | `src/components/orders/OrdersTab.tsx` — 상태맵, 타입, fetch, 에러 UI 추가 |
| 수정 | `.env.local.example` — `TOSS_SHOPPING_ACCESS_TOKEN` 항목 추가 |

---

### Task 1: 환경 변수 추가

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: .env.local.example에 토스쇼핑 토큰 항목 추가**

`.env.local.example` 파일에서 `CRON_SECRET=` 아래에 다음 블록을 추가한다:

```
# ─────────────────────────────────────────
# 토스쇼핑 Open API
# https://shopping-docs.toss.im/dev/api-2/auth
# ─────────────────────────────────────────
TOSS_SHOPPING_ACCESS_TOKEN=your-toss-shopping-access-token
```

- [ ] **Step 2: .env.local에 빈 값으로 항목 추가** (실제 토큰은 나중에 입력)

`.env.local`에 동일한 항목을 빈 값으로 추가한다:
```
TOSS_SHOPPING_ACCESS_TOKEN=
```

- [ ] **Step 3: 커밋**

```bash
git add .env.local.example
git commit -m "chore: add TOSS_SHOPPING_ACCESS_TOKEN env placeholder"
```

---

### Task 2: OrderPlatform 타입에 'toss' 추가

**Files:**
- Modify: `src/types/orders.ts:5`

- [ ] **Step 1: OrderPlatform에 'toss' 추가**

`src/types/orders.ts` 5번째 줄:

```typescript
// 변경 전
export type OrderPlatform = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee' | 'rocket_growth';

// 변경 후
export type OrderPlatform = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee' | 'rocket_growth' | 'toss';
```

- [ ] **Step 2: PLATFORM_INFO에 'toss' 항목 추가**

`src/types/orders.ts`의 `PLATFORM_INFO` 객체 마지막 `rocket_growth` 항목 뒤에 추가:

```typescript
  toss: { label: '토스쇼핑', color: '#3182F6' },
```

완성된 객체:
```typescript
export const PLATFORM_INFO: Record<OrderPlatform, { label: string; color: string }> = {
  coupang: { label: '쿠팡', color: '#be0014' },
  naver: { label: '네이버', color: '#03c75a' },
  gmarket: { label: 'G마켓', color: '#6dbe46' },
  elevenst: { label: '11번가', color: '#ff0038' },
  shopee: { label: 'Shopee', color: '#ee4d2d' },
  rocket_growth: { label: '로켓그로스', color: '#15803d' },
  toss: { label: '토스쇼핑', color: '#3182F6' },
};
```

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음 (또는 기존 에러만)

- [ ] **Step 4: 커밋**

```bash
git add src/types/orders.ts
git commit -m "feat(types): add 'toss' to OrderPlatform and PLATFORM_INFO"
```

---

### Task 3: 토스쇼핑 API 클라이언트

**Files:**
- Create: `src/lib/listing/toss-shopping-client.ts`

**API 정보:**
- Endpoint: `GET https://shopping-fep.toss.im/api/v3/shopping-fep/orders/v2`
- Auth: `Authorization: Bearer {ACCESS_TOKEN}`
- Params: `startDate` (yyyy-MM-dd, 필수), `endDate` (yyyy-MM-dd, 필수, 최대 31일), `status?`, `limit` (max 50), `nextCursor?`
- Response: `{ resultType: 'SUCCESS'|'FAIL', success?: { orders: TossOrder[], nextCursor?: string }, error?: { errorCode: string, reason: string } }`

- [ ] **Step 1: 파일 생성**

`src/lib/listing/toss-shopping-client.ts` 파일 전체 내용:

```typescript
import { proxyFetch } from '@/lib/proxy-fetch';

const API_HOST = 'https://shopping-fep.toss.im';
const MAX_PAGES = 20; // 무한 루프 방지 상한

export interface TossOrder {
  orderId: number;
  orderProductId: number;
  orderedAt: string;
  ordererName: string;
  ordererPhone: string;
  productName: string;
  optionName: string;
  quantity: number;
  price: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  detailAddress: string;
  zipCode: string;
  deliveryCompanyCode: string;
  shippingTrackingNumber: string;
  deliveryFee: number;
  orderProductStatus: string;
  canceledAt: string | null;
  confirmedAt: string | null;
}

interface TossApiResponse<T> {
  resultType: 'SUCCESS' | 'FAIL';
  success?: T;
  error?: { errorCode: string; reason: string };
}

interface TossOrderListSuccess {
  orders: TossOrder[];
  nextCursor?: string;
}

export class TossShoppingClient {
  private readonly accessToken: string;

  constructor() {
    this.accessToken = process.env.TOSS_SHOPPING_ACCESS_TOKEN ?? '';
    if (!this.accessToken) {
      throw new Error('[토스쇼핑] TOSS_SHOPPING_ACCESS_TOKEN 환경변수가 필요합니다.');
    }
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<TossApiResponse<T>> {
    const url = new URL(`${API_HOST}${path}`);
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

    const res = await proxyFetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    console.log(`[toss-shopping] GET ${path} → HTTP ${res.status} | ${text.slice(0, 300)}`);

    if (!res.ok) {
      throw new Error(`토스쇼핑 API 오류 (${res.status}): ${text.slice(0, 200)}`);
    }

    return JSON.parse(text) as TossApiResponse<T>;
  }

  async getOrders(params: {
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd (startDate로부터 최대 31일)
    status?: string;
  }): Promise<TossOrder[]> {
    const allOrders: TossOrder[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const queryParams: Record<string, string> = {
        startDate: params.startDate,
        endDate: params.endDate,
        limit: '50',
      };
      if (params.status) queryParams.status = params.status;
      if (cursor) queryParams.nextCursor = cursor;

      const res = await this.request<TossOrderListSuccess>(
        '/api/v3/shopping-fep/orders/v2',
        queryParams,
      );

      if (res.resultType === 'FAIL' || !res.success) {
        const code = res.error?.errorCode ?? 'UNKNOWN';
        const reason = res.error?.reason ?? '알 수 없는 오류';
        throw new Error(`토스쇼핑 주문 조회 실패 (${code}): ${reason}`);
      }

      allOrders.push(...(res.success.orders ?? []));
      cursor = res.success.nextCursor;
      pages++;
    } while (cursor && pages < MAX_PAGES);

    return allOrders;
  }
}

export function getTossShoppingClient(): TossShoppingClient {
  return new TossShoppingClient();
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/listing/toss-shopping-client.ts
git commit -m "feat(toss): add TossShoppingClient with Bearer auth and getOrders pagination"
```

---

### Task 4: /api/orders/toss Route 구현 (TDD)

**Files:**
- Create: `src/__tests__/api/toss-orders.test.ts`
- Create: `src/app/api/orders/toss/route.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/toss-orders.test.ts` 전체 내용:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock: toss-shopping-client ─────────────────────────────────
const mockGetOrders = vi.fn();
vi.mock('@/lib/listing/toss-shopping-client', () => ({
  getTossShoppingClient: () => ({ getOrders: mockGetOrders }),
}));

// ─── Mock: orders-cache ─────────────────────────────────────────
const mockGetOrdersCache = vi.fn();
const mockSetOrdersCache = vi.fn();
vi.mock('@/lib/dashboard/orders-cache', () => ({
  getOrdersCache: mockGetOrdersCache,
  setOrdersCache: mockSetOrdersCache,
}));

// ─── 테스트용 주문 픽스처 ─────────────────────────────────────────
const ORDER_FIXTURE = {
  orderId: 1001,
  orderProductId: 2001,
  orderedAt: '2026-06-15T10:00:00Z',
  ordererName: '홍길동',
  ordererPhone: '01012345678',
  productName: '테스트 상품',
  optionName: '블랙/L',
  quantity: 2,
  price: 30000,
  receiverName: '김철수',
  receiverPhone: '01087654321',
  address: '서울시 강남구 테헤란로 1',
  detailAddress: '101동 202호',
  zipCode: '06234',
  deliveryCompanyCode: 'CJ',
  shippingTrackingNumber: '1234567890',
  deliveryFee: 0,
  orderProductStatus: 'PAID',
  canceledAt: null,
  confirmedAt: null,
};

describe('GET /api/orders/toss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrdersCache.mockResolvedValue(null); // 캐시 미스 기본값
    mockSetOrdersCache.mockResolvedValue(undefined);
  });

  it('기본 7일 범위로 주문을 조회하고 내림차순 정렬 반환한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    const olderOrder = { ...ORDER_FIXTURE, orderProductId: 2000, orderedAt: '2026-06-10T08:00:00Z' };
    const newerOrder = { ...ORDER_FIXTURE, orderProductId: 2001, orderedAt: '2026-06-15T10:00:00Z' };
    mockGetOrders.mockResolvedValue([olderOrder, newerOrder]);

    const req = new NextRequest('http://localhost/api/orders/toss');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.items).toHaveLength(2);
    // 내림차순: 최신 주문이 먼저
    expect(json.data.items[0].orderedAt).toBe('2026-06-15T10:00:00Z');
    expect(json.data.items[1].orderedAt).toBe('2026-06-10T08:00:00Z');
  });

  it('캐시 히트 시 클라이언트를 호출하지 않는다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    const cachedItems = [ORDER_FIXTURE];
    mockGetOrdersCache.mockResolvedValue(cachedItems);

    const req = new NextRequest('http://localhost/api/orders/toss?from=2026-06-01&to=2026-06-07');
    const res = await GET(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.items).toEqual(cachedItems);
    expect(mockGetOrders).not.toHaveBeenCalled();
  });

  it('API 오류 시 success: false와 500 반환한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    mockGetOrders.mockRejectedValue(new Error('토스쇼핑 주문 조회 실패 (INVALID_REQUEST): 날짜 범위 초과'));

    const req = new NextRequest('http://localhost/api/orders/toss');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('토스쇼핑 주문 조회 실패');
  });

  it('주문이 있을 때 캐시에 저장한다', async () => {
    const { GET } = await import('@/app/api/orders/toss/route');

    mockGetOrders.mockResolvedValue([ORDER_FIXTURE]);

    const req = new NextRequest('http://localhost/api/orders/toss?from=2026-06-01&to=2026-06-07');
    await GET(req);

    expect(mockSetOrdersCache).toHaveBeenCalledWith(
      'orders:toss:2026-06-01:2026-06-07',
      expect.any(Array),
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/toss-orders.test.ts 2>&1 | tail -20
```

Expected: `Cannot find module '@/app/api/orders/toss/route'` 에러

- [ ] **Step 3: Route 구현**

`src/app/api/orders/toss/route.ts` 파일 전체 내용:

```typescript
/**
 * GET /api/orders/toss
 * 토스쇼핑 주문 목록 조회
 */

import { NextRequest } from 'next/server';
import { getTossShoppingClient } from '@/lib/listing/toss-shopping-client';
import { getOrdersCache, setOrdersCache } from '@/lib/dashboard/orders-cache';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const from = sp.get('from') ?? toDateStr(defaultFrom);
  const to   = sp.get('to')   ?? toDateStr(today);

  try {
    const cacheKey = `orders:toss:${from}:${to}`;
    const cached = await getOrdersCache<unknown[]>(cacheKey);
    if (cached) {
      return Response.json({ success: true, data: { items: cached } });
    }

    const client = getTossShoppingClient();
    const orders = await client.getOrders({ startDate: from, endDate: to });

    // 주문일시 내림차순 정렬
    orders.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());

    if (orders.length > 0) {
      setOrdersCache(cacheKey, orders).catch(() => {});
    }

    console.info(`[GET /api/orders/toss] 조회 완료: ${orders.length}건 (${from} ~ ${to})`);
    return Response.json({ success: true, data: { items: orders } });
  } catch (err) {
    console.error('[GET /api/orders/toss]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/toss-orders.test.ts 2>&1 | tail -20
```

Expected: `4 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/__tests__/api/toss-orders.test.ts src/app/api/orders/toss/route.ts
git commit -m "feat(toss): add /api/orders/toss route with caching (TDD)"
```

---

### Task 5: OrdersTab 프론트엔드 연동

**Files:**
- Modify: `src/components/orders/OrdersTab.tsx`

이 Task는 여러 수정을 포함한다. 각 단계는 독립적으로 추가/수정한다.

- [ ] **Step 1: 상태맵과 타입 추가**

`src/components/orders/OrdersTab.tsx`의 `NAVER_STATUS_MAP` 선언 바로 아래에 추가:

```typescript
// ─── 토스쇼핑 주문 상태 → 내부 레이블 매핑 ─────────────────────────

const TOSS_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  BEFORE_PAYMENT:          { label: '결제대기',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  PAID:                    { label: '결제완료',   color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  PREPARING_PRODUCT:       { label: '상품준비중', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  DELIVERING:              { label: '배송중',     color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  DELIVERED:               { label: '배송완료',   color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  CONFIRMED_ORDER:         { label: '구매확정',   color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  CLAIM_REQUESTED_CANCEL:  { label: '취소요청',   color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  CANCELED_PAYMENT:        { label: '결제취소',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_REJECTED_CANCEL:   { label: '취소거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  REQUESTED_EXCHANGE:      { label: '교환요청',   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  ONGOING_EXCHANGE:        { label: '교환중',     color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  COMPLETED_EXCHANGE:      { label: '교환완료',   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  CLAIM_REJECTED_EXCHANGE: { label: '교환거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  REQUESTED_RETURN:        { label: '반품요청',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  ONGOING_RETURN:          { label: '반품중',     color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  COMPLETED_RETURN:        { label: '반품완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_REJECTED_RETURN:   { label: '반품거부',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  CLAIM_COLLECTING:        { label: '회수중',     color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_COLLECTED:         { label: '회수완료',   color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
  CLAIM_DELIVERING:        { label: '재배송중',   color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
};
```

- [ ] **Step 2: UnifiedOrder.platform 타입에 'toss' 추가**

`src/components/orders/OrdersTab.tsx`의 `UnifiedOrder` 인터페이스를 수정한다:

```typescript
// 변경 전
interface UnifiedOrder {
  key: string;
  platform: 'coupang' | 'naver' | 'rocket_growth';
  // ...
}

// 변경 후
interface UnifiedOrder {
  key: string;
  platform: 'coupang' | 'naver' | 'rocket_growth' | 'toss';
  // ...
}
```

- [ ] **Step 3: StatusBadge에 'toss' 분기 추가**

`StatusBadge` 컴포넌트 함수를 수정한다:

```typescript
// 변경 전
function StatusBadge({ status, platform }: { status: string; platform: 'coupang' | 'naver' | 'rocket_growth' }) {
  const map = platform === 'naver' ? NAVER_STATUS_MAP : COUPANG_STATUS_MAP;

// 변경 후
function StatusBadge({ status, platform }: { status: string; platform: 'coupang' | 'naver' | 'rocket_growth' | 'toss' }) {
  const map = platform === 'naver' ? NAVER_STATUS_MAP
    : platform === 'toss' ? TOSS_STATUS_MAP
    : COUPANG_STATUS_MAP;
```

- [ ] **Step 4: 토스쇼핑 API 응답 타입과 변환 함수 추가**

`toRgUnified` 함수 바로 아래에 추가:

```typescript
// ─── 토스쇼핑 API 응답 아이템 타입 ────────────────────────────────

interface TossOrderApiItem {
  orderId: number;
  orderProductId: number;
  orderedAt: string;
  ordererName: string;
  productName: string;
  optionName: string;
  quantity: number;
  price: number;
  receiverName: string;
  receiverPhone: string;
  address: string;
  detailAddress: string;
  shippingTrackingNumber: string;
  deliveryCompanyCode: string;
  orderProductStatus: string;
}

function toTossUnified(item: TossOrderApiItem): UnifiedOrder {
  return {
    key: `toss-${item.orderProductId}`,
    platform: 'toss',
    orderId: String(item.orderProductId),
    status: item.orderProductStatus,
    orderedAt: item.orderedAt,
    receiverName: item.receiverName,
    receiverAddr: item.address ? `${item.address} ${item.detailAddress ?? ''}`.trim() : null,
    receiverTel: item.receiverPhone ?? null,
    invoiceInfo: item.shippingTrackingNumber
      ? `${item.deliveryCompanyCode} ${item.shippingTrackingNumber}`
      : null,
    parcelMessage: null,
    orderItems: [
      {
        sellerProductName: item.productName + (item.optionName ? ` (${item.optionName})` : ''),
        sellerProductItemName: item.optionName ?? '',
        shippingCount: item.quantity,
        salesPrice: item.quantity > 0 ? Math.round(item.price / item.quantity) : item.price,
        orderPrice: item.price,
        canceled: ['CANCELED_PAYMENT', 'COMPLETED_RETURN'].includes(item.orderProductStatus),
      },
    ],
  };
}
```

- [ ] **Step 5: fetchOrders에 toss 병렬 호출 추가**

`fetchOrders` 함수 내부를 수정한다.

현재 코드 (약 258~285번째 줄):
```typescript
const [coupangResult, naverResult, rgResult] = await Promise.allSettled([
  fetch(`/api/orders/coupang?${params.toString()}`).then(async (res) => { ... }),
  fetch(`/api/orders/naver?${params.toString()}`).then(async (res) => { ... }),
  fetch(`/api/orders/coupang-rg?${rgParams.toString()}`).then(async (res) => { ... }),
]);
```

변경 후:
```typescript
const [coupangResult, naverResult, rgResult, tossResult] = await Promise.allSettled([
  fetch(`/api/orders/coupang?${params.toString()}`).then(async (res) => {
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? '쿠팡 주문 조회 실패');
    return json;
  }),
  fetch(`/api/orders/naver?${params.toString()}`).then(async (res) => {
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? '네이버 주문 조회 실패');
    return json;
  }),
  fetch(`/api/orders/coupang-rg?${rgParams.toString()}`).then(async (res) => {
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? '로켓그로스 조회 실패');
    return json;
  }),
  fetch(`/api/orders/toss?${params.toString()}`).then(async (res) => {
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? '토스쇼핑 주문 조회 실패');
    return json;
  }),
]);
```

- [ ] **Step 6: tossError 상태 추가**

컴포넌트 상단 state 선언부에 추가:
```typescript
const [tossError, setTossError] = useState<string | null>(null);
```

`fetchOrders` 내 `setCoupangError(null)` 줄 바로 아래에:
```typescript
setTossError(null);
```

- [ ] **Step 7: tossResult 처리 로직 추가**

`if (rgResult.status === 'fulfilled') { ... } else { setRgError(...) }` 블록 바로 아래에 추가:

```typescript
if (tossResult.status === 'fulfilled') {
  const tossItems: TossOrderApiItem[] = tossResult.value.data?.items ?? [];
  unified.push(...tossItems.map(toTossUnified));
} else {
  setTossError(tossResult.reason instanceof Error ? tossResult.reason.message : '토스쇼핑 오류');
}
```

- [ ] **Step 8: 채널별 건수 및 총매출 표시에 toss 추가**

현재 코드:
```typescript
const naverCount = orders.filter((o) => o.platform === 'naver').length;
```
아래에 추가:
```typescript
const tossCount = orders.filter((o) => o.platform === 'toss').length;
```

총계 텍스트(약 370번째 줄):
```tsx
// 변경 전
<span>전체 주문 {orders.length}건 (쿠팡 {coupangCount}건 · 로켓그로스 {rgCount}건 · 네이버 {naverCount}건) · 총 {totalRevenue.toLocaleString()}원</span>

// 변경 후
<span>전체 주문 {orders.length}건 (쿠팡 {coupangCount}건 · 로켓그로스 {rgCount}건 · 네이버 {naverCount}건 · 토스 {tossCount}건) · 총 {totalRevenue.toLocaleString()}원</span>
```

- [ ] **Step 9: 토스 에러 UI 추가**

`{rgError && (...)}`  블록 바로 아래에 추가:

```tsx
{tossError && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px' }}>
    <AlertCircle size={15} color="#dc2626" />
    <span style={{ fontSize: '13px', color: '#dc2626' }}>토스쇼핑: {tossError}</span>
  </div>
)}
```

- [ ] **Step 10: 타입 체크**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음 (또는 기존 에러만)

- [ ] **Step 11: 커밋**

```bash
git add src/components/orders/OrdersTab.tsx
git commit -m "feat(orders): integrate Toss Shopping orders into OrdersTab parallel fetch"
```

---

## 검증

전체 구현 완료 후 다음을 확인한다:

1. **환경 변수 설정**: `.env.local`에 `TOSS_SHOPPING_ACCESS_TOKEN=<실제_토큰>` 입력
2. **테스트 전체 통과**: `npx vitest run src/__tests__/api/toss-orders.test.ts`
3. **타입 체크**: `npx tsc --noEmit`
4. **UI 확인**: 개발 서버(`npm run dev`)에서 `/orders` 접속 → 주문 탭 → 토스쇼핑 주문이 목록에 표시되는지 확인

> **토큰 미설정 상태에서도 안전함**: `TOSS_SHOPPING_ACCESS_TOKEN`이 없으면 클라이언트 생성 시 에러가 발생하고, route에서 500을 반환하며, `OrdersTab`은 tossError를 표시한다. 나머지 쿠팡/네이버 주문은 영향 없음.
