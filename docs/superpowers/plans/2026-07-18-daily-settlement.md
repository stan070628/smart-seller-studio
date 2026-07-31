# 일일 정산 (일일 손익) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/orders`에 `정산` 서브탭을 신설해 날짜별 일일 손익(매출·쿠폰·수수료·매입·택배비·광고비·박스비·순이익)을 현금 기준으로 확정·표시한다.

**Architecture:** 신규 테이블 `daily_expenses`(일별 수동 비용) 1개. 계산은 런타임 순수 함수(`src/lib/settlement/`)로 `sale_records`+`cost_entries`+`daily_expenses`를 날짜로 병합. 매출·수수료는 방금 머지된 `sale_amount` 총액 축(`fifo.ts`와 동일 규약)을 따른다. 외부 API 호출 없음.

**Tech Stack:** Next.js App Router (Route Handlers), Render PostgreSQL (`getSourcingPool`), React 클라이언트 컴포넌트, Vitest.

**참조 스펙:** `docs/superpowers/specs/2026-07-17-daily-settlement-design.md`

---

## 스펙 대비 변경점 (작업자 필독)

스펙은 선행 작업(`sale_amount`) 머지 **전에** 작성됐다. 아래는 현재 코드 기준으로 스펙을 갱신한 것이다. **충돌 시 이 플랜이 우선.**

1. **매출 = `sale_amount ?? (selling_price × quantity)`.** 스펙 §6의 "실매출 총액 (§4.1 계약에 의존)"이 이것으로 구체화됐다. `sale_amount` 컬럼은 이미 존재(마이그 087, 머지 완료).
2. **수수료는 총액 축.** 스펙 §6의 `Σ(round((selling_price - coupon) × rate) × quantity)`(단가 축)는 **폐기.** 머지된 `fifo.ts`가 총액 축으로 바뀌었으므로, 두 탭 숫자를 맞추려면 **판매 건별로** `fee = round((revenue - coupon) × platform_fee_rate)`를 계산해 합산한다(아래 Task 3에 정확한 식).
3. **마이그레이션 번호**: 스펙 §7/§10은 "087"이라 했으나 087은 `sale_amount`가 차지함. 본 플랜은 **088**(shipping_fee 복구), **089**(daily_expenses)를 쓴다.
4. **선행 §4.1(multiplier)은 완료**(머지됨). **§4.2(shipping_fee 마이그레이션 부재)는 미해결** — Task 1로 흡수.
5. **테스트 위치**: 스펙은 `src/__tests__/lib/settlement`라 했으나, 계산 모듈과 co-locate하는 `fifo.ts` 관례를 따라 `src/lib/settlement/__tests__/`에 둔다.

## 배경 요약

- **현금 기준 손익**: 매입은 물건 **산 날**(`cost_entries.received_at`) 비용으로 인식(FIFO 아님). 그래서 원가 탭과 순이익이 다르며 이는 의도된 차이다.
- **대상 채널**: 쿠팡 윙(`coupang`) + RG(`rocket_growth`)만. `voided_at IS NULL`. `manual`·`naver` 제외.
- **비용**: 광고비·박스비는 일별 총액 수동 입력(`daily_expenses`). 택배비는 `sale_records.shipping_fee` 합계. 매입은 `cost_entries` 자동 집계. 실제 택배 청구 차액은 `parcel_adjustment`.

## 파일 구조

- **생성**: `supabase/migrations/088_sale_records_shipping_fee.sql` — 누락 컬럼 복구
- **생성**: `supabase/migrations/089_daily_expenses.sql` — 신규 테이블
- **생성**: `src/lib/settlement/calculate.ts` — 순수 계산 함수 (핵심)
- **생성**: `src/lib/settlement/__tests__/calculate.test.ts` — 단위 테스트
- **생성**: `src/app/api/settlement/daily/route.ts` — 일일 손익 조회
- **생성**: `src/app/api/settlement/expenses/[date]/route.ts` — 수동 비용 upsert
- **생성**: `src/components/orders/SettlementTab.tsx` — 정산 탭 UI
- **수정**: `src/components/orders/OrdersClient.tsx` — 서브탭에 `settlement` 추가

## 테스트 전략 메모

정합성의 핵심은 순수 함수 `computeDailySettlement`에 있으므로 **Task 3에 가장 강한 TDD**를 건다. 라우트는 pool 목킹 패턴(`cost-management-ad-spend.test.ts` 참조)으로 upsert/집계를 검증. UI는 typecheck + 수동 확인. vitest는 이 환경에서 느릴 수 있으니(디스크 I/O) 300s 타임아웃, 경로 지정 필수.

---

### Task 1: 마이그레이션 088 — sale_records.shipping_fee 복구

**Files:**
- Create: `supabase/migrations/088_sale_records_shipping_fee.sql`

`sale_records.shipping_fee`는 운영 DB에 수동 적용돼 있으나 마이그레이션 파일이 저장소에 없다(신선 DB 재현 불가). 라이브 정의는 `integer NOT NULL DEFAULT 0`. 복구 마이그레이션은 컬럼만 추가한다(백필 UPDATE는 생략 — 신선 DB에서 sale_records가 비어 있어 무의미하고, 라이브에서 재실행 시 수동 편집값을 덮을 위험만 있다).

- [ ] **Step 1: 파일 작성**

```sql
-- 088_sale_records_shipping_fee.sql
-- sale_records.shipping_fee 복구.
-- 이 컬럼은 2026-06-21-sale-shipping-fee 스펙에서 도입돼 운영 DB에 수동 적용됐으나
-- 마이그레이션 파일이 저장소에 누락돼 있었다(신선 DB 재현 불가). 이를 복구한다.
-- 라이브 정의: integer NOT NULL DEFAULT 0. 신규 행의 채널별 값(쿠팡/네이버 3500,
-- RG 0)은 앱의 resolveSaleShippingFee가 설정하므로 백필 UPDATE는 두지 않는다.
-- IF NOT EXISTS라 컬럼이 이미 있는 운영 DB에는 무해.

ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS shipping_fee int NOT NULL DEFAULT 0;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/088_sale_records_shipping_fee.sql
git commit -m "fix(db): sale_records.shipping_fee 복구 마이그레이션 (088)"
```

---

### Task 2: 마이그레이션 089 — daily_expenses 테이블

**Files:**
- Create: `supabase/migrations/089_daily_expenses.sql`

`product_ad_spend`(074)를 템플릿으로 하되 항목별 컬럼 구조. `handle_updated_at()` 트리거 재사용. RLS는 활성화하되 정책 없음(서버는 `getSourcingPool` 직접 연결=owner라 RLS 우회, Supabase anon/authenticated 직접 접근만 차단 — 054의 `negotiation_logs` 원칙).

- [ ] **Step 1: 파일 작성**

```sql
-- 089_daily_expenses.sql
-- 일별 수동 비용 (광고비·박스비·택배비 정산차). 하루 한 행 × 항목별 컬럼.
-- user_id 는 FK 없이 uuid (기존 커스텀 auth_users 패턴, product_ad_spend와 동일).

CREATE TABLE IF NOT EXISTS daily_expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  expense_date      DATE NOT NULL,
  ad_spend          INT NOT NULL DEFAULT 0,
  box_cost          INT NOT NULL DEFAULT 0,
  box_memo          TEXT,
  parcel_adjustment INT NOT NULL DEFAULT 0,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, expense_date)
);

CREATE INDEX IF NOT EXISTS daily_expenses_user_date_idx
  ON daily_expenses (user_id, expense_date DESC);

COMMENT ON TABLE daily_expenses IS '일별 수동 비용 (광고비·박스비·택배비 정산차). spec 2026-07-17';
COMMENT ON COLUMN daily_expenses.box_cost IS '박스 구매액. 구매한 날에만 값(구매 시점 일괄 비용).';
COMMENT ON COLUMN daily_expenses.parcel_adjustment IS '실제 택배 청구서와의 차액. 음수 허용.';

CREATE TRIGGER trg_daily_expenses_updated_at
  BEFORE UPDATE ON daily_expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: 활성화하되 정책 없음. 서버 API는 owner 연결로 우회, Supabase 클라이언트
-- 직접 접근만 차단(054 negotiation_logs 원칙).
ALTER TABLE daily_expenses ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/089_daily_expenses.sql
git commit -m "feat(db): daily_expenses 테이블 (089)"
```

---

### Task 3: 계산 함수 + 단위 테스트 (핵심 TDD)

**Files:**
- Create: `src/lib/settlement/calculate.ts`
- Test: `src/lib/settlement/__tests__/calculate.test.ts`

순수 함수. 입력은 route가 DB에서 뽑아 정규화한 배열 3종. 매출·수수료는 머지된 `fifo.ts`와 동일한 총액 축.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/settlement/__tests__/calculate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeDailySettlement } from '../calculate';

const noEntries: never[] = [];
const noExpenses: never[] = [];

describe('computeDailySettlement', () => {
  it('매출은 sale_amount 우선, 수수료는 (매출-쿠폰)×수수료율 건별 반올림', () => {
    const sales = [
      // 2개입 한 팩: sale_amount=30000, quantity=2, 수수료율 0.1
      { sold_at: '2026-07-16', sale_amount: 30000, selling_price: 30000, quantity: 2, coupon_discount: 0, shipping_fee: 3500, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    const r = rows[0];
    expect(r.date).toBe('2026-07-16');
    expect(r.revenue).toBe(30000);
    expect(r.platformFee).toBe(3000);     // round(30000 * 0.1)
    expect(r.parcelFee).toBe(3500);
    // 순이익 = 30000 - 0(쿠폰) - 3000(수수료) - 0(매입) - 3500(택배) - 0 - 0 + 0
    expect(r.netProfit).toBe(23500);
  });

  it('sale_amount 없으면 selling_price × quantity 폴백', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: null, selling_price: 20000, quantity: 3, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows[0].revenue).toBe(60000);
    expect(rows[0].platformFee).toBe(6000);
  });

  it('쿠폰은 수수료 계산 전 차감 (건별)', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 40000, selling_price: 40000, quantity: 2, coupon_discount: 6000, shipping_fee: 0, platform_fee_rate: 0.1 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows[0].couponDiscount).toBe(6000);
    expect(rows[0].platformFee).toBe(3400);  // round((40000-6000)*0.1)
    expect(rows[0].netProfit).toBe(40000 - 6000 - 3400);  // 30600
  });

  it('상품별 수수료율이 다르면 건별 계산 후 합산', () => {
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.108 },
      { sold_at: '2026-07-16', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0.05 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, noExpenses);
    // round(1080) + round(500) = 1580
    expect(rows[0].platformFee).toBe(1580);
    expect(rows[0].revenue).toBe(20000);
  });

  it('매입은 received_at 기준 quantity×(unit_cost+배송비들), 소수 수량 최종 반올림', () => {
    const entries = [
      { received_at: '2026-07-15', quantity: 2.5, unit_cost: 10000, unit_shipping_fee: 800, unit_rg_shipping_fee: 200 },
    ];
    const { rows } = computeDailySettlement([], entries, noExpenses);
    // 2.5 × (10000+800+200) = 2.5 × 11000 = 27500
    expect(rows[0].date).toBe('2026-07-15');
    expect(rows[0].purchase).toBe(27500);
    expect(rows[0].netProfit).toBe(-27500);  // 매입만 있는 날
  });

  it('수동 비용: 광고비·박스비 차감, 택배비 정산차 가산(음수 가능)', () => {
    const expenses = [
      { expense_date: '2026-07-16', ad_spend: 85000, box_cost: 120000, parcel_adjustment: -5000 },
    ];
    const sales = [
      { sold_at: '2026-07-16', sale_amount: 300000, selling_price: 300000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
    ];
    const { rows } = computeDailySettlement(sales, noEntries, expenses);
    expect(rows[0].adSpend).toBe(85000);
    expect(rows[0].boxCost).toBe(120000);
    expect(rows[0].parcelAdjustment).toBe(-5000);
    // 300000 - 0 - 0 - 0 - 0 - 85000 - 120000 + (-5000) = 90000
    expect(rows[0].netProfit).toBe(90000);
  });

  it('여러 날짜를 날짜 내림차순으로, monthTotal은 전체 합산', () => {
    const sales = [
      { sold_at: '2026-07-15', sale_amount: 10000, selling_price: 10000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
      { sold_at: '2026-07-16', sale_amount: 20000, selling_price: 20000, quantity: 1, coupon_discount: 0, shipping_fee: 0, platform_fee_rate: 0 },
    ];
    const { rows, monthTotal } = computeDailySettlement(sales, noEntries, noExpenses);
    expect(rows.map((r) => r.date)).toEqual(['2026-07-16', '2026-07-15']);
    expect(monthTotal.revenue).toBe(30000);
    expect(monthTotal.netProfit).toBe(30000);
  });

  it('빈 입력 → 빈 rows, monthTotal 0', () => {
    const { rows, monthTotal } = computeDailySettlement([], [], []);
    expect(rows).toHaveLength(0);
    expect(monthTotal.revenue).toBe(0);
    expect(monthTotal.netProfit).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/settlement/__tests__/calculate.test.ts` (300s 타임아웃)
Expected: FAIL — `../calculate` 모듈이 없음.

- [ ] **Step 3: 계산 함수 구현**

Create `src/lib/settlement/calculate.ts`:

```typescript
/**
 * 일일 정산(현금 기준 손익) 계산.
 *
 * 매출·수수료는 fifo.ts와 동일한 총액 축을 따른다:
 *   매출     = sale_amount ?? selling_price × quantity
 *   수수료   = round((매출 - 쿠폰) × platform_fee_rate)   -- 판매 건별, 그다음 합산
 * 매입은 현금 기준(입고일에 전액 인식, FIFO 아님).
 */

/** 정산 대상 판매 (채널·voided 필터는 호출부에서 완료) */
export interface SettlementSale {
  sold_at: string;               // YYYY-MM-DD
  sale_amount: number | null;    // 채널 확정 총액. null이면 폴백
  selling_price: number;
  quantity: number;
  coupon_discount: number;
  shipping_fee: number;
  platform_fee_rate: number;     // 상품별
}

/** 입고 (매입) */
export interface SettlementEntry {
  received_at: string;           // YYYY-MM-DD
  quantity: number;              // numeric(10,1) 가능
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
}

/** 일별 수동 비용 */
export interface SettlementExpense {
  expense_date: string;          // YYYY-MM-DD
  ad_spend: number;
  box_cost: number;
  parcel_adjustment: number;
}

export interface SettlementRow {
  date: string;
  revenue: number;
  couponDiscount: number;
  platformFee: number;
  purchase: number;
  parcelFee: number;
  parcelAdjustment: number;
  adSpend: number;
  boxCost: number;
  netProfit: number;
  orderCount: number;
}

export interface SettlementResult {
  rows: SettlementRow[];         // 날짜 내림차순
  monthTotal: Omit<SettlementRow, 'date'>;
}

function emptyAgg(): Omit<SettlementRow, 'date'> {
  return {
    revenue: 0, couponDiscount: 0, platformFee: 0, purchase: 0,
    parcelFee: 0, parcelAdjustment: 0, adSpend: 0, boxCost: 0,
    netProfit: 0, orderCount: 0,
  };
}

export function computeDailySettlement(
  sales: SettlementSale[],
  entries: SettlementEntry[],
  expenses: SettlementExpense[],
): SettlementResult {
  const byDate = new Map<string, Omit<SettlementRow, 'date'>>();
  const get = (d: string) => {
    let row = byDate.get(d);
    if (!row) { row = emptyAgg(); byDate.set(d, row); }
    return row;
  };

  for (const s of sales) {
    const row = get(s.sold_at);
    const revenue = s.sale_amount ?? s.selling_price * s.quantity;
    const effective = revenue - s.coupon_discount;
    row.revenue += revenue;
    row.couponDiscount += s.coupon_discount;
    row.platformFee += Math.round(effective * s.platform_fee_rate);
    row.parcelFee += s.shipping_fee;
    row.orderCount += 1;
  }

  for (const e of entries) {
    const row = get(e.received_at);
    row.purchase += Math.round(
      e.quantity * (e.unit_cost + e.unit_shipping_fee + e.unit_rg_shipping_fee),
    );
  }

  for (const x of expenses) {
    const row = get(x.expense_date);
    row.adSpend += x.ad_spend;
    row.boxCost += x.box_cost;
    row.parcelAdjustment += x.parcel_adjustment;
  }

  const rows: SettlementRow[] = [];
  const total = emptyAgg();
  for (const [date, a] of byDate) {
    a.netProfit =
      a.revenue - a.couponDiscount - a.platformFee - a.purchase
      - a.parcelFee - a.adSpend - a.boxCost + a.parcelAdjustment;
    rows.push({ date, ...a });
    total.revenue += a.revenue;
    total.couponDiscount += a.couponDiscount;
    total.platformFee += a.platformFee;
    total.purchase += a.purchase;
    total.parcelFee += a.parcelFee;
    total.parcelAdjustment += a.parcelAdjustment;
    total.adSpend += a.adSpend;
    total.boxCost += a.boxCost;
    total.orderCount += a.orderCount;
  }
  total.netProfit =
    total.revenue - total.couponDiscount - total.platformFee - total.purchase
    - total.parcelFee - total.adSpend - total.boxCost + total.parcelAdjustment;

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { rows, monthTotal: total };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/settlement/__tests__/calculate.test.ts` (300s 타임아웃)
Expected: PASS (8개 전부).

- [ ] **Step 5: 타입체크 + 커밋**

Run: `npx tsc --noEmit` — 에러 없음.

```bash
git add src/lib/settlement/calculate.ts src/lib/settlement/__tests__/calculate.test.ts
git commit -m "feat(settlement): 일일 손익 계산 함수 (총액 축, 현금 기준)"
```

---

### Task 4: GET /api/settlement/daily 라우트

**Files:**
- Create: `src/app/api/settlement/daily/route.ts`

`from`/`to`(YYYY-MM-DD)로 3종 데이터를 병렬 로드해 `computeDailySettlement`에 넘긴다. 외부 API 호출 없음. 인증·pool은 기존 라우트와 동일 패턴(`@/lib/auth`, `@/lib/sourcing/db`).

- [ ] **Step 1: 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { computeDailySettlement } from '@/lib/settlement/calculate';
import type { SettlementSale, SettlementEntry, SettlementExpense } from '@/lib/settlement/calculate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  try {
    const [salesRes, entriesRes, expensesRes] = await Promise.all([
      // 쿠팡 윙 + RG, 무효 제외. 상품별 수수료율 조인.
      pool.query(
        `SELECT to_char(sr.sold_at, 'YYYY-MM-DD') AS sold_at,
                sr.sale_amount, sr.selling_price, sr.quantity, sr.coupon_discount,
                sr.shipping_fee, pc.platform_fee_rate
           FROM sale_records sr
           JOIN product_costs pc ON pc.id = sr.product_cost_id
          WHERE sr.user_id = $1 AND sr.voided_at IS NULL
            AND sr.channel IN ('coupang','rocket_growth')
            AND sr.sold_at BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
      pool.query(
        `SELECT to_char(received_at, 'YYYY-MM-DD') AS received_at,
                quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee
           FROM cost_entries
          WHERE user_id = $1 AND received_at BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
      pool.query(
        `SELECT to_char(expense_date, 'YYYY-MM-DD') AS expense_date,
                ad_spend, box_cost, parcel_adjustment
           FROM daily_expenses
          WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
    ]);

    const sales: SettlementSale[] = salesRes.rows.map((r) => ({
      sold_at: r.sold_at,
      sale_amount: r.sale_amount == null ? null : Number(r.sale_amount),
      selling_price: Number(r.selling_price),
      quantity: Number(r.quantity),
      coupon_discount: Number(r.coupon_discount ?? 0),
      shipping_fee: Number(r.shipping_fee ?? 0),
      platform_fee_rate: Number(r.platform_fee_rate),
    }));
    const entries: SettlementEntry[] = entriesRes.rows.map((r) => ({
      received_at: r.received_at,
      quantity: Number(r.quantity),
      unit_cost: Number(r.unit_cost),
      unit_shipping_fee: Number(r.unit_shipping_fee ?? 0),
      unit_rg_shipping_fee: Number(r.unit_rg_shipping_fee ?? 0),
    }));
    const expenses: SettlementExpense[] = expensesRes.rows.map((r) => ({
      expense_date: r.expense_date,
      ad_spend: Number(r.ad_spend ?? 0),
      box_cost: Number(r.box_cost ?? 0),
      parcel_adjustment: Number(r.parcel_adjustment ?? 0),
    }));

    const result = computeDailySettlement(sales, entries, expenses);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit` — 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/settlement/daily/route.ts
git commit -m "feat(settlement): GET /api/settlement/daily 일일 손익 조회"
```

---

### Task 5: PUT /api/settlement/expenses/[date] 라우트 + 테스트

**Files:**
- Create: `src/app/api/settlement/expenses/[date]/route.ts`
- Test: `src/__tests__/api/settlement-expenses.test.ts`

`UNIQUE (user_id, expense_date)` upsert. TDD.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/__tests__/api/settlement-expenses.test.ts`:

```typescript
/**
 * PUT /api/settlement/expenses/[date] — 일별 수동 비용 upsert
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeReq(date: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/settlement/expenses/${date}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT settlement/expenses/[date]', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
    mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'e1' }] });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('잘못된 날짜 형식이면 400', async () => {
    const { PUT } = await import('@/app/api/settlement/expenses/[date]/route');
    const res = await PUT(makeReq('2026-7-1', { adSpend: 1 }), { params: Promise.resolve({ date: '2026-7-1' }) });
    expect(res.status).toBe(400);
  });

  it('upsert 쿼리에 ON CONFLICT + 값 포함', async () => {
    const { PUT } = await import('@/app/api/settlement/expenses/[date]/route');
    const res = await PUT(
      makeReq('2026-07-16', { adSpend: 85000, boxCost: 120000, boxMemo: '중박스 500개', parcelAdjustment: -5000, memo: '' }),
      { params: Promise.resolve({ date: '2026-07-16' }) },
    );
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(params).toContain(85000);
    expect(params).toContain(120000);
    expect(params).toContain(-5000);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/settlement-expenses.test.ts` (300s)
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 라우트 작성**

Create `src/app/api/settlement/expenses/[date]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { date } = await params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const adSpend = toInt(body?.adSpend);
  const boxCost = toInt(body?.boxCost);
  const parcelAdjustment = toInt(body?.parcelAdjustment);
  const boxMemo = typeof body?.boxMemo === 'string' ? body.boxMemo : null;
  const memo = typeof body?.memo === 'string' ? body.memo : null;

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO daily_expenses
         (user_id, expense_date, ad_spend, box_cost, box_memo, parcel_adjustment, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, expense_date) DO UPDATE
         SET ad_spend = EXCLUDED.ad_spend,
             box_cost = EXCLUDED.box_cost,
             box_memo = EXCLUDED.box_memo,
             parcel_adjustment = EXCLUDED.parcel_adjustment,
             memo = EXCLUDED.memo
       RETURNING *`,
      [user.userId, date, adSpend, boxCost, boxMemo, parcelAdjustment, memo],
    );
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 4: 통과 확인 + 타입체크**

Run: `npx vitest run src/__tests__/api/settlement-expenses.test.ts` (300s) — PASS
Run: `npx tsc --noEmit` — 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/settlement/expenses/[date]/route.ts" src/__tests__/api/settlement-expenses.test.ts
git commit -m "feat(settlement): PUT expenses/[date] 수동 비용 upsert"
```

---

### Task 6: 정산 탭 UI + OrdersClient 배선

**Files:**
- Create: `src/components/orders/SettlementTab.tsx`
- Modify: `src/components/orders/OrdersClient.tsx`

날짜 행 × 9열 표. 흰 셀=자동, 파란 셀(광고비·박스비)=편집 후 blur 시 PUT. 상단 안내 문구, 하단 월 합계, 월 단위 이동.

- [ ] **Step 1: SettlementTab 작성**

Create `src/components/orders/SettlementTab.tsx`:

```typescript
'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Row {
  date: string;
  revenue: number; couponDiscount: number; platformFee: number;
  purchase: number; parcelFee: number; parcelAdjustment: number;
  adSpend: number; boxCost: number; netProfit: number; orderCount: number;
}
interface DailyResponse {
  success: boolean;
  rows: Row[];
  monthTotal: Omit<Row, 'date'>;
  error?: string;
}

const won = (n: number) => n.toLocaleString('ko-KR');

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SettlementTab() {
  // 기본 이번 달 (KST). Date.now 사용은 클라이언트라 허용.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const [ym, setYm] = useState(`${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}`);
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<{ date: string; field: 'adSpend' | 'boxCost'; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = monthRange(ym);
    try {
      const res = await fetch(`/api/settlement/daily?from=${from}&to=${to}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [ym]);

  useEffect(() => { load(); }, [load]);

  const saveExpense = async (date: string, field: 'adSpend' | 'boxCost', value: number) => {
    const existing = data?.rows.find((r) => r.date === date);
    const body = {
      adSpend: field === 'adSpend' ? value : existing?.adSpend ?? 0,
      boxCost: field === 'boxCost' ? value : existing?.boxCost ?? 0,
      parcelAdjustment: existing?.parcelAdjustment ?? 0,
    };
    await fetch(`/api/settlement/expenses/${date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  };

  const rows = data?.rows ?? [];
  const total = data?.monthTotal;

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#27272a', fontSize: 12, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', fontSize: 12, color: '#3f3f46', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const editable: React.CSSProperties = { ...td, background: '#eaf3ff', cursor: 'pointer' };

  return (
    <div>
      <div style={{ background: '#fff8f6', border: '1px solid #f3d4cc', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#7c2d12', marginBottom: 14 }}>
        현금 기준 — 물건 산 날 비용을 인식합니다. 쿠팡 윙·로켓그로스 판매만 집계하며, 수기 입력분은 제외됩니다.
        일괄 임포트분은 쿠폰이 반영되지 않을 수 있습니다. 상품별 손익은 <b>수익·원가</b> 탭을 보세요.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => setYm((m) => shiftMonth(m, -1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>‹ 이전달</button>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{ym}</span>
        <button onClick={() => setYm((m) => shiftMonth(m, 1))} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer' }}>다음달 ›</button>
        {loading && <span style={{ color: '#a1a1aa', fontSize: 12 }}>불러오는 중…</span>}
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ ...th, textAlign: 'left' }}>날짜</th>
              <th style={th}>매출</th><th style={th}>쿠폰</th><th style={th}>수수료</th>
              <th style={th}>매입</th><th style={th}>택배비</th>
              <th style={th}>광고비</th><th style={th}>박스비</th><th style={th}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#a1a1aa', padding: 20 }}>이 달 데이터가 없습니다</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.date} style={{ borderBottom: '1px solid #f4f4f5' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.date.slice(5)}</td>
                <td style={td}>{won(r.revenue)}</td>
                <td style={td}>{r.couponDiscount ? `-${won(r.couponDiscount)}` : '0'}</td>
                <td style={td}>{r.platformFee ? `-${won(r.platformFee)}` : '0'}</td>
                <td style={td}>{r.purchase ? `-${won(r.purchase)}` : '0'}</td>
                <td style={td}>{r.parcelFee ? `-${won(r.parcelFee)}` : '0'}</td>
                {(['adSpend', 'boxCost'] as const).map((f) => (
                  <td key={f} style={editable}
                      onClick={() => setEdit({ date: r.date, field: f, value: String(r[f]) })}>
                    {edit && edit.date === r.date && edit.field === f ? (
                      <input autoFocus type="number" value={edit.value}
                        onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveExpense(r.date, f, Math.trunc(Number(edit.value) || 0)); setEdit(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        style={{ width: 72, textAlign: 'right', border: '1px solid #86b7fe', borderRadius: 4, fontSize: 12, color: '#18181b' }} />
                    ) : (r[f] ? `-${won(r[f])}` : '0')}
                  </td>
                ))}
                <td style={{ ...td, fontWeight: 700, color: r.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(r.netProfit)}</td>
              </tr>
            ))}
          </tbody>
          {total && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: '#fffbe6', borderTop: '2px solid #e5e5e5', fontWeight: 700 }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>월 합계</td>
                <td style={td}>{won(total.revenue)}</td>
                <td style={td}>-{won(total.couponDiscount)}</td>
                <td style={td}>-{won(total.platformFee)}</td>
                <td style={td}>-{won(total.purchase)}</td>
                <td style={td}>-{won(total.parcelFee)}</td>
                <td style={td}>-{won(total.adSpend)}</td>
                <td style={td}>-{won(total.boxCost)}</td>
                <td style={{ ...td, fontWeight: 700, color: total.netProfit < 0 ? '#b91c1c' : '#14532d' }}>{won(total.netProfit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
```

참고: `parcel_adjustment`는 이번 UI에서 편집 셀로 노출하지 않는다(스펙 §8은 광고비·박스비만 파란 셀). 정산차 입력은 후속. 저장 시 기존 값을 보존하므로 데이터는 안전하다.

- [ ] **Step 2: OrdersClient에 settlement 탭 배선**

`src/components/orders/OrdersClient.tsx` 수정:

(a) import 추가 (기존 import 블록 끝, `import CostManagementTab ...` 다음 줄):
```typescript
import CostManagementTab from './CostManagementTab';
import SettlementTab from './SettlementTab';
```

(b) 아이콘 import에 `Wallet` 추가 (`lucide-react` 라인):
```typescript
import { ShoppingCart, BarChart3, Settings, ClipboardList, Wallet } from 'lucide-react';
```

(c) `SubTab` 타입에 `settlement` 추가:
```typescript
type SubTab = 'orders' | 'channels' | 'cost' | 'settlement';
```

(d) `SUB_TABS` 배열에 항목 추가 (`cost` 다음):
```typescript
  { id: 'cost', label: '수익·원가', icon: <BarChart3 size={14} /> },
  { id: 'settlement', label: '정산', icon: <Wallet size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
```

(e) URL 동기화에 `settlement` 허용 (`useEffect` 내 조건):
```typescript
    if (tab === 'cost' || tab === 'channels' || tab === 'settlement') setActiveSubTab(tab);
```

(f) 렌더 분기 추가 (`{activeSubTab === 'cost' && ...}` 다음):
```typescript
        {activeSubTab === 'cost' && <CostManagementTab />}
        {activeSubTab === 'settlement' && <SettlementTab />}
        {activeSubTab === 'channels' && <ChannelsTab />}
```

- [ ] **Step 3: 타입체크 + 탭 컴포넌트 회귀**

Run: `npx tsc --noEmit` — 에러 없음.
Run: `npx vitest run src/__tests__/components/orders-client-tabs.test.tsx` (300s) — PASS.

이 테스트는 탭 개수가 아니라 동작(기본 렌더·클릭 시 URL 동기화·`?tab=channels` 진입)을 단언하므로 `settlement` 탭 추가만으로는 깨지지 않는다. 이 테스트는 `ChannelsTab`/`CostManagementTab`/`OrdersTab`을 `vi.mock`한다. `SettlementTab`은 렌더되지 않으므로(activeSubTab≠settlement) mock 없이도 통과한다. 만약 import 만으로 jsdom 에러가 나면(드묾), 파일 상단 mock 블록에 한 줄 추가:
```typescript
vi.mock('@/components/orders/SettlementTab', () => ({ default: () => <div>정산탭내용</div> }));
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/SettlementTab.tsx src/components/orders/OrdersClient.tsx
git commit -m "feat(settlement): 정산 서브탭 UI + OrdersClient 배선"
```

---

### Task 7: 최종 검증

- [ ] **Step 1: 마이그레이션 로컬 적용 (트랜잭션 롤백 드라이런 먼저)**

먼저 롤백 드라이런으로 문법·정합 확인 (`.env.local`의 `SOURCING_DATABASE_URL` 사용):

```bash
export $(grep -E "^SOURCING_DATABASE_URL=" .env.local | xargs)
psql "$SOURCING_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i supabase/migrations/088_sale_records_shipping_fee.sql
\i supabase/migrations/089_daily_expenses.sql
SELECT 'daily_expenses_exists' AS chk, count(*) FROM information_schema.tables WHERE table_name='daily_expenses';
ROLLBACK;
SQL
```
Expected: `BEGIN / ALTER TABLE / CREATE TABLE ... / daily_expenses_exists | 1 / ROLLBACK`, 에러 없음.

그다음 실제 적용:
```bash
psql "$SOURCING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/088_sale_records_shipping_fee.sql
psql "$SOURCING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/089_daily_expenses.sql
psql "$SOURCING_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='daily_expenses';"
```
Expected: 마지막 출력 `1`.

- [ ] **Step 2: 전체 테스트 + 타입체크**

Run: `npx tsc --noEmit` — 에러 없음.
Run: `npx vitest run src/lib/settlement/__tests__ src/__tests__/api/settlement-expenses.test.ts` (300s) — 전부 PASS.

- [ ] **Step 3: 앱 구동 확인 (수동)**

개발 서버를 띄우고 `/orders?tab=settlement`에 접속해 (a) 정산 탭이 보이는지, (b) 이번 달 표가 뜨는지, (c) 광고비 셀을 편집·blur 하면 저장 후 순이익이 갱신되는지 확인. 데이터가 없으면 "이 달 데이터가 없습니다"가 정상.

- [ ] **Step 4: write 경로·잔여 확인**

Run: `git status` — 의도한 파일만 변경/신규인지 확인.

---

## Self-Review 결과 (작성자 기록)

- **스펙 커버리지**: daily_expenses(§7→T2), 계산식(§6, 총액 축으로 갱신→T3), GET daily(§8→T4), PUT expenses(§8→T5), 정산 탭 UI+딥링크(§8→T6), shipping_fee 선행(§4.2→T1), 안내 문구(§6→T6 배너). §9 후속(정산 대조·쿠폰 통일·정산차 편집 셀 등)은 범위 밖으로 명시.
- **스펙과의 의도적 차이**: 매출·수수료를 총액 축(sale_amount)으로 갱신 — 머지된 `fifo.ts`와 일치시키기 위함(상단 "스펙 대비 변경점" §1·§2). 마이그 번호 088/089(§3).
- **타입 일관성**: `SettlementSale/Entry/Expense`·`SettlementRow` 필드명이 route 매핑·UI `Row`·테스트에서 동일. `sale_amount: number | null`(폴백), 금액은 정수.
- **미검증 가정**: `parcel_adjustment` 편집 셀은 UI에서 제외(후속). PUT은 광고비·박스비만 받아도 기존 `parcel_adjustment`를 보존(SettlementTab.saveExpense가 existing 값 전송).
- **RLS**: daily_expenses는 ENABLE RLS + 정책 없음. 서버는 owner 연결로 우회하므로 기능 영향 없고 Supabase 직접 접근만 차단.
