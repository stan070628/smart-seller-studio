# 소싱 URL 접근 불가 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품등록 탭에 저장된 소싱 출처 URL(1688, 도매꾹 등)이 매일 오후 6시(KST) 체크 시 404/410이면 앱 내 배지 + 이메일로 알림을 발송한다.

**Architecture:** Vercel Cron(`0 9 * * *` UTC)이 `product_sourcing` 테이블의 `type='online'` 레코드를 전부 HEAD 요청으로 검사하고, 404/410 응답을 받은 URL은 `alerts` 테이블에 `type='sourcing_url_dead'` 로 저장 후 Resend로 즉시 이메일 발송한다. AppNav에 미읽음 카운트 배지를 추가해 인앱 알림도 제공한다.

**Tech Stack:** Next.js 15 App Router, Vitest, PostgreSQL (`getSourcingPool`), Resend, Zustand

---

## 파일 맵

| 경로 | 역할 |
|------|------|
| `supabase/migrations/066_sourcing_url_dead.sql` | product_name 컬럼 + alerts type 확장 |
| `src/lib/alerts/types.ts` | AlertType에 `sourcing_url_dead` 추가 |
| `src/lib/alerts/digest-email.ts` | 이메일 라벨 추가 |
| `src/lib/listing/url-health-check.ts` | URL 생사 판정 순수 함수 (신규) |
| `src/__tests__/lib/url-health-check.test.ts` | url-health-check 단위 테스트 (신규) |
| `src/app/api/listing/sourcing/route.ts` | PUT에 productName 저장 |
| `src/__tests__/api/listing-sourcing.test.ts` | productName 저장 테스트 추가 |
| `src/store/useListingStore.ts` | saveSourcing 시그니처 업데이트 |
| `src/components/listing/browse/BrowseMode.tsx` | productName SourcingBadge → SourcingPopover 전달 |
| `src/app/api/listing/sourcing/check-dead-urls/route.ts` | 크론 엔드포인트 (신규) |
| `src/__tests__/api/listing-sourcing-check-dead-urls.test.ts` | 크론 단위 테스트 (신규) |
| `src/components/AppNav.tsx` | 미읽음 알림 배지 추가 |
| `vercel.json` | 새 크론 등록 |

---

### Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/066_sourcing_url_dead.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 066_sourcing_url_dead.sql
-- product_sourcing에 상품명 컬럼 추가 (알림 메시지 표시용)
ALTER TABLE product_sourcing
  ADD COLUMN IF NOT EXISTS product_name VARCHAR(500);

-- alerts.type CHECK 제약 확장 (sourcing_url_dead 추가)
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN (
  'roas_low', 'stock_low', 'negative_review',
  'winner_lost', 'sourcing_recommendation', 'review_milestone',
  'inbound_return_warning', 'channel_distribution',
  'sourcing_url_dead'
));
```

- [ ] **Step 2: Supabase MCP로 마이그레이션 적용**

Supabase MCP `execute_sql` 로 위 SQL을 실행한다.
성공 시 에러 없이 완료됨.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/066_sourcing_url_dead.sql
git commit -m "feat(db): product_sourcing product_name 컬럼 + alerts sourcing_url_dead 타입 추가"
```

---

### Task 2: Alert 타입 + 이메일 라벨 확장

**Files:**
- Modify: `src/lib/alerts/types.ts`
- Modify: `src/lib/alerts/digest-email.ts`

- [ ] **Step 1: `types.ts`에 `sourcing_url_dead` 추가**

`src/lib/alerts/types.ts` 의 `AlertType` 유니온에 추가:

```typescript
export type AlertType =
  | 'roas_low' | 'stock_low' | 'negative_review'
  | 'winner_lost' | 'sourcing_recommendation' | 'review_milestone'
  | 'inbound_return_warning' | 'channel_distribution'
  | 'sourcing_url_dead';
```

- [ ] **Step 2: `digest-email.ts` 라벨 추가**

`src/lib/alerts/digest-email.ts` 의 `TYPE_LABELS` 객체에 추가:

```typescript
const TYPE_LABELS: Record<string, string> = {
  roas_low: '🔻 광고 ROAS 미달',
  stock_low: '📦 재고 부족',
  negative_review: '⚠️ 부정 리뷰',
  winner_lost: '🏃 위너 빼앗김',
  sourcing_recommendation: '💡 사입 추천',
  review_milestone: '🎉 리뷰 도달',
  inbound_return_warning: '📤 회송 경고',
  channel_distribution: '📊 채널 분배',
  sourcing_url_dead: '🔗 소싱 URL 접근 불가',   // 추가
};
```

- [ ] **Step 3: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/alerts/types.ts src/lib/alerts/digest-email.ts
git commit -m "feat(alerts): sourcing_url_dead 알림 타입 추가"
```

---

### Task 3: URL 생사 판정 라이브러리 (TDD)

**Files:**
- Create: `src/lib/listing/url-health-check.ts`
- Create: `src/__tests__/lib/url-health-check.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/lib/url-health-check.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkUrl } from '@/lib/listing/url-health-check';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkUrl', () => {
  it('404 응답이면 dead를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await checkUrl('https://domeggook.com/main/item/itemView.php?uid=9999999');
    expect(result.status).toBe('dead');
    if (result.status === 'dead') {
      expect(result.httpStatus).toBe(404);
    }
  });

  it('410 응답이면 dead를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 410 });
    const result = await checkUrl('https://detail.1688.com/offer/99999.html');
    expect(result.status).toBe('dead');
    if (result.status === 'dead') {
      expect(result.httpStatus).toBe(410);
    }
  });

  it('200 응답이면 alive를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await checkUrl('https://domeggook.com/main/item/itemView.php?uid=12345');
    expect(result.status).toBe('alive');
  });

  it('301 리다이렉트면 alive를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 301 });
    const result = await checkUrl('https://example.com/product/1');
    expect(result.status).toBe('alive');
  });

  it('403 응답이면 skip을 반환한다 (geo-block 가능)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await checkUrl('https://detail.1688.com/offer/99999.html');
    expect(result.status).toBe('skip');
    if (result.status === 'skip') {
      expect(result.reason).toContain('403');
    }
  });

  it('500 서버 오류면 skip을 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await checkUrl('https://example.com/product/1');
    expect(result.status).toBe('skip');
  });

  it('네트워크 오류면 skip을 반환한다', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await checkUrl('https://example.com/product/1');
    expect(result.status).toBe('skip');
    if (result.status === 'skip') {
      expect(result.reason).toContain('network');
    }
  });

  it('HEAD 메서드로 요청한다', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await checkUrl('https://domeggook.com/main/item/itemView.php?uid=12345');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://domeggook.com/main/item/itemView.php?uid=12345',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/url-health-check.test.ts
```

Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현 작성**

```typescript
// src/lib/listing/url-health-check.ts
export type UrlCheckResult =
  | { status: 'dead'; httpStatus: number }
  | { status: 'alive' }
  | { status: 'skip'; reason: string };

export async function checkUrl(url: string): Promise<UrlCheckResult> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 SmartSellerStudio/1.0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });

    if (res.status === 404 || res.status === 410) {
      return { status: 'dead', httpStatus: res.status };
    }
    if (res.status >= 500 || res.status === 403 || res.status === 429) {
      return { status: 'skip', reason: `HTTP ${res.status}` };
    }
    return { status: 'alive' };
  } catch (err) {
    return { status: 'skip', reason: `network: ${String(err)}` };
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/url-health-check.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/listing/url-health-check.ts src/__tests__/lib/url-health-check.test.ts
git commit -m "feat(listing): URL 생사 판정 라이브러리 추가"
```

---

### Task 4: sourcing PUT API — productName 저장 (TDD)

**Files:**
- Modify: `src/app/api/listing/sourcing/route.ts`
- Modify: `src/__tests__/api/listing-sourcing.test.ts`
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: 기존 테스트에 productName 케이스 추가**

`src/__tests__/api/listing-sourcing.test.ts` 의 `PUT /api/listing/sourcing` describe 블록에 아래 테스트를 추가한다:

```typescript
it('productName을 포함하면 DB에 product_name도 저장한다', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = new NextRequest('http://localhost/api/listing/sourcing', {
    method: 'PUT',
    body: JSON.stringify({
      platform: 'coupang',
      productId: '111',
      type: 'online',
      value: 'https://1688.com/x',
      productName: '캠핑 접이식 의자',
    }),
  });
  const res = await PUT(req);
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('product_name'),
    ['coupang', '111', 'online', 'https://1688.com/x', '캠핑 접이식 의자'],
  );
});

it('productName 없어도 정상 저장된다', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = new NextRequest('http://localhost/api/listing/sourcing', {
    method: 'PUT',
    body: JSON.stringify({
      platform: 'coupang',
      productId: '222',
      type: 'online',
      value: 'https://domeggook.com/x',
    }),
  });
  const res = await PUT(req);
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing.test.ts
```

Expected: FAIL (productName 테스트 2개)

- [ ] **Step 3: route.ts PUT 핸들러 업데이트**

`src/app/api/listing/sourcing/route.ts` 의 PUT 핸들러를 아래와 같이 수정한다:

```typescript
export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json();
  const { platform, productId, type, value, productName } = body as {
    platform: string;
    productId: string;
    type: string;
    value: string;
    productName?: string;
  };

  if (!platform || !productId || !type) {
    return Response.json({ success: false, error: '필수 필드가 누락되었습니다.' }, { status: 400 });
  }
  if (type !== 'online' && type !== 'offline') {
    return Response.json({ success: false, error: '유효하지 않은 소싱 유형입니다.' }, { status: 400 });
  }
  if (!value?.trim()) {
    return Response.json({ success: false, error: '값이 비어 있습니다.' }, { status: 400 });
  }

  try {
    const pool = getSourcingPool();
    await pool.query(
      `INSERT INTO product_sourcing (platform, product_id, sourcing_type, sourcing_value, product_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (platform, product_id)
       DO UPDATE SET sourcing_type = $3, sourcing_value = $4, product_name = $5, updated_at = NOW()`,
      [platform, productId, type, value, productName ?? null],
    );
    return Response.json({ success: true });
  } catch (err) {
    console.error('[sourcing] PUT error:', err);
    return Response.json({ success: false, error: '소싱 저장 실패' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing.test.ts
```

Expected: PASS (전체)

- [ ] **Step 5: useListingStore.ts saveSourcing 시그니처 업데이트**

`src/store/useListingStore.ts` 에서 두 곳을 수정한다.

타입 선언 (316번째 줄 근처):
```typescript
saveSourcing: (
  platform: 'coupang' | 'naver',
  productId: string,
  type: 'online' | 'offline',
  value: string,
  productName?: string,
) => Promise<boolean>;
```

구현 (677번째 줄 근처):
```typescript
saveSourcing: async (platform, productId, type, value, productName) => {
  const key = `${platform}:${productId}`;
  const prevMap = get().sourcingMap;
  const hadKey = key in prevMap;
  const prevVal = prevMap[key] ?? null;
  set((s) => ({ sourcingMap: { ...s.sourcingMap, [key]: { type, value } } }), false, 'listing/saveSourcing/optimistic');
  try {
    const res = await fetch('/api/listing/sourcing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, productId, type, value, productName }),
    });
    if (!res.ok) throw new Error('저장 실패');
    return true;
  } catch {
    set((s) => {
      const optimistic = s.sourcingMap[key];
      if (optimistic?.type !== type || optimistic?.value !== value) return {};
      const next = { ...s.sourcingMap };
      if (hadKey) { next[key] = prevVal; } else { delete next[key]; }
      return { sourcingMap: next };
    }, false, 'listing/saveSourcing/rollback');
    return false;
  }
},
```

- [ ] **Step 6: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/listing/sourcing/route.ts \
        src/__tests__/api/listing-sourcing.test.ts \
        src/store/useListingStore.ts
git commit -m "feat(listing): 소싱 출처 저장 시 productName 함께 저장"
```

---

### Task 5: BrowseMode — productName SourcingBadge 전달

**Files:**
- Modify: `src/components/listing/browse/BrowseMode.tsx`

- [ ] **Step 1: SourcingBadgeProps + SourcingPopoverProps에 productName 추가**

`src/components/listing/browse/BrowseMode.tsx` 에서 두 인터페이스를 수정한다.

`SourcingPopoverProps` (65번째 줄 근처):
```typescript
interface SourcingPopoverProps {
  platform: 'coupang' | 'naver';
  productId: string;
  productName?: string;
  current: { type: 'online' | 'offline'; value: string } | null;
  onClose: () => void;
}
```

`SourcingPopover` 함수 파라미터 (72번째 줄 근처):
```typescript
function SourcingPopover({ platform, productId, productName, current, onClose }: SourcingPopoverProps) {
```

`handleSave` 내 `saveSourcing` 호출 (96번째 줄 근처):
```typescript
const ok = await saveSourcing(platform, productId, tab, inputValue.trim(), productName);
```

- [ ] **Step 2: SourcingBadgeProps에 productName 추가 후 Popover로 전달**

`SourcingBadgeProps` (244번째 줄 근처):
```typescript
interface SourcingBadgeProps {
  platform: 'coupang' | 'naver';
  productId: string;
  productName?: string;
}
```

`SourcingBadge` 함수 파라미터 (249번째 줄 근처):
```typescript
function SourcingBadge({ platform, productId, productName }: SourcingBadgeProps) {
```

`SourcingPopover` 렌더 부분 (289번째 줄 근처):
```typescript
<SourcingPopover
  platform={platform}
  productId={productId}
  productName={productName}
  current={sourcing}
  onClose={() => setOpen(false)}
/>
```

- [ ] **Step 3: 쿠팡/네이버 테이블에서 SourcingBadge 호출 시 productName 전달**

쿠팡 테이블 행 (745번째 줄 근처):
```typescript
<SourcingBadge
  platform="coupang"
  productId={String(pr.sellerProductId)}
  productName={pr.sellerProductName}
/>
```

네이버 테이블 행 (991번째 줄 근처):
```typescript
<SourcingBadge
  platform="naver"
  productId={String(p.originProductNo)}
  productName={p.name}
/>
```

- [ ] **Step 4: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/browse/BrowseMode.tsx
git commit -m "feat(listing): 소싱 출처 저장 시 상품명 전달"
```

---

### Task 6: 소싱 URL 생사 확인 크론 API (TDD)

**Files:**
- Create: `src/app/api/listing/sourcing/check-dead-urls/route.ts`
- Create: `src/__tests__/api/listing-sourcing-check-dead-urls.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/api/listing-sourcing-check-dead-urls.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// URL 체크 모듈 모킹
vi.mock('@/lib/listing/url-health-check', () => ({
  checkUrl: vi.fn(),
}));

// DB 모킹
const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

// fetch 모킹 (Resend 이메일용)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/listing/sourcing/check-dead-urls/route';
import { checkUrl } from '@/lib/listing/url-health-check';

function makeRequest(token = 'test-secret') {
  return new NextRequest('http://localhost/api/listing/sourcing/check-dead-urls', {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('RESEND_API_KEY', 'resend-key');
  vi.stubEnv('ALERT_EMAIL', 'test@example.com');
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('인증', () => {
  it('잘못된 토큰이면 401을 반환한다', async () => {
    const res = await GET(makeRequest('wrong-token'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 미설정이면 500을 반환한다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeRequest('any'));
    expect(res.status).toBe(500);
  });
});

describe('URL 없음', () => {
  it('온라인 소싱 레코드가 없으면 checked=0, dead=0을 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT product_sourcing
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.checked).toBe(0);
    expect(body.dead).toBe(0);
    expect(body.emailed).toBe(false);
  });
});

describe('dead URL 발견', () => {
  it('404 URL은 alerts에 INSERT하고 이메일을 발송한다', async () => {
    // product_sourcing 조회 결과
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '111',
        product_name: '캠핑 의자',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    // 중복 알림 체크 — 없음
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // alerts INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });
    mockFetch.mockResolvedValueOnce({ ok: true }); // Resend 응답

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checked).toBe(1);
    expect(body.dead).toBe(1);
    expect(body.emailed).toBe(true);

    // alerts INSERT 호출 확인
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain('sourcing_url_dead');
    expect(insertCall![1]).toContain('coupang:111');
  });

  it('alive URL은 alerts INSERT를 호출하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'naver',
        product_id: '222',
        product_name: '등산 모자',
        sourcing_value: 'https://domeggook.com/product/1234',
      }],
    });
    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'alive' });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0);
    expect(body.emailed).toBe(false);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('skip URL은 alerts INSERT를 호출하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '333',
        product_name: '상품명',
        sourcing_value: 'https://detail.1688.com/offer/123.html',
      }],
    });
    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'skip', reason: 'HTTP 403' });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('최근 24시간 내 이미 알림 발생한 레코드는 중복 INSERT하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '444',
        product_name: '상품명',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    // 중복 알림 체크 — 이미 존재
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0); // 중복이므로 카운트 안 함
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('RESEND_API_KEY 없으면 이메일 미발송 + 앱 알림은 유지', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '555',
        product_name: '상품명',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 중복 없음
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(1);
    expect(body.emailed).toBe(false);
    // fetch(Resend)는 호출되지 않아야 함
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing-check-dead-urls.test.ts
```

Expected: FAIL (모듈 없음)

- [ ] **Step 3: 크론 API 구현**

```typescript
// src/app/api/listing/sourcing/check-dead-urls/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { checkUrl } from '@/lib/listing/url-health-check';

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? 'stan@aibox.it.kr';

interface SourcingRow {
  platform: string;
  product_id: string;
  product_name: string | null;
  sourcing_value: string;
}

async function sendDeadUrlEmail(deadRows: Array<{ row: SourcingRow; httpStatus: number }>) {
  if (!RESEND_API_KEY) return false;
  const date = new Date().toISOString().slice(0, 10);
  const items = deadRows
    .map((d) => {
      const name = d.row.product_name ?? d.row.sourcing_value;
      return `<li style="margin:6px 0"><b>${name}</b> (${d.row.platform}) — HTTP ${d.httpStatus}<br>
        <a href="${d.row.sourcing_value}" style="color:#6b7280;font-size:12px">${d.row.sourcing_value}</a></li>`;
    })
    .join('');
  const html = `
    <html><body style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="border-bottom:2px solid #DC2626;padding-bottom:8px">⚠️ 소싱 URL ${deadRows.length}건 접근 불가 — ${date}</h2>
      <p style="color:#6B7280">아래 상품의 소싱 출처 URL이 삭제되었거나 접근 불가 상태입니다.<br>온라인몰에서 해당 상품을 내리는 것을 검토하세요.</p>
      <ul style="padding-left:20px">${items}</ul>
      <p style="margin-top:30px;color:#9CA3AF;font-size:12px">SmartSellerStudio 자동 알림</p>
    </body></html>`;
  const text = deadRows
    .map((d) => `[${d.row.platform}] ${d.row.product_name ?? d.row.sourcing_value} — ${d.row.sourcing_value}`)
    .join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SmartSellerStudio <alerts@smart-seller-studio.app>',
      to: [ALERT_EMAIL],
      subject: `⚠️ 소싱 URL ${deadRows.length}건 접근 불가 — ${date}`,
      html,
      text,
    }),
  });
  return res.ok;
}

// Promise 배치 — 동시 최대 concurrency개 실행
async function batchProcess<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(fn));
    results.push(...settled);
  }
  return results;
}

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET 미설정' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  const { rows } = await pool.query<SourcingRow>(
    `SELECT platform, product_id, product_name, sourcing_value
     FROM product_sourcing
     WHERE sourcing_type = 'online'`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: true, checked: 0, dead: 0, emailed: false });
  }

  const deadRows: Array<{ row: SourcingRow; httpStatus: number }> = [];

  await batchProcess(rows, 5, async (row) => {
    const result = await checkUrl(row.sourcing_value);
    if (result.status !== 'dead') return;

    // 24시간 내 중복 알림 체크
    const { rows: existing } = await pool.query(
      `SELECT id FROM alerts
       WHERE type = 'sourcing_url_dead' AND sku_code = $1
         AND created_at > now() - INTERVAL '24 hours'
       LIMIT 1`,
      [`${row.platform}:${row.product_id}`],
    );
    if (existing.length > 0) return;

    const productLabel = row.product_name ?? row.sourcing_value;
    await pool.query(
      `INSERT INTO alerts (type, severity, sku_code, message, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'sourcing_url_dead',
        'high',
        `${row.platform}:${row.product_id}`,
        `소싱 URL 접근 불가 — ${productLabel} (${row.platform})`,
        JSON.stringify({ url: row.sourcing_value, httpStatus: result.httpStatus, platform: row.platform, productId: row.product_id }),
      ],
    );
    deadRows.push({ row, httpStatus: result.httpStatus });
  });

  const emailed = deadRows.length > 0 ? await sendDeadUrlEmail(deadRows) : false;

  return NextResponse.json({
    success: true,
    checked: rows.length,
    dead: deadRows.length,
    emailed,
  });
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/api/listing-sourcing-check-dead-urls.test.ts
```

Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/listing/sourcing/check-dead-urls/route.ts \
        src/__tests__/api/listing-sourcing-check-dead-urls.test.ts
git commit -m "feat(listing): 소싱 URL 생사 확인 크론 API 추가"
```

---

### Task 7: AppNav 미읽음 알림 배지

**Files:**
- Modify: `src/components/AppNav.tsx`

- [ ] **Step 1: AppNav에 알림 배지 state + fetch 추가**

`src/components/AppNav.tsx` 를 아래와 같이 교체한다:

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import AlertList from '@/components/alerts/AlertList';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분

export default function AppNav() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/alerts?unread=true');
      const data = await res.json();
      if (data.success) setUnreadCount((data.rows as unknown[]).length);
    } catch {
      // 무시 — 알림 배지는 부가 기능
    }
  }

  useEffect(() => {
    fetchUnreadCount();
    const id = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!showAlerts) return;
    const handler = (e: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) {
        setShowAlerts(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAlerts]);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.card,
        gap: 24,
      }}
    >
      <Link
        href="/dashboard"
        style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
      >
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: C.text }}>
          Smart<span style={{ color: C.accent }}>Seller</span>Studio
        </span>
        <span
          style={{
            backgroundColor: 'rgba(190,0,20,0.08)',
            color: C.accent,
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 9px',
            borderRadius: 100,
            border: '1px solid rgba(190,0,20,0.2)',
          }}
        >
          Beta
        </span>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? C.accent : '#71717a',
                textDecoration: 'none',
                backgroundColor: active ? 'rgba(190,0,20,0.07)' : 'transparent',
                border: active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 알림 배지 */}
      <div ref={badgeRef} style={{ marginLeft: 'auto', position: 'relative' }}>
        <button
          type="button"
          onClick={() => {
            setShowAlerts((v) => !v);
            if (!showAlerts) fetchUnreadCount();
          }}
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: `1px solid ${C.border}`,
            backgroundColor: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
          title="알림"
        >
          🔔
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: C.accent,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 3px',
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {showAlerts && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 8,
              width: 360,
              maxHeight: 480,
              overflowY: 'auto',
              backgroundColor: '#fff',
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: `1px solid ${C.border}`,
                fontWeight: 700,
                fontSize: 13,
                color: C.text,
              }}
            >
              알림
            </div>
            <div style={{ padding: 8 }}>
              <AlertList unreadOnly={false} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 전체 테스트 통과 확인**

```bash
npx vitest run
```

Expected: 전체 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/AppNav.tsx
git commit -m "feat(nav): 미읽음 알림 배지 추가"
```

---

### Task 8: vercel.json 크론 등록

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: 크론 항목 추가**

`vercel.json` 의 `"crons"` 배열에 아래 항목을 추가한다:

```json
{
  "path": "/api/listing/sourcing/check-dead-urls",
  "schedule": "0 9 * * *"
}
```

(`0 9 * * *` = UTC 09:00 = KST 18:00)

- [ ] **Step 2: 최종 전체 테스트**

```bash
npx vitest run
```

Expected: 전체 PASS

- [ ] **Step 3: 최종 커밋**

```bash
git add vercel.json
git commit -m "feat(cron): 소싱 URL 생사 확인 크론 등록 (매일 오후 6시 KST)"
```

---

## 완료 기준 체크리스트

- [ ] 마이그레이션 적용 후 `product_sourcing.product_name` 컬럼 존재
- [ ] `alerts.type` CHECK에 `sourcing_url_dead` 포함
- [ ] `npx vitest run` 전체 통과
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] 소싱 출처 URL 저장 시 상품명이 DB에 기록됨
- [ ] `/api/listing/sourcing/check-dead-urls` 크론 엔드포인트 동작
- [ ] AppNav 우상단에 알림 배지 렌더링 확인
- [ ] `vercel.json` 크론 `0 9 * * *` 등록
