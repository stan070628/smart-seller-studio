# 상품별×날짜별 광고비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수익원가 탭 상품 상세 패널에서 광고비를 날짜별로 입력하고, 그 상품별 합계를 정산 일별 손익에 자동 반영한다.

**Architecture:** 광고비의 단일 소스가 되는 새 테이블 `product_ad_spend_daily(user_id, product_id, ad_date, ad_spend)`를 만든다. 수익원가 상품 목록은 선택 기간의 날짜 합계로 광고비/ROAS를 집계하고, 정산 일별 손익은 그날 상품별 합계를 광고비로 사용한다. 기존 월별 `product_ad_spend` 데이터는 그달 1일자로 이관하고 코드 참조를 제거한다.

**Tech Stack:** Next.js(App Router, 이 저장소 커스텀 버전) · Render PostgreSQL(`SOURCING_DATABASE_URL`, `getSourcingPool`) · Vitest · React(인라인 style)

**Spec:** `docs/superpowers/specs/2026-07-18-product-daily-ad-spend-design.md`

---

## File Structure

**생성**
- `supabase/migrations/091_product_ad_spend_daily.sql` — 새 테이블 + 월별 데이터 이관
- `src/__tests__/api/settlement-daily.test.ts` — 정산 daily 라우트가 광고비를 새 테이블에서 가져오는지 검증

**수정**
- `src/app/api/cost-management/products/[id]/ad-spend/route.ts` — `year_month` → `ad_date` (PATCH upsert) + 신규 `GET` 목록
- `src/__tests__/api/cost-management-ad-spend.test.ts` — 날짜 기반으로 테스트 갱신
- `src/app/api/cost-management/products/route.ts` — 광고비 합산을 날짜 범위(`product_ad_spend_daily`)로 변경
- `src/app/api/settlement/daily/route.ts` — 광고비를 `product_ad_spend_daily` 날짜 합계로 주입
- `src/app/api/settlement/expenses/[date]/route.ts` — `ad_spend` 저장 중단(0 고정)
- `src/components/orders/ExpenseModal.tsx` — 광고비 입력칸 제거
- `src/components/orders/CostManagementTab.tsx` — `saveAdSpend(productId, adDate, value)` + 기간 범위 전달
- `src/components/orders/cost-table/ProductDetailPanel.tsx` — 날짜별 리스트 UI + GET 로드 + 인라인 편집
- `src/components/orders/cost-table/ProductRow.tsx` — 미사용 `onSaveAdSpend` prop 제거

---

## Task 1: 마이그레이션 — 새 테이블 + 월별 데이터 이관

**Files:**
- Create: `supabase/migrations/091_product_ad_spend_daily.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/091_product_ad_spend_daily.sql`:

```sql
-- 091_product_ad_spend_daily.sql
-- 상품별 날짜별 수동 광고비 테이블 (광고비 단일 소스).
-- Render PostgreSQL (SOURCING_DATABASE_URL) 에 적용. user_id 는 FK 없이 uuid
-- (기존 product_ad_spend / product_costs 패턴 동일).

CREATE TABLE IF NOT EXISTS product_ad_spend_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  product_id   UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  ad_date      DATE NOT NULL,
  ad_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, ad_date)
);

CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_date_idx
  ON product_ad_spend_daily (user_id, ad_date);

CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_product_date_idx
  ON product_ad_spend_daily (user_id, product_id, ad_date);

COMMENT ON TABLE product_ad_spend_daily IS '상품별 날짜별 수동 광고비 (광고비 단일 소스). spec 2026-07-18';

CREATE TRIGGER trg_product_ad_spend_daily_updated_at
  BEFORE UPDATE ON product_ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 기존 월별 광고비(product_ad_spend) 이관: 월 총액을 그달 1일자 한 건으로.
-- 날짜 정보가 없어 1일로 귀속(정산은 신규 기능이라 실무 영향 없음, 기간 합계 보존).
INSERT INTO product_ad_spend_daily (user_id, product_id, ad_date, ad_spend)
SELECT user_id, product_id, (year_month || '-01')::date, ad_spend
FROM product_ad_spend
WHERE ad_spend > 0
ON CONFLICT (user_id, product_id, ad_date) DO NOTHING;
```

- [ ] **Step 2: 마이그레이션 적용**

이 저장소의 마이그레이션 적용 방식대로 실행한다(예: Render DB에 psql로 파일 실행). 적용 후 확인:

Run:
```bash
psql "$SOURCING_DATABASE_URL" -c "\d product_ad_spend_daily"
psql "$SOURCING_DATABASE_URL" -c "SELECT count(*) FROM product_ad_spend_daily;"
```
Expected: 테이블 구조 출력 + 기존 월별 행 수만큼 이관된 count.

> 참고: `SOURCING_DATABASE_URL` 접근이 어려우면 사용자에게 `! psql ...` 로 직접 실행을 요청한다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/091_product_ad_spend_daily.sql
git commit -m "feat(db): product_ad_spend_daily 테이블 + 월별 광고비 이관 (091)"
```

---

## Task 2: ad-spend PATCH 라우트 — year_month → ad_date

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/ad-spend/route.ts`
- Test: `src/__tests__/api/cost-management-ad-spend.test.ts`

- [ ] **Step 1: 테스트를 날짜 기반으로 교체**

`src/__tests__/api/cost-management-ad-spend.test.ts` 전체를 아래로 교체:

```ts
/**
 * PATCH /api/cost-management/products/[id]/ad-spend
 * 상품별 날짜별 광고비 upsert 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/products/${id}/ad-spend`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

describe('PATCH /api/cost-management/products/[id]/ad-spend', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'row-uuid', product_id: 'prod-uuid', ad_date: '2026-07-17', ad_spend: '15000' }],
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { ad_date: '2026-07-17', ad_spend: 15000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(401);
  });

  it('ad_date 형식이 잘못되면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { ad_date: '2026-07', ad_spend: 15000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ad_date/i);
  });

  it('ad_spend 음수이면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { ad_date: '2026-07-17', ad_spend: -1000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ad_spend/i);
  });

  it('정상 요청이면 upsert 쿼리 실행 후 200', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { ad_date: '2026-07-17', ad_spend: 15000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, args] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/product_ad_spend_daily/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(args).toEqual(['user-uuid-123', 'prod-uuid', '2026-07-17', 15000]);
  });

  it('상품이 없으면 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { ad_date: '2026-07-17', ad_spend: 15000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts`
Expected: FAIL — 라우트가 아직 `year_month`를 요구(ad_date 400/args 불일치).

- [ ] **Step 3: 라우트를 날짜 기반으로 구현**

`src/app/api/cost-management/products/[id]/ad-spend/route.ts` 의 PATCH 부분을 교체(파일 상단 import 유지):

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { body = null; }

  const { ad_date, ad_spend } = body ?? {};

  if (!ad_date || !DATE_RE.test(ad_date)) {
    return NextResponse.json(
      { success: false, error: 'ad_date must be in YYYY-MM-DD format' },
      { status: 400 },
    );
  }
  if (typeof ad_spend !== 'number' || ad_spend < 0) {
    return NextResponse.json(
      { success: false, error: 'ad_spend must be a non-negative number' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO product_ad_spend_daily (user_id, product_id, ad_date, ad_spend, updated_at)
     SELECT $1, $2, $3, $4, now()
     WHERE EXISTS (SELECT 1 FROM product_costs WHERE id = $2 AND user_id = $1)
     ON CONFLICT (user_id, product_id, ad_date)
     DO UPDATE SET ad_spend = EXCLUDED.ad_spend, updated_at = now()
     RETURNING id, product_id, to_char(ad_date, 'YYYY-MM-DD') AS ad_date, ad_spend`,
    [user.userId, id, ad_date, ad_spend],
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: rows[0] });
}
```

기존 `YEAR_MONTH_RE` 상수는 삭제한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts`
Expected: PASS (5개).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/ad-spend/route.ts src/__tests__/api/cost-management-ad-spend.test.ts
git commit -m "feat(cost): 광고비 upsert를 날짜별(ad_date)로 변경"
```

---

## Task 3: ad-spend GET 라우트 — 상품 기간 내 날짜별 목록

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/ad-spend/route.ts`
- Test: `src/__tests__/api/cost-management-ad-spend.test.ts`

- [ ] **Step 1: GET 테스트 추가**

`src/__tests__/api/cost-management-ad-spend.test.ts` 하단(마지막 `});` 뒤)에 추가:

```ts
describe('GET /api/cost-management/products/[id]/ad-spend', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ ad_date: '2026-07-17', ad_spend: '15000' }],
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  function getReq(id: string, qs: string): NextRequest {
    return new NextRequest(`http://localhost/api/cost-management/products/${id}/ad-spend?${qs}`);
  }

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await GET(getReq('prod-uuid', 'from=2026-07-01&to=2026-07-31'), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(401);
  });

  it('from/to 없으면 400', async () => {
    const { GET } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await GET(getReq('prod-uuid', 'from=2026-07-01'), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('정상이면 날짜별 목록 반환', async () => {
    const { GET } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await GET(getReq('prod-uuid', 'from=2026-07-01&to=2026-07-31'), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([{ ad_date: '2026-07-17', ad_spend: 15000 }]);
    const [sql, args] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/product_ad_spend_daily/i);
    expect(args).toEqual(['user-uuid-123', 'prod-uuid', '2026-07-01', '2026-07-31']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts`
Expected: FAIL — `GET` export 없음.

- [ ] **Step 3: GET 핸들러 구현**

`route.ts` 하단에 추가:

```ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { success: false, error: 'from, to (YYYY-MM-DD) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT to_char(ad_date, 'YYYY-MM-DD') AS ad_date, ad_spend
       FROM product_ad_spend_daily
      WHERE user_id = $1 AND product_id = $2 AND ad_date BETWEEN $3 AND $4
      ORDER BY ad_date`,
    [user.userId, id, from, to],
  );

  const data = rows.map((r) => ({ ad_date: r.ad_date, ad_spend: Number(r.ad_spend) }));
  return NextResponse.json({ success: true, data });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts`
Expected: PASS (8개).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/ad-spend/route.ts src/__tests__/api/cost-management-ad-spend.test.ts
git commit -m "feat(cost): GET ad-spend 기간 내 날짜별 광고비 목록"
```

---

## Task 4: 수익원가 상품 목록 — 날짜 범위 합산

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: 광고비 합산을 날짜 범위로 변경**

`src/app/api/cost-management/products/route.ts` 의 광고비 집계 블록(현재 `getYearMonths` 사용, 대략 135–149행)을 아래로 교체:

```ts
    // product_ad_spend_daily 에서 기간 내 광고비 합산 (날짜 범위)
    const adSpendByProduct = new Map<string, number>();
    if (from && to) {
      const { rows: adRows } = await pool.query(
        `SELECT product_id, SUM(ad_spend)::float AS total_ad_spend
           FROM product_ad_spend_daily
          WHERE user_id = $1 AND ad_date BETWEEN $2 AND $3
          GROUP BY product_id`,
        [user.userId, from, to],
      );
      for (const row of adRows) {
        adSpendByProduct.set(row.product_id, Number(row.total_ad_spend));
      }
    } else {
      // 전체 기간(all): 날짜 필터 없이 합산
      const { rows: adRows } = await pool.query(
        `SELECT product_id, SUM(ad_spend)::float AS total_ad_spend
           FROM product_ad_spend_daily
          WHERE user_id = $1
          GROUP BY product_id`,
        [user.userId],
      );
      for (const row of adRows) {
        adSpendByProduct.set(row.product_id, Number(row.total_ad_spend));
      }
    }
```

그리고 파일 상단의 `import { getYearMonths } from '@/lib/cost-management/ad-spend';` 를 삭제한다(다른 곳에서 미사용이면 완전 제거; 남아 있으면 unused import 경고).

> `getYearMonths` 자체(`src/lib/cost-management/ad-spend.ts`)와 그 테스트는 삭제하지 않는다 — 다른 참조 여부는 Step 2에서 확인.

- [ ] **Step 2: 잔여 참조 확인 + 타입/린트 검증**

Run:
```bash
grep -rn "getYearMonths" src/ | grep -v "__tests__" | grep -v "lib/cost-management/ad-spend.ts"
npx tsc --noEmit
```
Expected: 첫 명령은 결과 없음(라우트 외 참조 없음). tsc 통과.
- 만약 다른 참조가 없다면 `getYearMonths`는 라우트에서만 쓰였던 것 — 그래도 lib 파일/테스트는 그대로 둔다(YAGNI 범위 밖 삭제 지양).

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(cost): 상품 광고비 집계를 날짜 범위(product_ad_spend_daily)로 전환"
```

---

## Task 5: 정산 daily 라우트 — 광고비를 상품별 합계로 주입

**Files:**
- Modify: `src/app/api/settlement/daily/route.ts`
- Test: `src/__tests__/api/settlement-daily.test.ts` (신규)

- [ ] **Step 1: 정산 daily 라우트 테스트 작성**

`src/__tests__/api/settlement-daily.test.ts`:

```ts
/**
 * GET /api/settlement/daily
 * 광고비가 product_ad_spend_daily 날짜 합계에서 주입되는지 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/daily?${qs}`);
}

describe('GET /api/settlement/daily — 광고비 소스', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
  });

  it('그날 상품별 광고비 합계가 adSpend로 반영', async () => {
    // Promise.all 순서: sales, entries, expenses(daily_expenses), adDaily
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { sold_at: '2026-07-17', sale_amount: '30000', selling_price: '30000', quantity: '1', coupon_discount: '0', platform_fee_rate: '0.1' },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { expense_date: '2026-07-17', ad_spend: '99999', box_cost: '0', parcel_cost: '0' },
      ] })
      .mockResolvedValueOnce({ rows: [
        { ad_date: '2026-07-17', ad_spend: '12000' },
      ] });
    mockGetPool.mockReturnValue({ query: mockQuery });

    const { GET } = await import('@/app/api/settlement/daily/route');
    const res = await GET(req('from=2026-07-01&to=2026-07-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    const row = json.rows.find((r: { date: string }) => r.date === '2026-07-17');
    // daily_expenses.ad_spend(99999)은 무시, product_ad_spend_daily 합계(12000)만 반영
    expect(row.adSpend).toBe(12000);
    expect(row.netProfit).toBe(30000 - 3000 - 12000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/settlement-daily.test.ts`
Expected: FAIL — 현재 라우트는 쿼리 3개만 실행하고 `daily_expenses.ad_spend`(99999)를 그대로 씀 → adSpend가 99999.

- [ ] **Step 3: 라우트에 광고비 쿼리 추가 + 주입**

`src/app/api/settlement/daily/route.ts` 의 `Promise.all` 배열에 4번째 쿼리를 추가하고, `expenses` 매핑에서 `daily_expenses.ad_spend`를 무시(0)한 뒤 상품 합계를 별도 항목으로 push한다.

`Promise.all` 배열 마지막(`daily_expenses` 쿼리 뒤)에 추가:

```ts
      pool.query(
        `SELECT to_char(ad_date, 'YYYY-MM-DD') AS ad_date, SUM(ad_spend)::int AS ad_spend
           FROM product_ad_spend_daily
          WHERE user_id = $1 AND ad_date BETWEEN $2 AND $3
          GROUP BY ad_date`,
        [user.userId, from, to],
      ),
```

구조분해를 `const [salesRes, entriesRes, expensesRes, adRes] = await Promise.all([...])` 로 변경한다.

`expenses` 매핑을 아래로 교체(광고비는 daily_expenses에서 빼고 0으로):

```ts
    const expenses: SettlementExpense[] = expensesRes.rows.map((r) => ({
      expense_date: r.expense_date,
      ad_spend: 0, // 광고비는 product_ad_spend_daily 에서 주입
      box_cost: Number(r.box_cost ?? 0),
      parcel_cost: Number(r.parcel_cost ?? 0),
    }));
    // 상품별 날짜 광고비 합계를 별도 비용 항목으로 추가 (computeDailySettlement이 날짜별 합산)
    for (const r of adRes.rows) {
      expenses.push({
        expense_date: r.ad_date,
        ad_spend: Number(r.ad_spend ?? 0),
        box_cost: 0,
        parcel_cost: 0,
      });
    }
```

> 참고: `SettlementExpense`의 세 번째 비용 필드는 현재 코드 기준 `parcel_cost`다(`daily_expenses` 매핑과 동일). 인터페이스를 바꾸지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/settlement-daily.test.ts src/lib/settlement/__tests__/calculate.test.ts`
Expected: PASS (신규 + 기존 calculate 테스트 모두).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/settlement/daily/route.ts src/__tests__/api/settlement-daily.test.ts
git commit -m "feat(settlement): 일별 광고비를 상품별 합계에서 산출"
```

---

## Task 6: 정산 수동 비용 — 광고비 저장 중단

**Files:**
- Modify: `src/app/api/settlement/expenses/[date]/route.ts`
- Modify: `src/components/orders/ExpenseModal.tsx`

- [ ] **Step 1: expenses PUT에서 ad_spend를 0으로 고정**

`src/app/api/settlement/expenses/[date]/route.ts` 에서 `adSpend` 파싱 라인을 제거하고, INSERT의 ad_spend 자리에 `0`을 고정한다.

`const adSpend = toInt(body?.adSpend);` 라인 삭제.

`VALUES ($1, $2, $3, $4, $5, $6, $7)` INSERT를 그대로 두되, 파라미터 배열에서 adSpend를 0으로 교체:

```ts
      [user.userId, date, 0, boxCost, parcelCost, boxMemo, memo],
```

> 광고비는 이제 product_ad_spend_daily 에서만 관리한다. daily_expenses.ad_spend 컬럼은 남기되 항상 0.

- [ ] **Step 2: ExpenseModal에서 광고비 입력 제거**

`src/components/orders/ExpenseModal.tsx`:
- `const [adSpend, setAdSpend] = useState(String(initial?.adSpend ?? ''));` 라인 삭제.
- 저장 body에서 `adSpend: num(adSpend),` 제거 → `body: JSON.stringify({ parcelCost: num(parcelCost), boxCost: num(boxCost), boxMemo }),`
- 광고비 입력 블록(아래) 전체 삭제:

```tsx
        <div style={{ marginBottom: 12 }}>
          <label style={label}>광고비</label>
          <input type="number" value={adSpend} onChange={(e) => setAdSpend(e.target.value)} placeholder="0" style={input} />
        </div>
```

`ExpenseInitial` 인터페이스의 `adSpend: number;` 는 호출부 호환을 위해 남겨둔다(무시됨). 안내 문구가 필요하면 광고비 자리에 "광고비는 수익원가 탭에서 상품별로 입력합니다" 정도의 회색 문구를 넣어도 되지만 필수는 아니다.

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/settlement/expenses/[date]/route.ts src/components/orders/ExpenseModal.tsx
git commit -m "refactor(settlement): 수동 광고비 입력 은퇴 — 상품별 광고비로 일원화"
```

---

## Task 7: ProductRow — 미사용 onSaveAdSpend prop 제거

**Files:**
- Modify: `src/components/orders/cost-table/ProductRow.tsx`
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: ProductRow Props에서 onSaveAdSpend 제거**

`src/components/orders/cost-table/ProductRow.tsx` 의 Props 인터페이스에서 아래 라인 삭제:

```ts
  onSaveAdSpend: (productId: string, value: string) => void;
```

(ProductRow 본문은 이 prop을 사용하지 않으므로 그 외 변경 없음. 구조분해에 `onSaveAdSpend`가 포함돼 있으면 함께 제거.)

- [ ] **Step 2: CostManagementTab에서 ProductRow로의 전달 제거**

`src/components/orders/CostManagementTab.tsx` 의 두 `<ProductRowComponent ... />` 사용부에서 `onSaveAdSpend={saveAdSpend}` 라인을 삭제한다(총 2곳). `ProductDetailPanel` 로의 전달은 Task 8에서 수정하므로 지금은 그대로 둔다.

- [ ] **Step 3: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/cost-table/ProductRow.tsx src/components/orders/CostManagementTab.tsx
git commit -m "refactor(cost): ProductRow 미사용 onSaveAdSpend prop 제거"
```

---

## Task 8: 상세 패널 — 날짜별 광고비 리스트 UI

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`
- Modify: `src/components/orders/cost-table/ProductDetailPanel.tsx`

- [ ] **Step 1: CostManagementTab — saveAdSpend 시그니처 변경 + 기간 범위 전달**

`saveAdSpend` 를 날짜 인자를 받도록 교체(기존 함수 대체):

```ts
  async function saveAdSpend(productId: string, adDate: string, value: string) {
    const num = parseFloat(value.replace(/,/g, ''));
    if (isNaN(num) || num < 0) return;
    const res = await fetch(`/api/cost-management/products/${productId}/ad-spend`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ad_date: adDate, ad_spend: num }),
    });
    const json = await res.json();
    if (!json.success) {
      toast.error(json.error ?? '광고비 저장 실패');
      return;
    }
    // 저장 성공 후 해당 상품의 기간 광고비 합계를 재조회해 행 지표 갱신
    const range = getDateRange(preset, customFrom, customTo);
    if (!range) return;
    const listRes = await fetch(
      `/api/cost-management/products/${productId}/ad-spend?from=${range.from}&to=${range.to}`,
    );
    const listJson = await listRes.json();
    if (!listJson.success) return;
    const total = (listJson.data as Array<{ ad_spend: number }>).reduce((s, d) => s + d.ad_spend, 0);
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        const newRoas = total > 0 ? (p.total_sales_amount / total) * 100 : 0;
        return {
          ...p,
          ad_spend: total,
          ad_roas: newRoas,
          winner_status: determineWinnerStatus(p.sale_quantity, newRoas, p.breakeven_roas),
        };
      }),
    );
  }
```

`getCurrentYearMonth()`, `isEditablePeriod` 관련 월 기반 로직은 유지하되, 상세 패널에는 날짜 범위를 넘긴다. `ProductDetailPanel` 를 렌더링하는 두 곳(그룹 자식/최상위)에 prop 을 아래처럼 변경:

- `onSaveAdSpend={saveAdSpend}` (시그니처가 3인자로 바뀜)
- 새 prop `dateRange={getDateRange(preset, customFrom, customTo)}` 추가

두 `<ProductDetailPanel ... />` 사용부 모두에 `dateRange={getDateRange(preset, customFrom, customTo)}` 를 추가한다. (기존 `isEditablePeriod` prop 은 유지.)

- [ ] **Step 2: ProductDetailPanel — Props/시그니처 변경**

`src/components/orders/cost-table/ProductDetailPanel.tsx` 상단 Props 를 교체:

```ts
interface Props {
  product: DetailProduct;
  colSpan: number;
  isEditablePeriod: boolean;
  dateRange: { from: string; to: string } | null;
  onOpenDrawer: (productId: string) => void;
  onSaveAdSpend: (productId: string, adDate: string, value: string) => void;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
  rgInventoryLoading: boolean;
  fifoError?: boolean;
}
```

컴포넌트 시그니처 구조분해에 `dateRange` 추가, 기존 `editingAd`/`adValue`/`committedRef` 단일 입력 상태는 제거(리스트 방식으로 대체).

- [ ] **Step 3: 날짜 열거 헬퍼 + 로컬 상태 추가**

`import React, { useState, useRef } from 'react';` → `import React, { useState, useEffect } from 'react';` 로 변경.

파일 상단(`const fmt` 근처)에 헬퍼 추가:

```ts
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}
```

컴포넌트 본문 상단에 상태 + 로드 추가:

```ts
  const [adByDate, setAdByDate] = useState<Record<string, number>>({});
  const [adLoading, setAdLoading] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!dateRange) return;
    setAdLoading(true);
    fetch(`/api/cost-management/products/${product.id}/ad-spend?from=${dateRange.from}&to=${dateRange.to}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const map: Record<string, number> = {};
          for (const d of json.data as Array<{ ad_date: string; ad_spend: number }>) {
            map[d.ad_date] = d.ad_spend;
          }
          setAdByDate(map);
        }
      })
      .finally(() => setAdLoading(false));
  }, [product.id, dateRange?.from, dateRange?.to]);

  const commitEdit = (adDate: string) => {
    const num = parseFloat(editValue.replace(/,/g, ''));
    const safe = isNaN(num) || num < 0 ? 0 : num;
    setAdByDate((prev) => ({ ...prev, [adDate]: safe })); // 낙관적
    onSaveAdSpend(product.id, adDate, String(safe));
    setEditingDate(null);
  };
```

- [ ] **Step 4: 광고비 리스트 렌더링으로 교체**

기존 상세 패널의 광고비 버튼/인라인 input 블록(`{!editingAd ? (...) : (...)}` 전체, 대략 74–97행)을 삭제하고, 그 자리에 아래 리스트를 넣는다. `입고·판매 관리` 버튼은 유지한다.

`<div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>` 안의 광고비 파트만 아래 리스트로 대체하되, 리스트는 폭이 있으므로 이 컨테이너 밖(패널 하단)에 별도 섹션으로 배치한다. 구체적으로: 기존 `<div style={{ display:'flex', gap:8, marginLeft:'auto' }}>` 는 `입고·판매 관리` 버튼만 남기고, 그 아래(같은 `<td>` 내부, stat 그리드 컨테이너 다음)에 광고비 섹션을 추가:

```tsx
        {/* 광고비 (날짜별) */}
        <div style={{ marginTop: 14, borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: '#71717a', fontWeight: 600, marginBottom: 6 }}>
            광고비 {dateRange ? `(${dateRange.from} ~ ${dateRange.to})` : ''}
          </div>
          {!dateRange ? (
            <div style={{ fontSize: 11, color: '#a1a1aa' }}>
              특정 기간(이번 달·직접 입력 등)을 선택하면 날짜별로 입력할 수 있습니다.
            </div>
          ) : adLoading ? (
            <div style={{ fontSize: 11, color: '#a1a1aa' }}>불러오는 중…</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 320 }}>
              {eachDate(dateRange.from, dateRange.to).map((d) => {
                const val = adByDate[d] ?? 0;
                return (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '3px 6px', borderRadius: 6 }}>
                    <span style={{ fontSize: 11, color: '#71717a', fontVariantNumeric: 'tabular-nums' }}>{d.slice(5)}</span>
                    {editingDate === d ? (
                      <input
                        autoFocus
                        aria-label={`${d} 광고비 입력`}
                        type="number"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(d);
                          if (e.key === 'Escape') setEditingDate(null);
                        }}
                        onBlur={() => commitEdit(d)}
                        style={{ width: 100, padding: '3px 6px', borderRadius: 6, border: '1px solid #7c3aed', fontSize: 12, textAlign: 'right' }}
                      />
                    ) : (
                      <button
                        onClick={() => { setEditingDate(d); setEditValue(val > 0 ? String(val) : ''); }}
                        style={{ minWidth: 100, textAlign: 'right', padding: '3px 6px', borderRadius: 6, border: '1px solid #e4e4e7', background: '#fff', fontSize: 12, cursor: 'pointer', color: val > 0 ? '#7c3aed' : '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {val > 0 ? `₩ ${fmt(val)}` : '입력'}
                      </button>
                    )}
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px', borderTop: '1px solid #eee', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#3f3f46', fontWeight: 600 }}>합계</span>
                <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  ₩ {fmt(Object.values(adByDate).reduce((s, v) => s + v, 0))}
                </span>
              </div>
            </div>
          )}
        </div>
```

> `isEditablePeriod` prop 은 시그니처 유지를 위해 남기되, 날짜별 편집은 `dateRange` 존재 여부로만 제어한다(스펙: 선택 기간 내 모든 날짜 편집 허용).

- [ ] **Step 5: 타입/린트 검증**

Run: `npx tsc --noEmit`
Expected: 통과(미사용 `isEditablePeriod` 경고가 나오면 JSX에 남겨진 참조 확인; 사용처 없으면 Props에서 제거하고 CostManagementTab 전달부도 함께 제거).

- [ ] **Step 6: 수동 확인**

Run: `npm run dev` (또는 이 저장소 실행 스크립트)
확인:
1. 수익원가 탭 → 기간 "이번 달" → 상품 행 펼치기 → 광고비 섹션에 이번 달 날짜 리스트 표시.
2. 특정 날짜 "입력" 클릭 → 금액 입력 → Enter → 합계 및 행 ROAS 갱신.
3. 정산 서브탭에서 해당 날짜 광고비가 상품 합계로 반영되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx src/components/orders/cost-table/ProductDetailPanel.tsx
git commit -m "feat(cost): 상세 패널 날짜별 광고비 입력 리스트"
```

---

## Task 9: 전체 검증

- [ ] **Step 1: 관련 테스트 일괄 실행**

Run:
```bash
npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts src/__tests__/api/settlement-daily.test.ts src/lib/settlement/__tests__/calculate.test.ts src/__tests__/api/settlement-expenses.test.ts
```
Expected: 전부 PASS.

> 참고: 인자 없는 `npx vitest run` 은 라이브러리 테스트까지 돌아 무관한 선재 실패가 날 수 있으므로 경로를 지정해 회귀를 판단한다.

- [ ] **Step 2: 타입/린트 최종 검증**

Run:
```bash
npx tsc --noEmit
npm run lint
```
Expected: 통과.

- [ ] **Step 3: 스펙 커버리지 자가 점검**

스펙 각 섹션이 태스크로 구현됐는지 확인:
- 데이터 모델(§1) → Task 1
- 월별 이관(§2) → Task 1 Step 1
- API PATCH/GET/products(§3) → Task 2·3·4
- 정산 연동(§4) → Task 5·6
- UI(§5) → Task 7·8
- 테스트(§6) → Task 2·3·5 + Task 9

---

## Notes

- **DB 접근**: 마이그레이션·수동 확인은 로컬에서 Claude Max 요금제 기준으로 진행. 프로덕션 DB 접근이 필요하면 사용자에게 `! psql ...` 실행을 요청한다.
- **미삭제 대상(후속 정리)**: `product_ad_spend` 테이블, `daily_expenses.ad_spend` 컬럼, `getYearMonths`/그 테스트 — 안전을 위해 이번 범위에서 물리 삭제하지 않는다.
- **긴 기간 표시**: 3·6개월 선택 시 리스트는 스크롤(`maxHeight`)로 처리. 값 있는 날만 압축 표시는 범위 밖.
