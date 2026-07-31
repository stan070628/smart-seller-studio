# 소싱 쇼트리스트 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도매꾹 소싱 후보를 담아두고, 담는 순간과 매일 새벽에 도매꾹 생존·쿠팡 시세·손익분기를 자동 재검증하는 탭을 만들고, 사용하지 않는 기존 소싱 UI를 걷어낸다.

**Architecture:** 순수 계산 로직(배송비 환산, 손익분기)을 먼저 TDD로 만들고, 그 위에 외부 API 호출(도매꾹·네이버)을 얹은 뒤, DB 레이어 → API 라우트 → UI 순으로 쌓는다. **신규 기능을 전부 만든 뒤 마지막에 기존 UI를 삭제한다** — 삭제를 먼저 하면 중간 상태가 깨져 되돌리기 어렵다.

**Tech Stack:** Next.js(App Router), TypeScript, PostgreSQL(Render, `SOURCING_DATABASE_URL`), vitest, 도매꾹 오픈API v4.5, 네이버 쇼핑 검색 API

**Spec:** `docs/superpowers/specs/2026-07-31-sourcing-shortlist-design.md`

---

## File Structure

### 새로 만드는 파일

| 파일 | 책임 |
|---|---|
| `supabase/migrations/094_sourcing_shortlist.sql` | 테이블 정의 |
| `src/types/shortlist.ts` | 공용 타입 |
| `src/lib/sourcing/deli-policy.ts` | 도매꾹 배송비 정책 파싱, 개당 배송비 환산 |
| `src/lib/sourcing/coupang-price.ts` | 쿠팡 시세 추정, 손익분기·마진 계산 |
| `src/lib/sourcing/shortlist-db.ts` | 쇼트리스트 CRUD (SQL만) |
| `src/lib/sourcing/shortlist-verify.ts` | 검증 오케스트레이션 (도매꾹+쿠팡+판정) |
| `src/app/api/sourcing/shortlist/route.ts` | 목록 조회, 추가, 사입수량 일괄 수정 |
| `src/app/api/sourcing/shortlist/[itemNo]/route.ts` | 단건 삭제·수정 |
| `src/app/api/sourcing/shortlist/verify/route.ts` | 재검증 트리거 |
| `src/app/api/sourcing/cron/shortlist-verify/route.ts` | 매일 새벽 자동 검증 |
| `src/components/sourcing/ShortlistTab.tsx` | UI |

### 테스트

| 파일 | 대상 |
|---|---|
| `src/__tests__/lib/sourcing/deli-policy.test.ts` | Task 2 |
| `src/__tests__/lib/sourcing/coupang-price.test.ts` | Task 3, 4 |
| `src/__tests__/lib/sourcing/shortlist-verify.test.ts` | Task 6 |

### 수정하는 파일

| 파일 | 변경 |
|---|---|
| `src/components/sourcing/SourcingDashboard.tsx` | 탭 단층화, ShortlistTab 연결 |
| `vercel.json` | cron 추가, 깨진 `agent/run` 제거 |

### 책임 분리 이유

`coupang-price.ts`는 **순수 계산 + 네이버 조회**까지만 맡고, 도매꾹 조회나 DB 저장은 모른다. `shortlist-verify.ts`가 셋을 조합한다. 이렇게 나눠야 계산 로직을 외부 API 없이 테스트할 수 있다.

기존 `src/lib/sourcing/naver-shopping.ts`는 **수정하지 않는다.** 그 파일의 `searchNaverLowestPrice`는 `display=5, sort=asc`로 listing이 쓰고 있고, 우리는 `display=100, sort=sim` + 쿠팡몰 필터가 필요해 파라미터가 완전히 다르다. 기존 파일을 건드리면 listing에 영향이 간다.

---

## Task 1: 타입과 마이그레이션

**Files:**
- Create: `src/types/shortlist.ts`
- Create: `supabase/migrations/094_sourcing_shortlist.sql`

- [ ] **Step 1: 타입 파일 작성**

`src/types/shortlist.ts`:

```typescript
/**
 * 소싱 쇼트리스트 타입
 * 스펙: docs/superpowers/specs/2026-07-31-sourcing-shortlist-design.md
 */

/** 로켓그로스 사이즈 유형. 물류비가 사이즈마다 다르다. */
export type LogisticsSize = 'xsmall' | 'small' | 'medium';

/** 검증 판정 결과 */
export type Verdict =
  | 'pass'     // 쿠팡 p25 ≥ 손익분기가
  | 'fail'     // 쿠팡 p25 < 손익분기가
  | 'dead'     // 도매꾹에서 판매종료·삭제
  | 'unknown'; // 쿠팡 표본 부족으로 판정 불가

/** 도매꾹 배송비 정책 */
export type DeliType = 'fixed' | 'tiered';

export interface DeliPolicy {
  isFree: boolean;
  type: DeliType;
  /** tiered일 때 구간 수량. fixed면 null */
  unitQty: number | null;
  /** 구간 요금 또는 고정 요금 */
  fee: number;
}

export interface ShortlistItem {
  itemNo: number;
  title: string;
  memo: string | null;
  addedAt: string;

  domeStatus: string | null;
  domePrice: number | null;
  domeInventory: number | null;
  domeMoq: number | null;

  deliIsFree: boolean | null;
  deliType: DeliType | null;
  deliUnitQty: number | null;
  deliFee: number | null;

  coupangP25: number | null;
  coupangSampleN: number | null;

  orderQty: number;
  unitDeliFee: number | null;
  effectiveCost: number | null;
  logisticsSize: LogisticsSize;
  breakEvenPrice: number | null;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict | null;
  verifiedAt: string | null;

  isArchived: boolean;
}
```

- [ ] **Step 2: 마이그레이션 작성**

`supabase/migrations/094_sourcing_shortlist.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 094_sourcing_shortlist.sql
-- 소싱 쇼트리스트 — 검증을 통과한 후보를 담아두고 상태를 추적한다.
--
-- sourcing_items(45만건 수집 풀)와 분리하는 이유:
--   1. 수명주기가 다르다. 수집 풀은 매일 갱신되지만 쇼트리스트는 직접 고른 수십 건이다.
--   2. 도매꾹에서 삭제된 상품도 리스트에는 남아야 한다. 왜 탈락했는지 기록이 없으면
--      같은 후보를 다시 뽑는다.
--
-- 적용: node scripts/migrate-sourcing.mjs 094
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sourcing_shortlist (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no            integer NOT NULL UNIQUE,
  title              text    NOT NULL,
  memo               text,
  added_at           timestamptz NOT NULL DEFAULT now(),

  -- 도매꾹 실시간 스냅샷
  dome_status        text,
  dome_price         integer,
  dome_inventory     integer,
  dome_moq           integer,

  -- 배송비 정책 (deli 필드 파싱 결과)
  deli_is_free       boolean,
  deli_type          text,
  deli_unit_qty      integer,
  deli_fee           integer,

  -- 쿠팡 시세 추정
  coupang_p25        integer,
  coupang_sample_n   smallint,

  -- 판정
  order_qty          integer NOT NULL DEFAULT 10,
  unit_deli_fee      integer,
  effective_cost     integer,
  logistics_size     text    NOT NULL DEFAULT 'xsmall',
  break_even_price   integer,
  margin             integer,
  margin_rate        numeric(5,1),
  verdict            text,
  verified_at        timestamptz,

  is_archived        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.sourcing_shortlist.order_qty      IS '검증 사입 수량. 개당 배송비 환산 기준';
COMMENT ON COLUMN public.sourcing_shortlist.unit_deli_fee  IS '개당 배송비 (order_qty 기준 파생값)';
COMMENT ON COLUMN public.sourcing_shortlist.effective_cost IS '도매가 + 개당 배송비';
COMMENT ON COLUMN public.sourcing_shortlist.verdict        IS 'pass|fail|dead|unknown. unknown은 표본부족으로 판정 불가';

CREATE INDEX IF NOT EXISTS idx_shortlist_verdict  ON public.sourcing_shortlist(verdict);
CREATE INDEX IF NOT EXISTS idx_shortlist_archived ON public.sourcing_shortlist(is_archived);

-- updated_at 자동 갱신 (005_sourcing_schema.sql에서 만든 함수 재사용)
DROP TRIGGER IF EXISTS trg_sourcing_shortlist_updated_at ON public.sourcing_shortlist;
CREATE TRIGGER trg_sourcing_shortlist_updated_at
  BEFORE UPDATE ON public.sourcing_shortlist
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
```

- [ ] **Step 3: 마이그레이션 적용**

Run: `node scripts/migrate-sourcing.mjs 094`
Expected: 오류 없이 완료

- [ ] **Step 4: 테이블 생성 확인**

Run:
```bash
set -a && source .env.local && set +a
psql "$SOURCING_DATABASE_URL" -c "\d sourcing_shortlist" | head -20
```
Expected: 컬럼 목록이 출력된다. `order_qty`의 기본값이 10인지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/types/shortlist.ts supabase/migrations/094_sourcing_shortlist.sql
git commit -m "feat: 소싱 쇼트리스트 테이블과 타입 추가"
```

---

## Task 2: 배송비 정책 파싱 (`deli-policy.ts`)

도매꾹 `deli.dome`은 두 형태다. 실제 응답으로 확인했다.

- `{type:"고정배송비", fee:"3000"}` — 수량 무관 3,000원
- `{type:"수량별비례", tbl:"30+3000|30+3000"}` — **30개당** 3,000원

**Files:**
- Create: `src/lib/sourcing/deli-policy.ts`
- Test: `src/__tests__/lib/sourcing/deli-policy.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/sourcing/deli-policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';

describe('parseDeliPolicy', () => {
  it('수량별비례 tbl에서 구간 수량과 요금을 뽑는다', () => {
    const deli = {
      pay: '선결제',
      dome: { type: '수량별비례', tbl: '30+3000|30+3000' },
    };
    expect(parseDeliPolicy(deli)).toEqual({
      isFree: false,
      type: 'tiered',
      unitQty: 30,
      fee: 3000,
    });
  });

  it('고정배송비 fee를 뽑는다', () => {
    const deli = {
      pay: '선결제',
      dome: { type: '고정배송비', fee: '3000' },
    };
    expect(parseDeliPolicy(deli)).toEqual({
      isFree: false,
      type: 'fixed',
      unitQty: null,
      fee: 3000,
    });
  });

  it('pay가 무료면 무료배송으로 본다', () => {
    expect(parseDeliPolicy({ pay: '무료' }).isFree).toBe(true);
  });

  it('구형 who=S도 무료배송으로 본다', () => {
    expect(parseDeliPolicy({ who: 'S' }).isFree).toBe(true);
  });

  it('deli가 없으면 무료로 처리한다', () => {
    expect(parseDeliPolicy(undefined).isFree).toBe(true);
    expect(parseDeliPolicy(null).isFree).toBe(true);
  });
});

describe('unitDeliveryFee', () => {
  const tiered = { isFree: false, type: 'tiered' as const, unitQty: 30, fee: 3000 };
  const fixed = { isFree: false, type: 'fixed' as const, unitQty: null, fee: 3000 };

  it('수량별비례 10개 주문이면 개당 300원', () => {
    expect(unitDeliveryFee(tiered, 10)).toBe(300);
  });

  it('수량별비례 30개 주문이면 개당 100원', () => {
    expect(unitDeliveryFee(tiered, 30)).toBe(100);
  });

  it('구간을 넘기면 배수가 붙는다 — 31개면 6000원이라 개당 194원', () => {
    expect(unitDeliveryFee(tiered, 31)).toBe(194);
  });

  it('고정배송비 10개 주문이면 개당 300원', () => {
    expect(unitDeliveryFee(fixed, 10)).toBe(300);
  });

  it('무료배송이면 0원', () => {
    expect(unitDeliveryFee({ isFree: true, type: 'fixed', unitQty: null, fee: 0 }, 10)).toBe(0);
  });

  it('주문수량이 0 이하면 0원', () => {
    expect(unitDeliveryFee(fixed, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/deli-policy.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sourcing/deli-policy"`

- [ ] **Step 3: 구현 작성**

`src/lib/sourcing/deli-policy.ts`:

```typescript
/**
 * deli-policy.ts
 * 도매꾹 deli 필드에서 배송비 정책을 파싱하고 개당 배송비로 환산한다.
 *
 * 기존 deli-parser.ts와의 차이:
 *   deli-parser.parseEffectiveDeliFee는 "구간 요금"(한 번 주문 시 붙는 금액)을 반환한다.
 *   listing이 총원가에 1회 더하는 용법에는 그게 맞다.
 *   쇼트리스트는 개당 원가가 필요하므로 주문 수량으로 나눠야 하고, 그러려면
 *   "30개당 3,000원"의 30을 알아야 한다. 그래서 정책 구조를 그대로 보존한다.
 */

import type { DeliPolicy } from '@/types/shortlist';

const FREE: DeliPolicy = { isFree: true, type: 'fixed', unitQty: null, fee: 0 };

function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * getItemView 응답의 deli 필드를 배송비 정책으로 파싱한다.
 * 형태가 버전·상품마다 달라 unknown으로 받는다.
 */
export function parseDeliPolicy(deli: unknown): DeliPolicy {
  if (!deli || typeof deli !== 'object') return FREE;
  const raw = deli as Record<string, unknown>;

  // 무료배송 판단 — 신형은 pay, 구형은 who
  const pay = typeof raw.pay === 'string' ? raw.pay : '';
  const who = typeof raw.who === 'string' ? raw.who : '';
  if (pay === '무료' || who === 'S') return FREE;

  const dome = raw.dome as Record<string, unknown> | undefined;

  // 수량별비례: tbl "30+3000|30+3000" → 첫 구간만 사용
  // 두 번째 이후 구간은 실제 응답에서 동일 값 반복이었고, 검증 물량(10개 내외)에서는
  // 첫 구간을 넘지 않는다. 넘을 때는 unitDeliveryFee가 ceil 배수로 근사한다.
  const tblRaw = dome?.tbl ?? raw.tbl;
  if (typeof tblRaw === 'string' && tblRaw.includes('+')) {
    const [qtyPart, feePart] = tblRaw.split('|')[0].split('+');
    const unitQty = toInt(qtyPart);
    const fee = toInt(feePart);
    if (unitQty > 0 && fee > 0) {
      return { isFree: false, type: 'tiered', unitQty, fee };
    }
  }

  // 고정배송비
  const fee = toInt(dome?.fee ?? raw.fee);
  if (fee > 0) return { isFree: false, type: 'fixed', unitQty: null, fee };

  return FREE;
}

/**
 * 주문 수량 기준 개당 배송비(원).
 *
 * 개당 배송비는 주문 수량에 따라 달라진다.
 * "30개당 3,000원"을 10개 주문하면 개당 300원, 30개 주문하면 개당 100원이다.
 */
export function unitDeliveryFee(policy: DeliPolicy, orderQty: number): number {
  if (policy.isFree || orderQty <= 0) return 0;

  const total =
    policy.type === 'tiered' && policy.unitQty && policy.unitQty > 0
      ? Math.ceil(orderQty / policy.unitQty) * policy.fee
      : policy.fee;

  return Math.ceil(total / orderQty);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/deli-policy.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/deli-policy.ts src/__tests__/lib/sourcing/deli-policy.test.ts
git commit -m "feat: 도매꾹 배송비 정책 파싱과 개당 환산"
```

---

## Task 3: 손익분기·마진 계산 (`coupang-price.ts` 1부)

**Files:**
- Create: `src/lib/sourcing/coupang-price.ts`
- Test: `src/__tests__/lib/sourcing/coupang-price.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/sourcing/coupang-price.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { breakEvenPrice, marginOf, LOGISTICS_FEE } from '@/lib/sourcing/coupang-price';

describe('LOGISTICS_FEE', () => {
  it('로켓그로스 요금표와 일치한다', () => {
    expect(LOGISTICS_FEE.xsmall).toBe(1725);
    expect(LOGISTICS_FEE.small).toBe(1900);
    expect(LOGISTICS_FEE.medium).toBe(2740);
  });
});

describe('breakEvenPrice', () => {
  it('극소형 실효원가 2,500원의 손익분기가는 7,638원', () => {
    expect(breakEvenPrice(2500, 'xsmall')).toBe(7638);
  });

  it('극소형 실효원가 3,300원의 손익분기가는 8,535원', () => {
    expect(breakEvenPrice(3300, 'xsmall')).toBe(8535);
  });

  it('극소형 실효원가 4,000원의 손익분기가는 9,671원', () => {
    expect(breakEvenPrice(4000, 'xsmall')).toBe(9671);
  });

  it('소형 실효원가 3,180원의 손익분기가는 8,891원', () => {
    expect(breakEvenPrice(3180, 'small')).toBe(8891);
  });

  it('사이즈가 커지면 손익분기가도 올라간다', () => {
    const cost = 3000;
    expect(breakEvenPrice(cost, 'xsmall')).toBeLessThan(breakEvenPrice(cost, 'small'));
    expect(breakEvenPrice(cost, 'small')).toBeLessThan(breakEvenPrice(cost, 'medium'));
  });
});

describe('marginOf', () => {
  it('메쉬 반장갑 — 실효원가 3,600원을 9,900원에 팔면 마진 3,506원', () => {
    expect(marginOf(9900, 3600, 'xsmall')).toBe(3506);
  });

  it('접이식 쓰레기통 — 실효원가 2,830원을 5,080원에 팔면 적자', () => {
    expect(marginOf(5080, 2830, 'xsmall')).toBeLessThan(0);
  });

  it('손익분기가에서는 마진이 0 이상이다', () => {
    const cost = 3300;
    const be = breakEvenPrice(cost, 'xsmall');
    expect(marginOf(be, cost, 'xsmall')).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현 작성**

`src/lib/sourcing/coupang-price.ts`:

```typescript
/**
 * coupang-price.ts
 * 쿠팡 실판매가 추정과 로켓그로스 손익 계산.
 *
 * 근거 문서:
 *   20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28  — 마진 기준
 *   20-wiki/sources/로켓그로스 요금표 2026-07-28        — 물류비
 */

import type { LogisticsSize } from '@/types/shortlist';

/** 쿠팡 판매수수료 */
export const COMMISSION_RATE = 0.108;

/** 로켓그로스 입출고비+배송비 (원). 판매된 상품에만 부과된다. */
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: 1725, // 입출고 600 + 배송 1,125
  small: 1900,  // 입출고 650 + 배송 1,250
  medium: 2740, // 입출고 1,240 + 배송 1,500
};

/** 목표 마진율 — 광고 손익분기 ROAS 333% 이하를 만드는 하한 */
const TARGET_MARGIN_RATE = 0.3;

/** 개당 마진이 물류비의 몇 배 이상이어야 하는가 — 요율 인상 완충 */
const MARGIN_TO_LOGISTICS = 1.5;

/**
 * 진입 가능한 최소 판매가(원).
 *
 * 두 조건을 모두 만족해야 하므로 큰 쪽을 취한다.
 *   ① 마진율 30% 이상
 *   ② 개당 마진 ≥ 물류비 × 1.5
 *
 * 원가가 낮을수록 ②가, 높을수록 ①이 지배한다.
 */
export function breakEvenPrice(effectiveCost: number, size: LogisticsSize): number {
  const logi = LOGISTICS_FEE[size];
  const byRate = (effectiveCost + logi) / (1 - COMMISSION_RATE - TARGET_MARGIN_RATE);
  const byAmount = (effectiveCost + logi * (1 + MARGIN_TO_LOGISTICS)) / (1 - COMMISSION_RATE);
  return Math.ceil(Math.max(byRate, byAmount));
}

/** 개당 마진(원). 음수면 적자다. */
export function marginOf(
  sellingPrice: number,
  effectiveCost: number,
  size: LogisticsSize,
): number {
  return Math.round(
    sellingPrice * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - effectiveCost,
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/coupang-price.ts src/__tests__/lib/sourcing/coupang-price.test.ts
git commit -m "feat: 로켓그로스 손익분기·마진 계산"
```

---

## Task 4: 쿠팡 시세 추정 (`coupang-price.ts` 2부)

네이버 쇼핑 검색 결과에서 쿠팡몰 항목만 추려 하위 25%를 시세로 쓴다. 2026-07-31 실측에서 오차 ±11%였다. 최저가(−34~−73%)와 중앙값(0~+324%)은 쓸 수 없다.

**Files:**
- Modify: `src/lib/sourcing/coupang-price.ts`
- Modify: `src/__tests__/lib/sourcing/coupang-price.test.ts`

- [ ] **Step 1: 검색어 생성 테스트 추가**

`src/__tests__/lib/sourcing/coupang-price.test.ts` 상단 import에 `buildSearchQueries`를 추가하고, 파일 끝에 붙인다:

```typescript
import { buildSearchQueries } from '@/lib/sourcing/coupang-price';

describe('buildSearchQueries', () => {
  it('판매자 태그를 제거한다', () => {
    const qs = buildSearchQueries('[한원산업] 극세사 스포츠 방한장갑 바이크장갑 오토바이장갑');
    expect(qs.join(' ')).not.toContain('한원산업');
    expect(qs[0]).toBe('극세사 스포츠 방한장갑 바이크장갑');
  });

  it('제목 여러 구간을 검색어로 만든다', () => {
    // 앞 4단어만 쓰면 상품 정체를 놓친다.
    // "접이식 쓰레기통"으로 검색하면 캠핑용 대형 트래쉬박스가 잡혔다.
    const qs = buildSearchQueries(
      '접이식 쓰레기통 걸이형휴지통 휴대용휴지통 쓰레기봉투걸이 휴지통',
    );
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.some((q) => q.includes('쓰레기봉투걸이'))).toBe(true);
  });

  it('괄호와 모델코드를 제거한다', () => {
    const qs = buildSearchQueries('(GTF58047) 캠핑러브 고강도 단조팩 세트 실버');
    expect(qs[0]).not.toContain('GTF58047');
    expect(qs[0]).not.toContain('(');
  });

  it('중복 구간은 한 번만 담는다', () => {
    const qs = buildSearchQueries('장갑 방한 장갑 방한');
    expect(new Set(qs).size).toBe(qs.length);
  });

  it('빈 제목이어도 빈 배열을 반환하지 않는다', () => {
    expect(buildSearchQueries('123 45').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: FAIL — `buildSearchQueries is not a function`

- [ ] **Step 3: `buildSearchQueries` 구현**

`src/lib/sourcing/coupang-price.ts` 끝에 추가:

```typescript
/**
 * 상품명에서 검색어 후보를 만든다.
 *
 * 도매꾹 상품명은 키워드 나열형이라 앞 4단어만 잘라 쓰면 상품 정체를 놓친다.
 * 실제로 "접이식 쓰레기통 걸이형휴지통…"이 "접이식 쓰레기통"으로 검색되어
 * 캠핑용 대형 트래쉬박스(중앙값 36,580원)를 잡았고, 실제 상품은 5,490원짜리
 * 봉투걸이였다. 그래서 앞·중간·뒤 구간을 각각 검색해 결과를 합친다.
 */
export function buildSearchQueries(title: string, max = 4): string[] {
  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')          // [판매자태그]
    .replace(/\([^)]*\)/g, ' ')           // (부가설명)
    .replace(/[A-Z]{2,}[-_]?\d{3,}/g, ' ') // 모델코드 GTF58047
    .replace(/[/\\+&_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));

  if (words.length === 0) return [title.slice(0, 20)];

  const starts = [0, 2, 4, Math.max(0, words.length - 4)];
  const out: string[] = [];
  for (const s of starts) {
    const chunk = words.slice(s, s + 4).join(' ');
    if (chunk.length > 3 && !out.includes(chunk)) out.push(chunk);
  }
  return out.slice(0, max);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: 시세 추정 테스트 추가 (네이버 API 모킹)**

같은 테스트 파일 끝에 추가한다. `fetch`를 모킹해 실제 호출을 막는다.

```typescript
import { vi, beforeEach, afterEach } from 'vitest';
import { estimateCoupangPrice } from '@/lib/sourcing/coupang-price';

/** 네이버 쇼핑 API 응답 모양의 아이템을 만든다 */
function item(lprice: number, mallName: string) {
  return { title: 'x', lprice: String(lprice), mallName };
}

describe('estimateCoupangPrice', () => {
  beforeEach(() => {
    process.env.NAVER_CLIENT_ID = 'id';
    process.env.NAVER_CLIENT_SECRET = 'secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('쿠팡몰 항목만 골라 하위 25%를 반환한다', async () => {
    // 쿠팡 8건: 4000,5000,5500,6000,7000,8000,9000,20000 → p25는 인덱스 2 = 5500
    const coupang = [4000, 5000, 5500, 6000, 7000, 8000, 9000, 20000].map((p) =>
      item(p, '쿠팡'),
    );
    const noise = [100, 200, 300].map((p) => item(p, '기타몰'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [...coupang, ...noise] }),
      }),
    );

    const result = await estimateCoupangPrice('메쉬 반장갑 등산 낚시 라이더');
    expect(result).not.toBeNull();
    expect(result!.p25).toBe(5500);
    expect(result!.sampleN).toBeGreaterThanOrEqual(8);
  });

  it('쿠팡몰 표본이 3건 미만이면 null을 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [item(5000, '쿠팡'), item(300, '기타몰')] }),
      }),
    );

    expect(await estimateCoupangPrice('아주 희귀한 상품명')).toBeNull();
  });

  it('네이버 API가 실패해도 예외를 던지지 않고 null을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await estimateCoupangPrice('메쉬 반장갑')).toBeNull();
  });

  it('1,000원 미만 항목은 표본에서 제외한다', async () => {
    const items = [item(500, '쿠팡'), item(600, '쿠팡'), item(700, '쿠팡')];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) }),
    );
    expect(await estimateCoupangPrice('저가 부속품')).toBeNull();
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: FAIL — `estimateCoupangPrice is not a function`

- [ ] **Step 7: `estimateCoupangPrice` 구현**

`src/lib/sourcing/coupang-price.ts` 끝에 추가:

```typescript
/** 쿠팡 시세 추정 결과 */
export interface CoupangPriceEstimate {
  /** 하위 25% 가격 — 진입 기준가 */
  p25: number;
  /** 쿠팡몰 표본 수 */
  sampleN: number;
}

/** 표본이 이보다 적으면 판정하지 않는다 */
const MIN_SAMPLE = 3;

/** 부속품·사은품 노이즈를 거르는 하한 */
const MIN_PRICE = 1000;

interface NaverShopItem {
  lprice: string;
  mallName: string;
}

async function searchNaverShop(query: string): Promise<NaverShopItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', query);
  url.searchParams.set('display', '100');
  url.searchParams.set('sort', 'sim');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: NaverShopItem[] };
    return data.items ?? [];
  } catch {
    // 네트워크 오류는 표본 없음으로 처리한다. 호출자가 unknown 판정을 내린다.
    return [];
  }
}

/**
 * 쿠팡 실판매가를 추정한다.
 *
 * 네이버 쇼핑에는 쿠팡 상품이 연동되어 들어온다. mallName이 '쿠팡'인 항목만
 * 추리면 쿠팡 실판가를 근사할 수 있다.
 *
 * 하위 25%를 쓰는 이유 — 2026-07-31 실측 오차:
 *   최저가   −34% ~ −73%  (스펙이 다른 저가 상품을 잡는다)
 *   하위 25%  −11% ~  +9%  ← 채택
 *   중앙값     0% ~ +324%  (고가 상품에 끌려간다)
 *
 * 표본이 MIN_SAMPLE 미만이면 null을 반환한다. 판정 불가와 탈락은 다르다.
 */
export async function estimateCoupangPrice(
  title: string,
): Promise<CoupangPriceEstimate | null> {
  const prices: number[] = [];

  for (const query of buildSearchQueries(title)) {
    const items = await searchNaverShop(query);
    for (const it of items) {
      if (it.mallName !== '쿠팡') continue;
      const p = parseInt(it.lprice, 10);
      if (Number.isFinite(p) && p >= MIN_PRICE) prices.push(p);
    }
  }

  if (prices.length < MIN_SAMPLE) return null;

  prices.sort((a, b) => a - b);
  return {
    p25: prices[Math.floor(prices.length / 4)],
    sampleN: prices.length,
  };
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 9: 커밋**

```bash
git add src/lib/sourcing/coupang-price.ts src/__tests__/lib/sourcing/coupang-price.test.ts
git commit -m "feat: 네이버 쇼핑 쿠팡몰 기반 쿠팡 실판가 추정"
```

---

## Task 5: 쇼트리스트 DB 레이어

**Files:**
- Create: `src/lib/sourcing/shortlist-db.ts`

- [ ] **Step 1: 구현 작성**

`src/lib/sourcing/shortlist-db.ts`:

```typescript
/**
 * shortlist-db.ts
 * sourcing_shortlist 테이블 CRUD. SQL만 담당하고 검증 로직은 모른다.
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import type { ShortlistItem, LogisticsSize, Verdict, DeliType } from '@/types/shortlist';

interface Row {
  item_no: number;
  title: string;
  memo: string | null;
  added_at: Date;
  dome_status: string | null;
  dome_price: number | null;
  dome_inventory: number | null;
  dome_moq: number | null;
  deli_is_free: boolean | null;
  deli_type: string | null;
  deli_unit_qty: number | null;
  deli_fee: number | null;
  coupang_p25: number | null;
  coupang_sample_n: number | null;
  order_qty: number;
  unit_deli_fee: number | null;
  effective_cost: number | null;
  logistics_size: string;
  break_even_price: number | null;
  margin: number | null;
  margin_rate: string | null;
  verdict: string | null;
  verified_at: Date | null;
  is_archived: boolean;
}

function toItem(r: Row): ShortlistItem {
  return {
    itemNo: r.item_no,
    title: r.title,
    memo: r.memo,
    addedAt: r.added_at.toISOString(),
    domeStatus: r.dome_status,
    domePrice: r.dome_price,
    domeInventory: r.dome_inventory,
    domeMoq: r.dome_moq,
    deliIsFree: r.deli_is_free,
    deliType: r.deli_type as DeliType | null,
    deliUnitQty: r.deli_unit_qty,
    deliFee: r.deli_fee,
    coupangP25: r.coupang_p25,
    coupangSampleN: r.coupang_sample_n,
    orderQty: r.order_qty,
    unitDeliFee: r.unit_deli_fee,
    effectiveCost: r.effective_cost,
    logisticsSize: r.logistics_size as LogisticsSize,
    breakEvenPrice: r.break_even_price,
    margin: r.margin,
    marginRate: r.margin_rate === null ? null : Number(r.margin_rate),
    verdict: r.verdict as Verdict | null,
    verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
    isArchived: r.is_archived,
  };
}

const SELECT_COLS = `
  item_no, title, memo, added_at,
  dome_status, dome_price, dome_inventory, dome_moq,
  deli_is_free, deli_type, deli_unit_qty, deli_fee,
  coupang_p25, coupang_sample_n,
  order_qty, unit_deli_fee, effective_cost, logistics_size,
  break_even_price, margin, margin_rate, verdict, verified_at, is_archived
`;

export async function listShortlist(includeArchived = false): Promise<ShortlistItem[]> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<Row>(
    `SELECT ${SELECT_COLS}
       FROM sourcing_shortlist
      ${includeArchived ? '' : 'WHERE is_archived = false'}
      ORDER BY margin_rate DESC NULLS LAST, added_at DESC`,
  );
  return rows.map(toItem);
}

export async function getShortlistItem(itemNo: number): Promise<ShortlistItem | null> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<Row>(
    `SELECT ${SELECT_COLS} FROM sourcing_shortlist WHERE item_no = $1`,
    [itemNo],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

/** 후보를 추가한다. 이미 있으면 아무것도 하지 않는다. */
export async function insertShortlist(
  itemNo: number,
  title: string,
  orderQty: number,
): Promise<void> {
  const pool = getSourcingPool();
  await pool.query(
    `INSERT INTO sourcing_shortlist (item_no, title, order_qty)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_no) DO NOTHING`,
    [itemNo, title, orderQty],
  );
}

export async function deleteShortlist(itemNo: number): Promise<void> {
  const pool = getSourcingPool();
  await pool.query('DELETE FROM sourcing_shortlist WHERE item_no = $1', [itemNo]);
}

export interface ShortlistPatch {
  memo?: string;
  logisticsSize?: LogisticsSize;
  orderQty?: number;
  isArchived?: boolean;
}

export async function patchShortlist(itemNo: number, patch: ShortlistPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (patch.memo !== undefined) { sets.push(`memo = $${i++}`); vals.push(patch.memo); }
  if (patch.logisticsSize !== undefined) { sets.push(`logistics_size = $${i++}`); vals.push(patch.logisticsSize); }
  if (patch.orderQty !== undefined) { sets.push(`order_qty = $${i++}`); vals.push(patch.orderQty); }
  if (patch.isArchived !== undefined) { sets.push(`is_archived = $${i++}`); vals.push(patch.isArchived); }
  if (sets.length === 0) return;

  vals.push(itemNo);
  const pool = getSourcingPool();
  await pool.query(
    `UPDATE sourcing_shortlist SET ${sets.join(', ')} WHERE item_no = $${i}`,
    vals,
  );
}

/** 모든 행의 사입 수량을 일괄 변경한다. */
export async function setOrderQtyAll(orderQty: number): Promise<void> {
  const pool = getSourcingPool();
  await pool.query('UPDATE sourcing_shortlist SET order_qty = $1', [orderQty]);
}

/** 검증 결과 저장용 필드 */
export interface VerifyResult {
  domeStatus: string | null;
  domePrice: number | null;
  domeInventory: number | null;
  domeMoq: number | null;
  deliIsFree: boolean | null;
  deliType: DeliType | null;
  deliUnitQty: number | null;
  deliFee: number | null;
  coupangP25: number | null;
  coupangSampleN: number | null;
  unitDeliFee: number | null;
  effectiveCost: number | null;
  breakEvenPrice: number | null;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict;
}

export async function saveVerifyResult(itemNo: number, r: VerifyResult): Promise<void> {
  const pool = getSourcingPool();
  await pool.query(
    `UPDATE sourcing_shortlist SET
       dome_status = $1, dome_price = $2, dome_inventory = $3, dome_moq = $4,
       deli_is_free = $5, deli_type = $6, deli_unit_qty = $7, deli_fee = $8,
       coupang_p25 = $9, coupang_sample_n = $10,
       unit_deli_fee = $11, effective_cost = $12,
       break_even_price = $13, margin = $14, margin_rate = $15,
       verdict = $16, verified_at = now()
     WHERE item_no = $17`,
    [
      r.domeStatus, r.domePrice, r.domeInventory, r.domeMoq,
      r.deliIsFree, r.deliType, r.deliUnitQty, r.deliFee,
      r.coupangP25, r.coupangSampleN,
      r.unitDeliFee, r.effectiveCost,
      r.breakEvenPrice, r.margin, r.marginRate,
      r.verdict, itemNo,
    ],
  );
}

/** 검증 대상 목록 — cron이 오래된 것부터 처리한다. */
export async function listForVerify(limit: number): Promise<{ itemNo: number; orderQty: number; logisticsSize: LogisticsSize }[]> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<{ item_no: number; order_qty: number; logistics_size: string }>(
    `SELECT item_no, order_qty, logistics_size
       FROM sourcing_shortlist
      WHERE is_archived = false
      ORDER BY verified_at ASC NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    itemNo: r.item_no,
    orderQty: r.order_qty,
    logisticsSize: r.logistics_size as LogisticsSize,
  }));
}
```

- [ ] **Step 2: 타입 검사 통과 확인**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep shortlist-db || echo "타입 오류 없음"`
Expected: "타입 오류 없음"

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing/shortlist-db.ts
git commit -m "feat: 쇼트리스트 DB 레이어"
```

---

## Task 6: 검증 오케스트레이션

도매꾹 조회 → 배송비 환산 → 쿠팡 시세 → 판정을 조합한다.

**핵심 요구사항:** 도매꾹 API의 *일시적 실패*와 *상품이 실제로 없음*을 구분해야 한다. 전자를 `dead`로 오판하면 멀쩡한 후보가 사라진다. 도매꾹은 없는 상품에 `errors.dcode === 'ITEM_ERROR'`를 반환한다.

**Files:**
- Create: `src/lib/sourcing/shortlist-verify.ts`
- Test: `src/__tests__/lib/sourcing/shortlist-verify.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/sourcing/shortlist-verify.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/sourcing/coupang-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sourcing/coupang-price')>();
  return { ...actual, estimateCoupangPrice: vi.fn() };
});

import { buildVerifyResult } from '@/lib/sourcing/shortlist-verify';
import { estimateCoupangPrice } from '@/lib/sourcing/coupang-price';

const DOME_ALIVE = {
  status: '판매중' as const,
  price: 3300,
  inventory: 1186,
  moq: 2,
  deli: { pay: '선결제', dome: { type: '수량별비례', tbl: '30+3000|30+3000' } },
};

describe('buildVerifyResult', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('판매중이고 쿠팡가가 손익분기를 넘으면 pass', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 9900, sampleN: 90 });

    const r = await buildVerifyResult('메쉬 반장갑', DOME_ALIVE, 10, 'xsmall');

    expect(r.verdict).toBe('pass');
    expect(r.unitDeliFee).toBe(300);       // 30개당 3000원을 10개 주문 → 개당 300
    expect(r.effectiveCost).toBe(3600);    // 3300 + 300
    expect(r.breakEvenPrice).toBe(8995);
    expect(r.margin).toBe(3506);
  });

  it('쿠팡가가 손익분기에 미달하면 fail', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 5080, sampleN: 8 });

    const r = await buildVerifyResult(
      '접이식 쓰레기통',
      { ...DOME_ALIVE, price: 2530, deli: { pay: '선결제', dome: { type: '고정배송비', fee: '3000' } } },
      10,
      'xsmall',
    );

    expect(r.verdict).toBe('fail');
    expect(r.effectiveCost).toBe(2830);
    expect(r.margin).toBeLessThan(0);
  });

  it('도매꾹에 상품이 없으면 dead — 쿠팡 조회를 하지 않는다', async () => {
    const r = await buildVerifyResult('사라진 상품', null, 10, 'xsmall');

    expect(r.verdict).toBe('dead');
    expect(r.domeStatus).toBe('삭제됨');
    expect(estimateCoupangPrice).not.toHaveBeenCalled();
  });

  it('판매종료면 dead', async () => {
    const r = await buildVerifyResult(
      '판매종료 상품',
      { ...DOME_ALIVE, status: '판매종료' },
      10,
      'xsmall',
    );
    expect(r.verdict).toBe('dead');
  });

  it('쿠팡 표본이 부족하면 unknown — fail로 뭉치지 않는다', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue(null);

    const r = await buildVerifyResult('희귀 상품', DOME_ALIVE, 10, 'xsmall');

    expect(r.verdict).toBe('unknown');
    expect(r.coupangP25).toBeNull();
    // 원가 계산은 되어 있어야 한다
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(8995);
  });

  it('사입 수량을 늘리면 개당 배송비가 줄어든다', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 9900, sampleN: 90 });

    const r = await buildVerifyResult('메쉬 반장갑', DOME_ALIVE, 30, 'xsmall');

    expect(r.unitDeliFee).toBe(100);
    expect(r.effectiveCost).toBe(3400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-verify.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현 작성**

`src/lib/sourcing/shortlist-verify.ts`:

```typescript
/**
 * shortlist-verify.ts
 * 쇼트리스트 1건을 검증한다. 도매꾹 생존 → 배송비 환산 → 쿠팡 시세 → 판정.
 */

import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';
import { estimateCoupangPrice, breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
import { saveVerifyResult, type VerifyResult } from '@/lib/sourcing/shortlist-db';
import type { LogisticsSize } from '@/types/shortlist';

/** 도매꾹 조회 결과를 정규화한 것. null이면 상품이 존재하지 않는다. */
export interface DomeSnapshot {
  status: string;
  price: number;
  inventory: number;
  moq: number;
  deli: unknown;
}

/** 도매꾹 API가 일시적으로 실패했음을 나타낸다. dead로 오판하면 안 된다. */
export class DomeTransientError extends Error {}

function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * 도매꾹에서 상품을 조회한다.
 *
 * 반환값 의미:
 *   DomeSnapshot — 상품이 존재한다 (판매중이 아닐 수도 있다)
 *   null         — 상품이 실제로 없다 (삭제됨)
 *   예외         — API 일시 오류. 호출자는 기존 값을 유지해야 한다.
 */
export async function fetchDomeSnapshot(itemNo: number): Promise<DomeSnapshot | null> {
  try {
    const detail = await getDomeggookClient().getItemView(itemNo);
    const basis = detail.basis as Record<string, unknown> | undefined;
    const price = detail.price as Record<string, unknown> | undefined;
    const qty = detail.qty as Record<string, unknown> | undefined;

    return {
      status: String(basis?.status ?? '알수없음'),
      price: toInt(price?.dome),
      inventory: toInt(qty?.inventory),
      moq: toInt(qty?.domeMoq) || 1,
      deli: (detail as Record<string, unknown>).deli,
    };
  } catch (err) {
    // 도매꾹은 없는 상품에 dcode=ITEM_ERROR를 준다.
    // domeggook-client가 메시지에 응답 본문을 담아 던진다.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ITEM_ERROR')) return null;
    throw new DomeTransientError(msg);
  }
}

/**
 * 검증 결과를 계산한다. 외부 호출은 estimateCoupangPrice 하나뿐이라 테스트하기 쉽다.
 *
 * @param dome null이면 도매꾹에서 삭제된 상품
 */
export async function buildVerifyResult(
  title: string,
  dome: DomeSnapshot | null,
  orderQty: number,
  logisticsSize: LogisticsSize,
): Promise<VerifyResult> {
  const empty = {
    deliIsFree: null, deliType: null, deliUnitQty: null, deliFee: null,
    coupangP25: null, coupangSampleN: null,
    unitDeliFee: null, effectiveCost: null,
    breakEvenPrice: null, margin: null, marginRate: null,
  };

  // 삭제됨 — 쿠팡을 조회할 이유가 없다
  if (dome === null) {
    return {
      ...empty,
      domeStatus: '삭제됨',
      domePrice: null, domeInventory: null, domeMoq: null,
      verdict: 'dead',
    };
  }

  const domeFields = {
    domeStatus: dome.status,
    domePrice: dome.price,
    domeInventory: dome.inventory,
    domeMoq: dome.moq,
  };

  // 판매중이 아니면 더 볼 것이 없다
  if (dome.status !== '판매중') {
    return { ...empty, ...domeFields, verdict: 'dead' };
  }

  const policy = parseDeliPolicy(dome.deli);
  const unitDeli = unitDeliveryFee(policy, orderQty);
  const effectiveCost = dome.price + unitDeli;
  const be = breakEvenPrice(effectiveCost, logisticsSize);

  const deliFields = {
    deliIsFree: policy.isFree,
    deliType: policy.type,
    deliUnitQty: policy.unitQty,
    deliFee: policy.fee,
    unitDeliFee: unitDeli,
    effectiveCost,
    breakEvenPrice: be,
  };

  const estimate = await estimateCoupangPrice(title);

  // 표본 부족 — 판정 불가. fail과 구분한다.
  if (estimate === null) {
    return {
      ...domeFields,
      ...deliFields,
      coupangP25: null,
      coupangSampleN: null,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
    };
  }

  const margin = marginOf(estimate.p25, effectiveCost, logisticsSize);

  return {
    ...domeFields,
    ...deliFields,
    coupangP25: estimate.p25,
    coupangSampleN: estimate.sampleN,
    margin,
    marginRate: Math.round((margin / estimate.p25) * 1000) / 10,
    verdict: estimate.p25 >= be ? 'pass' : 'fail',
  };
}

/**
 * 1건을 검증하고 저장한다.
 * 도매꾹 일시 오류면 아무것도 저장하지 않고 false를 반환한다 —
 * verified_at을 갱신하지 않아야 다음 cron이 다시 시도한다.
 */
export async function verifyOne(
  itemNo: number,
  title: string,
  orderQty: number,
  logisticsSize: LogisticsSize,
): Promise<boolean> {
  let dome: DomeSnapshot | null;
  try {
    dome = await fetchDomeSnapshot(itemNo);
  } catch (err) {
    if (err instanceof DomeTransientError) return false;
    throw err;
  }

  const result = await buildVerifyResult(title, dome, orderQty, logisticsSize);
  await saveVerifyResult(itemNo, result);
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-verify.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 전체 테스트 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/`
Expected: PASS — 35 tests

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing/shortlist-verify.ts src/__tests__/lib/sourcing/shortlist-verify.test.ts
git commit -m "feat: 쇼트리스트 검증 오케스트레이션"
```

---

## Task 7: API 라우트 — 목록·추가·삭제·수정

**Files:**
- Create: `src/app/api/sourcing/shortlist/route.ts`
- Create: `src/app/api/sourcing/shortlist/[itemNo]/route.ts`

- [ ] **Step 1: 목록·추가 라우트 작성**

`src/app/api/sourcing/shortlist/route.ts`:

```typescript
/**
 * GET    /api/sourcing/shortlist          목록 조회
 * POST   /api/sourcing/shortlist          후보 추가 (추가 즉시 1회 검증)
 * PATCH  /api/sourcing/shortlist          사입 수량 일괄 변경
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listShortlist,
  insertShortlist,
  getShortlistItem,
  setOrderQtyAll,
} from '@/lib/sourcing/shortlist-db';
import { fetchDomeSnapshot, verifyOne, DomeTransientError } from '@/lib/sourcing/shortlist-verify';
import { extractItemNo } from '@/lib/sourcing/domeggook-url-parser';

const DEFAULT_ORDER_QTY = 10;

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get('archived') === 'true';
  try {
    return NextResponse.json({ items: await listShortlist(includeArchived) });
  } catch (err) {
    console.error('[shortlist] 목록 조회 실패', err);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { input?: string; orderQty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const raw = (body.input ?? '').trim();
  if (!raw) {
    return NextResponse.json({ error: '상품번호 또는 URL을 입력하세요.' }, { status: 400 });
  }

  // 숫자만 있으면 상품번호, 아니면 URL로 본다
  const itemNo = /^\d+$/.test(raw) ? parseInt(raw, 10) : extractItemNo(raw);
  if (!itemNo) {
    return NextResponse.json({ error: '상품번호를 인식하지 못했습니다.' }, { status: 400 });
  }

  const orderQty = body.orderQty && body.orderQty > 0 ? body.orderQty : DEFAULT_ORDER_QTY;

  try {
    const existing = await getShortlistItem(itemNo);
    if (existing) {
      return NextResponse.json({ error: '이미 리스트에 있습니다.', item: existing }, { status: 409 });
    }

    const snapshot = await fetchDomeSnapshot(itemNo);
    if (snapshot === null) {
      return NextResponse.json(
        { error: '도매꾹에 존재하지 않는 상품입니다.' },
        { status: 404 },
      );
    }

    const title = await resolveTitle(itemNo);
    await insertShortlist(itemNo, title, orderQty);
    await verifyOne(itemNo, title, orderQty, 'xsmall');

    return NextResponse.json({ item: await getShortlistItem(itemNo) }, { status: 201 });
  } catch (err) {
    if (err instanceof DomeTransientError) {
      return NextResponse.json(
        { error: '도매꾹 조회에 실패했습니다. 잠시 후 다시 시도하세요.' },
        { status: 503 },
      );
    }
    console.error('[shortlist] 추가 실패', err);
    return NextResponse.json({ error: '추가하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { orderQty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (!body.orderQty || body.orderQty <= 0) {
    return NextResponse.json({ error: '사입 수량은 1 이상이어야 합니다.' }, { status: 400 });
  }

  try {
    await setOrderQtyAll(body.orderQty);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[shortlist] 사입수량 일괄 변경 실패', err);
    return NextResponse.json({ error: '변경하지 못했습니다.' }, { status: 500 });
  }
}

/** 도매꾹에서 상품명을 가져온다. */
async function resolveTitle(itemNo: number): Promise<string> {
  const { getDomeggookClient } = await import('@/lib/sourcing/domeggook-client');
  const detail = await getDomeggookClient().getItemView(itemNo);
  const basis = detail.basis as Record<string, unknown> | undefined;
  return String(basis?.title ?? `상품 ${itemNo}`);
}
```

- [ ] **Step 2: `extractItemNo` 존재 확인**

Run: `grep -n "export" src/lib/sourcing/domeggook-url-parser.ts`
Expected: 도매꾹 URL에서 상품번호를 뽑는 함수가 있다. 이름이 `extractItemNo`가 아니면 위 import를 실제 이름으로 바꾼다.

- [ ] **Step 3: 단건 라우트 작성**

`src/app/api/sourcing/shortlist/[itemNo]/route.ts`:

```typescript
/**
 * DELETE /api/sourcing/shortlist/[itemNo]   삭제
 * PATCH  /api/sourcing/shortlist/[itemNo]   memo·사이즈·사입수량 수정 후 재계산
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  deleteShortlist,
  patchShortlist,
  getShortlistItem,
} from '@/lib/sourcing/shortlist-db';
import { verifyOne } from '@/lib/sourcing/shortlist-verify';
import type { LogisticsSize } from '@/types/shortlist';

const SIZES: LogisticsSize[] = ['xsmall', 'small', 'medium'];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemNo: string }> },
) {
  const { itemNo } = await params;
  const no = parseInt(itemNo, 10);
  if (!Number.isFinite(no)) {
    return NextResponse.json({ error: '잘못된 상품번호입니다.' }, { status: 400 });
  }
  try {
    await deleteShortlist(no);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[shortlist] 삭제 실패', err);
    return NextResponse.json({ error: '삭제하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemNo: string }> },
) {
  const { itemNo } = await params;
  const no = parseInt(itemNo, 10);
  if (!Number.isFinite(no)) {
    return NextResponse.json({ error: '잘못된 상품번호입니다.' }, { status: 400 });
  }

  let body: {
    memo?: string;
    logisticsSize?: LogisticsSize;
    orderQty?: number;
    isArchived?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (body.logisticsSize && !SIZES.includes(body.logisticsSize)) {
    return NextResponse.json({ error: '알 수 없는 사이즈입니다.' }, { status: 400 });
  }
  if (body.orderQty !== undefined && body.orderQty <= 0) {
    return NextResponse.json({ error: '사입 수량은 1 이상이어야 합니다.' }, { status: 400 });
  }

  try {
    await patchShortlist(no, body);

    // 원가에 영향을 주는 값이 바뀌면 손익분기를 다시 계산한다.
    if (body.logisticsSize !== undefined || body.orderQty !== undefined) {
      const item = await getShortlistItem(no);
      if (item) {
        await verifyOne(no, item.title, item.orderQty, item.logisticsSize);
      }
    }

    return NextResponse.json({ item: await getShortlistItem(no) });
  } catch (err) {
    console.error('[shortlist] 수정 실패', err);
    return NextResponse.json({ error: '수정하지 못했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build 2>&1 | tail -20`
Expected: 빌드 성공. 타입 오류가 나면 Next.js 버전의 라우트 핸들러 시그니처를 `node_modules/next/dist/docs/`에서 확인한다(AGENTS.md 지침).

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/shortlist/
git commit -m "feat: 쇼트리스트 API 라우트"
```

---

## Task 8: 재검증 API와 cron

**Files:**
- Create: `src/app/api/sourcing/shortlist/verify/route.ts`
- Create: `src/app/api/sourcing/cron/shortlist-verify/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: 재검증 라우트 작성**

`src/app/api/sourcing/shortlist/verify/route.ts`:

```typescript
/**
 * POST /api/sourcing/shortlist/verify
 * body에 itemNo가 있으면 1건, 없으면 전체를 재검증한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listForVerify, getShortlistItem } from '@/lib/sourcing/shortlist-db';
import { verifyOne } from '@/lib/sourcing/shortlist-verify';

/** 1회 요청당 검증 상한 — 타임아웃 방어 */
const MAX_BATCH = 50;

export async function POST(req: NextRequest) {
  let body: { itemNo?: number } = {};
  try {
    body = await req.json();
  } catch {
    // body 없이 호출하면 전체 재검증
  }

  try {
    if (body.itemNo) {
      const item = await getShortlistItem(body.itemNo);
      if (!item) {
        return NextResponse.json({ error: '리스트에 없는 상품입니다.' }, { status: 404 });
      }
      const ok = await verifyOne(item.itemNo, item.title, item.orderQty, item.logisticsSize);
      return NextResponse.json({ verified: ok ? 1 : 0, skipped: ok ? 0 : 1 });
    }

    const targets = await listForVerify(MAX_BATCH);
    let verified = 0;
    let skipped = 0;

    for (const t of targets) {
      const item = await getShortlistItem(t.itemNo);
      if (!item) continue;
      const ok = await verifyOne(item.itemNo, item.title, item.orderQty, item.logisticsSize);
      ok ? verified++ : skipped++;
    }

    return NextResponse.json({ verified, skipped, total: targets.length });
  } catch (err) {
    console.error('[shortlist] 재검증 실패', err);
    return NextResponse.json({ error: '재검증에 실패했습니다.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: cron 라우트 작성**

`src/app/api/sourcing/cron/shortlist-verify/route.ts`:

```typescript
/**
 * GET /api/sourcing/cron/shortlist-verify
 * 매일 새벽 쇼트리스트를 재검증한다.
 *
 * 인증: Authorization: Bearer <CRON_SECRET>
 *
 * 도매꾹 상품은 예고 없이 사라진다. 2026-07-31 확인 결과 3개월 방치된 후보
 * 10건 중 4건이 판매종료·삭제 상태였다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listForVerify, getShortlistItem } from '@/lib/sourcing/shortlist-db';
import { verifyOne } from '@/lib/sourcing/shortlist-verify';

/** 1회 크론당 검증 상한 */
const BATCH_LIMIT = 100;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  let verified = 0;
  let skipped = 0;

  try {
    const targets = await listForVerify(BATCH_LIMIT);

    for (const t of targets) {
      const item = await getShortlistItem(t.itemNo);
      if (!item) continue;
      try {
        const ok = await verifyOne(item.itemNo, item.title, item.orderQty, item.logisticsSize);
        ok ? verified++ : skipped++;
      } catch (err) {
        // 1건 실패가 전체를 멈추지 않게 한다
        console.error(`[shortlist-cron] ${item.itemNo} 검증 실패`, err);
        skipped++;
      }
    }

    console.log(
      `[shortlist-cron] 검증 ${verified} / 건너뜀 ${skipped} / ${Date.now() - started}ms`,
    );
    return NextResponse.json({ verified, skipped, elapsedMs: Date.now() - started });
  } catch (err) {
    console.error('[shortlist-cron] 실패', err);
    return NextResponse.json({ error: 'cron failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: `vercel.json`에 cron 추가하고 깨진 것 제거**

`vercel.json`의 `crons` 배열에서 다음 항목을 **삭제**한다. 해당 라우트가 존재하지 않아 매일 실패하고 있다.

```json
    {
      "path": "/api/sourcing/agent/run",
      "schedule": "0 21 * * *"
    },
```

그리고 배열에 추가한다. UTC 16:00 = KST 01:00으로, 기존 스케줄과 겹치지 않는다.

```json
    {
      "path": "/api/sourcing/cron/shortlist-verify",
      "schedule": "0 16 * * *"
    }
```

- [ ] **Step 4: 라우트 부재 확인**

Run: `ls src/app/api/sourcing/agent/run/route.ts 2>&1`
Expected: "No such file or directory" — 삭제한 cron이 실제로 깨져 있었음을 확인한다.

- [ ] **Step 5: 빌드 확인**

Run: `npm run build 2>&1 | tail -15`
Expected: 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/sourcing/shortlist/verify/ src/app/api/sourcing/cron/shortlist-verify/ vercel.json
git commit -m "feat: 쇼트리스트 재검증 API와 일일 cron

라우트가 없어 매일 실패하던 agent/run cron도 함께 제거한다."
```

---

## Task 9: ShortlistTab UI

**Files:**
- Create: `src/components/sourcing/ShortlistTab.tsx`

- [ ] **Step 1: 컴포넌트 작성**

기존 탭들의 스타일 토큰(`@/lib/design-tokens`의 `C`)을 따른다.

`src/components/sourcing/ShortlistTab.tsx`:

```typescript
'use client';

/**
 * ShortlistTab.tsx
 * 소싱 후보를 담아두고 도매꾹 생존·쿠팡 시세·손익분기를 추적한다.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import type { ShortlistItem, LogisticsSize, Verdict } from '@/types/shortlist';

const SIZE_LABEL: Record<LogisticsSize, string> = {
  xsmall: '극소형',
  small: '소형',
  medium: '중형',
};

const VERDICT_BADGE: Record<Verdict, { label: string; color: string }> = {
  pass: { label: '✅ 통과', color: '#16a34a' },
  fail: { label: '❌ 미달', color: '#dc2626' },
  dead: { label: '⚠ 판매종료', color: '#6b7280' },
  unknown: { label: '⚠ 표본부족', color: '#d97706' },
};

function won(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

/** 마지막 검증이 24시간을 넘었는지 */
function isStale(verifiedAt: string | null): boolean {
  if (!verifiedAt) return true;
  return Date.now() - new Date(verifiedAt).getTime() > 24 * 60 * 60 * 1000;
}

export default function ShortlistTab() {
  const [items, setItems] = useState<ShortlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [orderQty, setOrderQty] = useState(10);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sourcing/shortlist');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      setItems(data.items);
      if (data.items.length > 0) setOrderQty(data.items[0].orderQty);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sourcing/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim(), orderQty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '추가하지 못했습니다.');
      setInput('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const verifyAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sourcing/shortlist/verify', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '재검증에 실패했습니다.');
      if (data.skipped > 0) {
        setError(`${data.skipped}건은 도매꾹 조회에 실패해 기존 값을 유지했습니다.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (itemNo: number, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/sourcing/shortlist/${itemNo}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const applyOrderQty = async (qty: number) => {
    setOrderQty(qty);
    if (qty <= 0) return;
    setBusy(true);
    try {
      await fetch('/api/sourcing/shortlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderQty: qty }),
      });
      await fetch('/api/sourcing/shortlist/verify', { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (itemNo: number) => {
    setBusy(true);
    try {
      await fetch(`/api/sourcing/shortlist/${itemNo}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.textSub }}>
        <Loader2 size={20} className="animate-spin" style={{ display: 'inline' }} /> 불러오는 중…
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* 상단 컨트롤 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="도매꾹 상품번호 또는 URL"
          style={{
            flex: '1 1 260px', padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.surface, color: C.text,
          }}
        />
        <button onClick={() => void add()} disabled={busy} style={btnStyle()}>
          <Plus size={14} /> 추가
        </button>

        <label style={{ color: C.textSub, fontSize: 13 }}>
          사입 수량
          <input
            type="number"
            min={1}
            value={orderQty}
            onChange={(e) => setOrderQty(Number(e.target.value))}
            onBlur={(e) => void applyOrderQty(Number(e.target.value))}
            style={{
              width: 64, marginLeft: 6, padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${C.border}`, background: C.surface, color: C.text,
            }}
          />
          개
        </label>

        <button onClick={() => void verifyAll()} disabled={busy} style={btnStyle()}>
          <RefreshCw size={14} /> 전체 재검증
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: 'rgba(220,38,38,0.08)', color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.textSub }}>
          아직 담은 후보가 없습니다. 도매꾹 상품번호나 URL을 붙여넣어 추가하세요.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: C.textSub, textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>상품</th>
              <th style={{ padding: 8 }}>도매가</th>
              <th style={{ padding: 8 }}>배송</th>
              <th style={{ padding: 8 }}>실효원가</th>
              <th style={{ padding: 8 }}>쿠팡 p25</th>
              <th style={{ padding: 8 }}>손익분기</th>
              <th style={{ padding: 8 }}>마진율</th>
              <th style={{ padding: 8 }}>사이즈</th>
              <th style={{ padding: 8 }}>상태</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const dead = it.verdict === 'dead';
              return (
                <tr
                  key={it.itemNo}
                  style={{
                    borderTop: `1px solid ${C.border}`,
                    opacity: dead ? 0.45 : 1,
                    textAlign: 'right',
                  }}
                >
                  <td style={{ textAlign: 'left', padding: 8, maxWidth: 280 }}>
                    <a
                      href={`https://domeggook.com/${it.itemNo}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: C.text, textDecoration: 'none' }}
                    >
                      {it.title.slice(0, 40)}
                      <ExternalLink size={11} style={{ marginLeft: 4, opacity: 0.5 }} />
                    </a>
                    {isStale(it.verifiedAt) && (
                      <span style={{ marginLeft: 6, color: '#d97706', fontSize: 11 }}>
                        검증 오래됨
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>{won(it.domePrice)}</td>
                  <td style={{ padding: 8 }} title={deliTitle(it)}>
                    {it.unitDeliFee === null ? '—' : `+${won(it.unitDeliFee)}`}
                  </td>
                  <td style={{ padding: 8 }}>{won(it.effectiveCost)}</td>
                  <td style={{ padding: 8 }}>
                    {won(it.coupangP25)}
                    {it.coupangSampleN !== null && (
                      <span style={{ color: C.textSub, fontSize: 11 }}> (n={it.coupangSampleN})</span>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>{won(it.breakEvenPrice)}</td>
                  <td style={{ padding: 8, color: (it.marginRate ?? 0) >= 30 ? '#16a34a' : C.text }}>
                    {it.marginRate === null ? '—' : `${it.marginRate}%`}
                  </td>
                  <td style={{ padding: 8 }}>
                    <select
                      value={it.logisticsSize}
                      onChange={(e) => void patch(it.itemNo, { logisticsSize: e.target.value })}
                      disabled={busy || dead}
                      style={{
                        background: C.surface, color: C.text,
                        border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 4px',
                      }}
                    >
                      {(Object.keys(SIZE_LABEL) as LogisticsSize[]).map((s) => (
                        <option key={s} value={s}>{SIZE_LABEL[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 8, color: it.verdict ? VERDICT_BADGE[it.verdict].color : C.textSub }}>
                    {it.verdict ? VERDICT_BADGE[it.verdict].label : '—'}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      onClick={() => void remove(it.itemNo)}
                      disabled={busy}
                      style={{ background: 'none', border: 'none', color: C.textSub, cursor: 'pointer' }}
                      aria-label="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${C.border}`, background: C.surface, color: C.text,
  };
}

/** 배송비 정책을 사람이 읽는 문장으로 */
function deliTitle(it: ShortlistItem): string {
  if (it.deliIsFree) return '무료배송';
  if (it.deliType === 'tiered' && it.deliUnitQty) {
    return `${it.deliUnitQty}개당 ${won(it.deliFee)}원`;
  }
  if (it.deliType === 'fixed') return `고정 ${won(it.deliFee)}원`;
  return '배송비 정보 없음';
}
```

- [ ] **Step 2: 디자인 토큰 키 확인**

Run: `grep -n "textSub\|surface\|border\|text:" src/lib/design-tokens.ts | head`
Expected: `C.text`, `C.textSub`, `C.surface`, `C.border`가 존재한다. 이름이 다르면 컴포넌트의 참조를 실제 키로 바꾼다.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build 2>&1 | tail -15`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/components/sourcing/ShortlistTab.tsx
git commit -m "feat: 소싱 쇼트리스트 탭 UI"
```

---

## Task 10: SourcingDashboard 연결과 탭 단층화

**Files:**
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

- [ ] **Step 1: 현재 구조 파악**

Run: `sed -n '1,60p' src/components/sourcing/SourcingDashboard.tsx`
Expected: `MainTab`, `DiscoverSubTab`, `ValidateSubTab`, `ExecuteSubTab` 타입 정의와 import 목록을 확인한다.

- [ ] **Step 2: 탭 구조를 단층으로 교체**

3단(발굴/검증/실행) 구조에서 유지할 것이 4개뿐이므로 단층으로 편다. 파일 상단의 탭 타입 정의를 다음으로 교체한다.

```typescript
type Tab = 'shortlist' | 'costco' | 'agent' | 'memo';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shortlist', label: '소싱리스트' },
  { key: 'costco', label: '코스트코' },
  { key: 'agent', label: '봇결과' },
  { key: 'memo', label: '메모' },
];
```

import 목록을 다음 넷만 남긴다. 나머지 탭 컴포넌트 import는 모두 지운다.

```typescript
import ShortlistTab from '@/components/sourcing/ShortlistTab';
import CostcoTab from '@/components/sourcing/CostcoTab';
import SourcingAgentTab from '@/components/sourcing/SourcingAgentTab';
import SourcingMemoTab from '@/components/sourcing/SourcingMemoTab';
```

렌더 부분을 교체한다.

```typescript
const [tab, setTab] = useState<Tab>('shortlist');

// ...

<div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}` }}>
  {TABS.map((t) => (
    <button
      key={t.key}
      onClick={() => setTab(t.key)}
      style={{
        padding: '10px 16px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        color: tab === t.key ? C.text : C.textSub,
        borderBottom: tab === t.key ? `2px solid ${C.accent ?? C.text}` : '2px solid transparent',
        fontWeight: tab === t.key ? 600 : 400,
      }}
    >
      {t.label}
    </button>
  ))}
</div>

{tab === 'shortlist' && <ShortlistTab />}
{tab === 'costco' && <CostcoTab />}
{tab === 'agent' && <SourcingAgentTab />}
{tab === 'memo' && <SourcingMemoTab />}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build 2>&1 | tail -20`
Expected: 빌드 성공. 삭제 예정 컴포넌트를 아직 지우지 않았으므로 미사용 import 경고만 날 수 있다.

- [ ] **Step 4: 개발 서버로 육안 확인**

Run: `npm run dev`
브라우저에서 `http://localhost:3000/sourcing`을 연다.
Expected: 탭 4개가 보이고 소싱리스트가 기본으로 열린다. 상품번호 `55788793`(메쉬 반장갑)을 추가해 검증 결과가 채워지는지 확인한다.

확인 후 서버를 종료한다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat: 소싱 탭을 단층 구조로 정리하고 쇼트리스트 연결"
```

---

## Task 11: 기존 UI 삭제 — 하위 페이지

여기서부터 삭제다. **각 삭제 전에 역참조를 확인하고, 예상 못 한 의존이 나오면 멈추고 보고한다.**

**Files:**
- Delete: `src/app/sourcing/keyword-optimizer/`, `trademark-precheck/`, `inbound-checklist/`, `negotiation-guide/`, `review-incentives/`, `winner-dashboard/`

- [ ] **Step 1: 역참조 확인**

Run:
```bash
for d in keyword-optimizer trademark-precheck inbound-checklist negotiation-guide review-incentives winner-dashboard; do
  echo "── /sourcing/$d"
  grep -rn "sourcing/$d" src/ --include="*.tsx" --include="*.ts" | grep -v "^src/app/sourcing/$d"
done
```
Expected: 결과 없음. 링크가 나오면 그 링크를 먼저 제거해야 하므로 멈추고 보고한다.

- [ ] **Step 2: 삭제**

```bash
git rm -r src/app/sourcing/keyword-optimizer \
          src/app/sourcing/trademark-precheck \
          src/app/sourcing/inbound-checklist \
          src/app/sourcing/negotiation-guide \
          src/app/sourcing/review-incentives \
          src/app/sourcing/winner-dashboard
```

- [ ] **Step 3: 빌드·테스트 확인**

Run: `npm run build 2>&1 | tail -15 && npx vitest run 2>&1 | tail -10`
Expected: 둘 다 성공

- [ ] **Step 4: 커밋**

```bash
git commit -m "chore: 미사용 소싱 하위 페이지 6개 삭제"
```

---

## Task 12: 기존 UI 삭제 — 컴포넌트

**Files:**
- Delete: `src/components/niche/`, `src/components/winner/`, `DomeggookTab.tsx`, `KeywordTrackerTab.tsx`, `ProductDiscoveryTab.tsx`, `DeepKeywordEngine.tsx`, 관련 폼 컴포넌트, `src/store/useSourcingStore.ts`

- [ ] **Step 1: 역참조 확인**

Run:
```bash
grep -rn "components/niche\|components/winner\|DomeggookTab\|KeywordTrackerTab\|ProductDiscoveryTab\|DeepKeywordEngine\|useSourcingStore" src/ --include="*.tsx" --include="*.ts" \
  | grep -v "^src/components/niche/\|^src/components/winner/\|^src/components/sourcing/DomeggookTab\|^src/components/sourcing/KeywordTrackerTab\|^src/components/sourcing/ProductDiscoveryTab\|^src/components/sourcing/DeepKeywordEngine\|^src/store/useSourcingStore"
```
Expected: 결과 없음. `CostcoTab`이 `useSourcingStore`를 쓰고 있으면 멈추고 보고한다 — 코스트코는 유지 대상이다.

- [ ] **Step 2: 삭제**

```bash
git rm -r src/components/niche src/components/winner
git rm src/components/sourcing/DomeggookTab.tsx \
       src/components/sourcing/KeywordTrackerTab.tsx \
       src/components/sourcing/ProductDiscoveryTab.tsx \
       src/components/sourcing/DeepKeywordEngine.tsx \
       src/components/sourcing/InboundChecklistDoc.tsx \
       src/components/sourcing/InboundChecklistForm.tsx \
       src/components/sourcing/TrademarkPrecheckForm.tsx \
       src/components/sourcing/TrademarkPrecheckResultCard.tsx \
       src/components/sourcing/MarginCalc.tsx
git rm src/store/useSourcingStore.ts
```

- [ ] **Step 3: 남은 참조 정리**

Run: `npm run build 2>&1 | grep -i "cannot find\|module not found" | head`
Expected: 결과 없음. 오류가 나면 해당 파일의 import를 제거한다.

- [ ] **Step 4: 테스트 확인**

Run: `npx vitest run 2>&1 | tail -10`
Expected: PASS. 삭제한 컴포넌트의 테스트가 남아 실패하면 그 테스트 파일도 함께 삭제한다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "chore: 미사용 소싱 컴포넌트 삭제 (니치·아이템위너·도매꾹탐색 등 약 4,600줄)"
```

---

## Task 13: 기존 API·lib 삭제

UI를 지운 뒤 고아가 된 API와 lib을 정리한다. **lib은 listing·텔레그램 봇이 의존하므로 반드시 개별 확인한다.**

**Files:**
- Delete: 고아 API 라우트와 lib 모듈

- [ ] **Step 1: 고아 API 후보 확인**

Run:
```bash
for r in product-discover trademark-precheck verify-ip legal-trademark recommendations export analyze snapshot; do
  echo "── $r"
  grep -rn "api/sourcing/$r" src/ --include="*.tsx" --include="*.ts" | grep -v "^src/app/api/sourcing/$r"
done
```
Expected: 각 항목에 결과가 없으면 고아다. 결과가 있으면 그 항목은 삭제하지 않는다.

- [ ] **Step 2: 고아 API 삭제**

Step 1에서 참조가 없는 것만 지운다.

```bash
git rm -r src/app/api/sourcing/product-discover \
          src/app/api/sourcing/trademark-precheck \
          src/app/api/sourcing/verify-ip \
          src/app/api/sourcing/legal-trademark \
          src/app/api/sourcing/recommendations
```

- [ ] **Step 3: lib 모듈 개별 확인**

Run:
```bash
for m in inbound-checklist negotiation-guide kipris-client seed-scoring recommend-batch product-discovery-pipeline domeggook-scoring domeggook-cs-filter; do
  n=$(grep -rn "sourcing/$m" src/ --include="*.ts" --include="*.tsx" | grep -v "^src/lib/sourcing/$m" | wc -l)
  echo "$m → 참조 $n건"
done
```
Expected: 참조 0건인 것만 삭제 대상이다. **1건이라도 있으면 남긴다.**

- [ ] **Step 4: 고아 lib 삭제**

Step 3에서 참조 0건인 모듈만 `git rm`으로 지운다. 해당 테스트 파일이 있으면 함께 지운다.

- [ ] **Step 5: 빌드·테스트 확인**

Run: `npm run build 2>&1 | tail -15 && npx vitest run 2>&1 | tail -10`
Expected: 둘 다 성공

- [ ] **Step 6: 텔레그램 봇 경로 무결성 확인**

삭제가 봇을 깨뜨리지 않았는지 확인한다.

Run:
```bash
npx tsc --noEmit 2>&1 | grep -i "sourcing-agent\|telegram" || echo "봇 경로 타입 오류 없음"
```
Expected: "봇 경로 타입 오류 없음"

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: UI 삭제 후 고아가 된 소싱 API·lib 정리"
```

---

## Task 14: 최종 확인

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run 2>&1 | tail -15`
Expected: 전부 PASS

- [ ] **Step 2: 프로덕션 빌드**

Run: `npm run build 2>&1 | tail -25`
Expected: 성공. 라우트 목록에 `/api/sourcing/shortlist`와 `/api/sourcing/cron/shortlist-verify`가 보인다.

- [ ] **Step 3: 유지 기능 목록 확인**

Run:
```bash
ls src/lib/sourcing-agent/ src/lib/telegram/ src/app/api/telegram/webhook/
ls src/lib/sourcing/trend-discovery.ts src/app/api/sourcing/cron/trend-seeds/
ls src/components/sourcing/
```
Expected: 텔레그램 봇, 유튜브 트렌드, 코스트코 관련 파일이 모두 남아 있다.

- [ ] **Step 4: cron 정합성 확인**

Run:
```bash
node -e "
const v=require('./vercel.json');
const fs=require('fs');
for (const c of v.crons) {
  const p='src/app'+c.path+'/route.ts';
  console.log((fs.existsSync(p)?'✓':'✗ 라우트 없음')+' '+c.path);
}"
```
Expected: 모든 항목이 `✓`. `agent/run`이 목록에 없어야 한다.

- [ ] **Step 5: 개발 서버로 최종 확인**

Run: `npm run dev`

`http://localhost:3000/sourcing`에서 확인한다.
- 탭 4개(소싱리스트·코스트코·봇결과·메모)가 보인다
- 소싱리스트에서 상품번호 `55788793`을 추가하면 도매가 3,300원, 배송 +300원, 실효원가 3,600원, 손익분기 8,995원이 채워진다
- 사입 수량을 30으로 바꾸면 배송이 +100원, 실효원가가 3,400원으로 바뀐다
- 사이즈를 중형으로 바꾸면 손익분기가 올라간다
- 코스트코 탭과 봇결과 탭이 정상 동작한다

확인 후 서버를 종료한다.

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "chore: 소싱 쇼트리스트 구현 완료" || echo "커밋할 변경 없음"
git log --oneline feat-sourcing-shortlist ^main | head -20
```

---

## Self-Review 결과

**스펙 커버리지 확인**

| 스펙 항목 | 담당 Task |
|---|---|
| 기존 UI 삭제 (컴포넌트·페이지·API·lib) | 11, 12, 13 |
| 깨진 `agent/run` cron 제거 | 8 |
| 유지 대상 보호 (봇·트렌드·코스트코·listing) | 11~13의 역참조 확인, 13 Step 6 |
| `sourcing_shortlist` 테이블 | 1 |
| 배송비 파싱·개당 환산 | 2 |
| 쿠팡 시세 추정 (하위 25%) | 4 |
| 손익분기·마진 계산 | 3 |
| verdict 4종 (pass/fail/dead/unknown) | 6 |
| 도매꾹 일시오류와 삭제 구분 | 6 (`DomeTransientError`) |
| API 6종 | 7, 8 |
| 매일 새벽 cron | 8 |
| 단층 탭 구조 | 10 |
| 물류비 사이즈 드롭다운 | 9 |
| 사입 수량 일괄 적용 | 7(PATCH), 9(UI) |
| 테스트 (손익분기·배송비·검색어·시세추정) | 2, 3, 4, 6 |

**타입 일관성 확인** — `LogisticsSize`, `Verdict`, `DeliPolicy`, `DeliType`, `ShortlistItem`, `VerifyResult`는 Task 1과 5에서 정의하고 이후 Task에서 같은 이름으로만 참조한다. 함수명은 `parseDeliPolicy`, `unitDeliveryFee`, `breakEvenPrice`, `marginOf`, `buildSearchQueries`, `estimateCoupangPrice`, `fetchDomeSnapshot`, `buildVerifyResult`, `verifyOne`으로 고정한다.

**남은 확인 사항** — Task 7 Step 2에서 `domeggook-url-parser.ts`의 실제 export 이름을, Task 9 Step 2에서 `design-tokens.ts`의 실제 키 이름을 확인하고 맞춘다. 두 파일 모두 기존 코드라 이름을 단정하지 않았다.
