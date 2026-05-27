# 상품별 월별 수동 광고비 입력 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수익 원가 탭 테이블에서 상품별 광고비 셀을 인라인 클릭으로 편집하고, `product_ad_spend` 테이블에 월별로 저장한 뒤 ROAS를 자동 계산한다.

**Architecture:** Render PostgreSQL(`SOURCING_DATABASE_URL`)에 `product_ad_spend` 테이블 추가. `PATCH /api/cost-management/products/[id]/ad-spend`로 upsert. `GET /api/cost-management/products`에서 `ad_strategy_cache` 매칭 로직을 제거하고 `product_ad_spend` 합산 쿼리로 대체. `CostManagementTab`에서 단일 월 기간일 때만 광고비 셀 인라인 편집 허용, ROAS는 서버에서 `periodSalesAmount / adSpend * 100`으로 계산해 반환.

**Tech Stack:** Next.js 15 App Router, PostgreSQL (pg pool via `SOURCING_DATABASE_URL`), React, TypeScript, Vitest

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `supabase/migrations/073_product_ad_spend.sql` | NEW — `product_ad_spend` 테이블 생성 |
| `src/lib/cost-management/ad-spend.ts` | NEW — `getYearMonths()` 순수 유틸 |
| `src/lib/cost-management/__tests__/ad-spend.test.ts` | NEW — `getYearMonths()` 단위 테스트 |
| `src/app/api/cost-management/products/[id]/ad-spend/route.ts` | NEW — PATCH upsert 엔드포인트 |
| `src/app/api/cost-management/products/route.ts` | MODIFY — `ad_spend` 소스를 `product_ad_spend` JOIN으로 교체, `ad_strategy_cache` 로직 제거 |
| `src/components/orders/CostManagementTab.tsx` | MODIFY — 인라인 편집 상태, 셀 클릭 핸들러, 편집 가능 기간 판단 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/073_product_ad_spend.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 073_product_ad_spend.sql
-- 상품별 월별 수동 광고비 테이블
-- product_costs 와 동일하게 Render PostgreSQL (SOURCING_DATABASE_URL) 에 적용
-- user_id 는 FK 없이 uuid 로만 관리 (기존 product_costs 패턴 동일)

CREATE TABLE IF NOT EXISTS product_ad_spend (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  product_id   UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  year_month   CHAR(7) NOT NULL,
  ad_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, year_month)
);

CREATE INDEX IF NOT EXISTS product_ad_spend_user_product_idx
  ON product_ad_spend (user_id, product_id);

CREATE INDEX IF NOT EXISTS product_ad_spend_user_month_idx
  ON product_ad_spend (user_id, year_month);

COMMENT ON TABLE product_ad_spend IS '상품별 월별 수동 광고비 입력 이력';
COMMENT ON COLUMN product_ad_spend.year_month IS 'YYYY-MM 형식, 예: 2026-05';
```

- [ ] **Step 2: 마이그레이션 적용**

터미널에서 실행:
```bash
psql $SOURCING_DATABASE_URL -f supabase/migrations/073_product_ad_spend.sql
```

성공 시 출력:
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
COMMENT
COMMENT
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/073_product_ad_spend.sql
git commit -m "feat(db): product_ad_spend 테이블 추가 — 상품별 월별 수동 광고비"
```

---

## Task 2: `getYearMonths` 유틸 (TDD)

**Files:**
- Create: `src/lib/cost-management/ad-spend.ts`
- Create: `src/lib/cost-management/__tests__/ad-spend.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/cost-management/__tests__/ad-spend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getYearMonths } from '../ad-spend';

describe('getYearMonths', () => {
  it('같은 달이면 1개 반환', () => {
    expect(getYearMonths('2026-05-01', '2026-05-31')).toEqual(['2026-05']);
  });

  it('두 달 범위면 2개 반환', () => {
    expect(getYearMonths('2026-04-15', '2026-05-10')).toEqual(['2026-04', '2026-05']);
  });

  it('3개월 범위', () => {
    expect(getYearMonths('2026-03-01', '2026-05-31')).toEqual(['2026-03', '2026-04', '2026-05']);
  });

  it('from이 null이면 빈 배열', () => {
    expect(getYearMonths(null, '2026-05-31')).toEqual([]);
  });

  it('to가 null이면 빈 배열', () => {
    expect(getYearMonths('2026-05-01', null)).toEqual([]);
  });

  it('둘 다 null이면 빈 배열', () => {
    expect(getYearMonths(null, null)).toEqual([]);
  });

  it('연도가 바뀌는 범위', () => {
    expect(getYearMonths('2025-11-01', '2026-01-31')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/ad-spend.test.ts
```

Expected: `Error: Cannot find module '../ad-spend'`

- [ ] **Step 3: 구현 작성**

`src/lib/cost-management/ad-spend.ts`:
```ts
/**
 * from~to 날짜 범위에 포함된 'YYYY-MM' 목록을 반환한다.
 * product_ad_spend 테이블 조회 시 사용.
 */
export function getYearMonths(from: string | null, to: string | null): string[] {
  if (!from || !to) return [];
  const months: string[] = [];
  const end = new Date(to);
  const cur = new Date(from);
  cur.setDate(1);
  while (cur <= end) {
    months.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
    );
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/ad-spend.test.ts
```

Expected: 7 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/ad-spend.ts src/lib/cost-management/__tests__/ad-spend.test.ts
git commit -m "feat(lib): getYearMonths 유틸 추가 — 기간 필터를 year_month 목록으로 변환"
```

---

## Task 3: PATCH API 엔드포인트 (TDD)

**Files:**
- Create: `src/app/api/cost-management/products/[id]/ad-spend/route.ts`
- Create: `src/__tests__/api/cost-management-ad-spend.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/cost-management-ad-spend.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/cost-management/products/${id}/ad-spend`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/cost-management/products/[id]/ad-spend', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'row-uuid', product_id: 'prod-uuid', year_month: '2026-05', ad_spend: '150000' }],
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(401);
  });

  it('year_month 형식이 잘못되면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-5', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/year_month/);
  });

  it('ad_spend 음수이면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: -1000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/ad_spend/);
  });

  it('정상 요청이면 upsert 쿼리 실행 후 200', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/ad-spend/route');
    const res = await PATCH(makeRequest('prod-uuid', { year_month: '2026-05', ad_spend: 150000 }), {
      params: Promise.resolve({ id: 'prod-uuid' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT/i);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts
```

Expected: `Error: Cannot find module '@/app/api/cost-management/products/[id]/ad-spend/route'`

- [ ] **Step 3: 라우트 구현**

`src/app/api/cost-management/products/[id]/ad-spend/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { year_month, ad_spend } = body ?? {};

  if (!year_month || !YEAR_MONTH_RE.test(year_month)) {
    return NextResponse.json(
      { success: false, error: 'year_month must be in YYYY-MM format' },
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
    `INSERT INTO product_ad_spend (user_id, product_id, year_month, ad_spend, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, product_id, year_month)
     DO UPDATE SET ad_spend = EXCLUDED.ad_spend, updated_at = now()
     RETURNING id, product_id, year_month, ad_spend`,
    [user.userId, id, year_month, ad_spend],
  );

  return NextResponse.json({ success: true, data: rows[0] });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/cost-management-ad-spend.test.ts
```

Expected: 4 passed

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/ad-spend/route.ts \
        src/__tests__/api/cost-management-ad-spend.test.ts
git commit -m "feat(api): PATCH /products/[id]/ad-spend — 월별 광고비 upsert"
```

---

## Task 4: GET products API 수정

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

이 태스크는 기존 파일 수정. 핵심 변경:
1. `ad_strategy_cache` 관련 코드 전체 제거
2. `getYearMonths`로 `year_month` 목록 추출
3. `product_ad_spend` 합산 쿼리 추가
4. 각 상품의 `adSpend`를 맵에서 읽어 `ad_roas` 서버 계산

- [ ] **Step 1: import 변경**

파일 상단에서 제거:
```ts
// 제거할 import
import type { CollectedData, RawProduct } from '@/lib/ad-strategy/types';
import { matchAdProduct } from '@/lib/ad-strategy/match';
```

추가:
```ts
import { getYearMonths } from '@/lib/cost-management/ad-spend';
```

- [ ] **Step 2: `ad_strategy_cache` 쿼리 블록 제거 및 `product_ad_spend` 쿼리 추가**

제거할 블록 (route.ts 105~116번째 줄):
```ts
// ad_strategy_cache에서 최신 광고 데이터 조회 (24시간 이내)
const supabase = getSupabaseServerClient();
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const adCacheResult = await supabase
  .from('ad_strategy_cache')
  .select('collected_data')
  .eq('user_id', user.userId)
  .gte('collected_at', cutoff)
  .order('collected_at', { ascending: false })
  .limit(1)
  .single();
const adProducts: RawProduct[] = (adCacheResult.data?.collected_data as CollectedData)?.products ?? [];
```

대체할 코드 (같은 위치에 삽입):
```ts
// product_ad_spend 테이블에서 기간 내 광고비 합산
const yearMonths = getYearMonths(from, to);
const adSpendByProduct = new Map<string, number>();
if (yearMonths.length > 0) {
  const { rows: adRows } = await pool.query(
    `SELECT product_id, SUM(ad_spend)::float AS total_ad_spend
     FROM product_ad_spend
     WHERE user_id = $1 AND year_month = ANY($2::text[])
     GROUP BY product_id`,
    [user.userId, yearMonths],
  );
  for (const row of adRows) {
    adSpendByProduct.set(row.product_id, Number(row.total_ad_spend));
  }
}
```

- [ ] **Step 3: 광고 데이터 매칭 로직 교체**

제거할 블록 (route.ts 178~192번째 줄, 이미 위치가 밀렸을 수 있음 — 내용으로 찾기):
```ts
// 광고 데이터 매칭
const adMatch = matchAdProduct(adProducts, p.product_name);
const adSpend = adMatch?.adSpend ?? 0;
const adRoas = adMatch?.adRoas ?? 0;
const adOrders = adMatch?.adOrders ?? 0;

// ROI 계산
const totalQtySold = pFilteredSales.reduce((s, x) => s + x.quantity, 0);
const marginRate = periodSalesAmount > 0 ? periodRealizedProfit / periodSalesAmount : 0;
const avgSellingPrice = totalQtySold > 0 ? periodSalesAmount / totalQtySold : 0;
const avgMarginPerUnit = totalQtySold > 0 ? periodRealizedProfit / totalQtySold : 0;
const breakevenRoas = calcBreakevenRoas(avgSellingPrice, avgMarginPerUnit);
const conversionRate = adOrders > 0 ? (totalQtySold / adOrders) * 100 : 0;
const winnerStatus = isWinner(adOrders, conversionRate, adRoas, totalQtySold);
```

대체:
```ts
// product_ad_spend 에서 광고비 조회 및 ROAS 계산
const adSpend = adSpendByProduct.get(p.id) ?? 0;
const adRoas = adSpend > 0 ? (periodSalesAmount / adSpend) * 100 : 0;

// ROI 계산
const totalQtySold = pFilteredSales.reduce((s, x) => s + x.quantity, 0);
const marginRate = periodSalesAmount > 0 ? periodRealizedProfit / periodSalesAmount : 0;
const avgSellingPrice = totalQtySold > 0 ? periodSalesAmount / totalQtySold : 0;
const avgMarginPerUnit = totalQtySold > 0 ? periodRealizedProfit / totalQtySold : 0;
const breakevenRoas = calcBreakevenRoas(avgSellingPrice, avgMarginPerUnit);
const winnerStatus = isWinner(0, 0, adRoas, totalQtySold);
```

- [ ] **Step 4: 사용하지 않게 된 Supabase import 제거**

`route.ts` 상단에서 Supabase 관련 import가 `ad_strategy_cache` 조회에만 쓰인다면 제거:
```ts
// 제거 (ad_strategy_cache 조회에만 사용됐던 경우)
import { getSupabaseServerClient } from '@/lib/supabase/server';
```

> **주의:** `getSupabaseServerClient`가 다른 곳에도 쓰이는지 파일 내 검색 후 결정

- [ ] **Step 5: 서버 실행 및 수동 확인**

```bash
npx next dev
```

브라우저에서 수익 원가 탭 → 상품 목록 로드 확인. 광고비 컬럼이 `—`로 뜨면 정상 (DB에 데이터 없음).
콘솔 에러 없어야 함.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts \
        src/lib/cost-management/ad-spend.ts
git commit -m "feat(api): products GET — ad_strategy_cache → product_ad_spend 광고비 소스 교체"
```

---

## Task 5: UI 인라인 편집

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: 인라인 편집 상태 및 헬퍼 추가**

`useState` 선언 블록(파일 내 기존 상태 선언 아래)에 추가:
```ts
const [editingAdSpendId, setEditingAdSpendId] = useState<string | null>(null);
const [editingAdSpendValue, setEditingAdSpendValue] = useState('');
```

기존 상태 선언 블록 이후(컴포넌트 함수 내, return 문 위)에 헬퍼 추가:
```ts
const isEditablePeriod =
  preset === 'this_month' ||
  preset === 'last_month' ||
  (preset === 'custom' &&
    customFrom !== '' &&
    customTo !== '' &&
    customFrom.slice(0, 7) === customTo.slice(0, 7));

function getCurrentYearMonth(): string {
  if (preset === 'this_month') {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (preset === 'last_month') {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // custom 단일 월
  return customFrom.slice(0, 7);
}

async function saveAdSpend(productId: string, value: string) {
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num) || num < 0) {
    setEditingAdSpendId(null);
    return;
  }
  const yearMonth = getCurrentYearMonth();
  const res = await fetch(`/api/cost-management/products/${productId}/ad-spend`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year_month: yearMonth, ad_spend: num }),
  });
  const json = await res.json();
  if (json.success) {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              ad_spend: num,
              ad_roas: num > 0 ? (p.total_sales_amount / num) * 100 : 0,
            }
          : p,
      ),
    );
  }
  setEditingAdSpendId(null);
}
```

- [ ] **Step 2: `ProductRow` 타입에 `total_sales_amount` 확인**

파일 상단 `ProductRow` 인터페이스에 `total_sales_amount`가 있는지 확인. 없으면 추가:
```ts
interface ProductRow {
  // ... 기존 필드들
  total_sales_amount: number;  // 추가 (이미 API 응답에 포함됨)
}
```

- [ ] **Step 3: 광고비 셀 렌더링 교체**

테이블 tbody 내 광고비 td (현재 코드):
```tsx
<td style={{ padding: '10px 12px', textAlign: 'right', color: p.ad_spend > 0 ? '#7c3aed' : '#ccc' }}>
  {p.ad_spend > 0 ? `${fmt(p.ad_spend)}원` : '—'}
</td>
```

교체:
```tsx
<td
  style={{
    padding: editingAdSpendId === p.id ? '6px 12px' : '10px 12px',
    textAlign: 'right',
    color: p.ad_spend > 0 ? '#7c3aed' : '#ccc',
    cursor: isEditablePeriod ? 'pointer' : 'default',
    position: 'relative',
  }}
  onClick={() => {
    if (!isEditablePeriod || editingAdSpendId === p.id) return;
    setEditingAdSpendId(p.id);
    setEditingAdSpendValue(p.ad_spend > 0 ? String(p.ad_spend) : '');
  }}
  title={!isEditablePeriod ? '단일 월을 선택하면 편집할 수 있습니다' : undefined}
>
  {editingAdSpendId === p.id ? (
    <input
      autoFocus
      type="number"
      min="0"
      value={editingAdSpendValue}
      onChange={(e) => setEditingAdSpendValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') saveAdSpend(p.id, editingAdSpendValue);
        if (e.key === 'Escape') setEditingAdSpendId(null);
      }}
      onBlur={() => saveAdSpend(p.id, editingAdSpendValue)}
      style={{
        width: '90px',
        padding: '3px 6px',
        fontSize: '12px',
        border: '1px solid #7c3aed',
        borderRadius: '4px',
        textAlign: 'right',
        outline: 'none',
      }}
    />
  ) : (
    <span>
      {p.ad_spend > 0 ? `${fmt(p.ad_spend)}원` : (isEditablePeriod ? <span style={{ color: '#d4b8ff' }}>+ 입력</span> : '—')}
    </span>
  )}
</td>
```

- [ ] **Step 4: ROAS 셀 색상을 `breakeven_roas` 대비로 수정**

동일 파일 내 ROAS td (현재 코드):
```tsx
<td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: p.ad_roas > 0 ? 600 : 400,
  color: p.ad_roas === 0 ? '#ccc' : p.ad_roas >= 250 ? '#16a34a' : '#ef4444' }}>
  {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
</td>
```

교체:
```tsx
<td style={{
  padding: '10px 12px', textAlign: 'right', fontWeight: p.ad_roas > 0 ? 600 : 400,
  color: p.ad_roas === 0 ? '#ccc'
    : p.ad_roas >= p.breakeven_roas ? '#16a34a'
    : '#ef4444',
}}>
  {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
</td>
```

- [ ] **Step 5: 서버 실행 및 동작 확인**

```bash
npx next dev
```

확인 항목:
1. 수익 원가 탭 → "이번 달" 선택 → 광고비 셀에 마우스 올리면 커서 `pointer`
2. 광고비 셀 클릭 → input으로 전환, 숫자 입력 가능
3. 값 입력 후 Enter → 저장, 셀이 다시 값 표시로 전환
4. ROAS 컬럼 즉시 업데이트 확인
5. "최근 3개월" 선택 → 광고비 셀 클릭 안 됨, 호버 시 툴팁 "단일 월을 선택하면 편집할 수 있습니다"
6. 저장 후 다른 기간으로 바꿨다가 같은 달로 돌아오면 저장된 값 표시

- [ ] **Step 6: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): 수익 원가 탭 — 광고비 인라인 클릭 편집 + ROAS 자동 계산"
```
