# 상단 표 판정을 두 공급처 중 좋은 쪽으로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱리스트 상단 표가 도매꾹과 1688 중 원가가 낮은 쪽 기준으로 판정·숫자를 보여주게 하고, 국제배송비를 자동 추정해 1688 원가가 0으로 낙관되지 않게 한다.

**Architecture:** 판정 로직을 순수 함수 모듈로 추출해 상단 표와 비교 패널이 공유한다. 국제배송비는 이미 있는 실측 요율표(`intl-shipping.ts`)에 사이즈별 대표 무게를 곱해 추정하고, 저장하지 않는다 — 요율이나 사입 수량이 바뀌면 자동으로 다시 계산된다.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Postgres(`getSourcingPool`)

**선행 작업:** PR #14 (`3e24dbf0`) — 1688 붙여넣기·원가 계산·비교 패널

---

## 배경

PR #14 병합 후 브라우저로 확인하다 두 가지가 드러났다.

**1. 상단 표 판정이 도매꾹 기준이라 1688의 통과가 안 보인다.** 실판가 12,000원인 항목이 표에는 `미달`·마진율 −331%로 뜨는데, 펼치면 1688은 53.1% 마진 통과다. 소싱리스트를 훑을 때 빨간 미달만 보고 넘기면 **1688로 팔 수 있는 상품을 놓친다.** 이 기능이 막으려던 바로 그 일이다.

**2. 국제배송비가 0원이라 1688 원가가 낙관적이다.** 사람이 넣기 전에는 배대지→한국 구간이 통째로 빠진다.

`src/lib/sourcing/intl-shipping.ts`에 실측 요율표가 이미 있다 (더싼배대지 위해 해운, 2026-07-31 확인, 0.5kg 단위 31행 + 외삽). **테스트 말고는 아무 데서도 쓰이지 않는 고아 모듈이다.** 무게만 있으면 배송비를 낼 수 있고, 무게는 `logisticsSize`로 근사할 수 있다.

### 확정된 정책 결정

| 결정 | 내용 | 근거 |
|---|---|---|
| 관세사 수임료 | **원가에 넣지 않는다** | 배대지가 통관 대행을 포함한다. 별도 선임 시 이중 계상이 된다 |
| 사입 수량 기본값 | **10 → 30** | 샘플 2개 주문의 배송비로 원가를 매기면 상품이 부당하게 나빠 보인다. 배송비는 실제 사입 예정 수량 기준이어야 한다 |
| 배송비 추정값 | **저장하지 않는다** | 요율표·사입 수량이 바뀌면 저장값이 조용히 낡는다. 기존 "파생값 미저장" 원칙과 같다 |
| 사람이 넣은 값 | **추정값을 항상 이긴다** | 추정은 실측이 없을 때의 대체재다 |

### 사입 수량이 개당 배송비를 지배한다

요율표 최소 구간이 0.5kg·4,180원이라 소량 사입은 배송비가 상품가를 압도한다. 개당 상품가 1,934원·극소형(0.3kg 가정)·관세 8% 기준 실측:

| 사입 수량 | 총 무게 | 배송비 | 개당 | 실효원가 | 손익분기 |
|---|---|---|---|---|---|
| 10개 | 3.0kg | 7,430원 | 743원 | 3,180원 | 8,994원 |
| **30개** | **9.0kg** | **15,980원** | **533원** | **2,930원** | **8,710원** |
| 50개 | 15.0kg | 23,190원 | 464원 | 2,849원 | 8,618원 |
| 100개 | 30.0kg | 39,690원 (외삽) | 397원 | 2,769원 | 8,528원 |

배송비 0원일 때의 손익분기는 7,993원이었다. 30개 기준 추정을 넣어도 8,710원이라 **판정이 뒤집히는 구간은 좁다** — 그래서 추정값을 넣는 편이 안전하고, 넣어도 기회를 크게 잃지 않는다.

---

## File Structure

**신규**

| 경로 | 책임 |
|---|---|
| `src/lib/sourcing/supplier-verdict.ts` | 공급처별 판정 + 좋은 쪽 선택. 상단 표와 비교 패널이 공유 |
| `src/__tests__/lib/sourcing/supplier-verdict.test.ts` | 판정·선택 규칙 |
| `supabase/migrations/099_order_qty_default_30.sql` | 사입 수량 기본값 |

**수정**

| 경로 | 변경 |
|---|---|
| `src/lib/sourcing/coupang-price.ts` | `DEFAULT_ORDER_QTY` 정본 정의 |
| `src/lib/sourcing/intl-shipping.ts` | 사이즈별 대표 무게 + 개당 배송비 추정 함수 |
| `src/lib/sourcing/cost-1688.ts` | 배송비 null이면 추정값 사용 |
| `src/app/api/sourcing/shortlist/route.ts` | 로컬 `DEFAULT_ORDER_QTY` 삭제 후 import |
| `src/components/sourcing/ShortlistTab.tsx` | 로컬 상수 삭제, 표를 좋은 쪽 기준으로 |
| `src/components/sourcing/DiscoveryTab.tsx` | 로컬 `ASSUMED_ORDER_QTY` 삭제 후 import |
| `src/lib/sourcing-agent/keyword-pipeline.ts` | 로컬 `ASSUMED_ORDER_QTY` 삭제 후 import |
| `src/components/sourcing/SupplierCompare.tsx` | 판정을 공유 모듈에 위임 |

---

## Task 1: 사입 수량 기본값 단일화 + 30

`10`이 다섯 군데에 흩어져 있다. 1만원 하한과 똑같은 패턴이므로 여섯 번째 사본을 만들지 말고 먼저 모은다.

| 위치 | 현재 |
|---|---|
| `src/app/api/sourcing/shortlist/route.ts:18` | `const DEFAULT_ORDER_QTY = 10` |
| `src/components/sourcing/ShortlistTab.tsx:40` | `const DEFAULT_ORDER_QTY = 10` |
| `src/components/sourcing/DiscoveryTab.tsx:450` | `const ASSUMED_ORDER_QTY = 10` |
| `src/lib/sourcing-agent/keyword-pipeline.ts:29` | `const ASSUMED_ORDER_QTY = 10` |
| `supabase/migrations/094_sourcing_shortlist.sql:42` | `order_qty integer NOT NULL DEFAULT 10` |

**Files:**
- Modify: `src/lib/sourcing/coupang-price.ts`
- Modify: 위 표의 TS/TSX 4개
- Create: `supabase/migrations/099_order_qty_default_30.sql`

- [ ] **Step 1: 정본 상수 추가**

`src/lib/sourcing/coupang-price.ts`에 추가 (`MIN_SELL_PRICE_KRW` 옆):

```typescript
/**
 * 기본 사입 수량 — 개당 배송비를 환산하는 기준이다.
 *
 * 30인 이유: 1688에서 2개만 샘플로 사서 붙여넣어도 배송비는 실제 사입 예정
 * 수량으로 나눠야 한다. 샘플 수량으로 나누면 국제배송비 최소 구간(0.5kg·4,180원)이
 * 통째로 두세 개에 얹혀 개당 원가가 뻥튀기되고, 팔 수 있는 상품이 미달로 보인다.
 *
 * 도매꾹 개당 배송비(unitDeliveryFee)에도 같은 값이 쓰인다 — 두 공급처를
 * 같은 사입 규모로 비교해야 판정이 공정하다.
 */
export const DEFAULT_ORDER_QTY = 30;
```

- [ ] **Step 2: 사본 4개 제거**

각 파일에서 로컬 정의를 지우고 `import { DEFAULT_ORDER_QTY } from '@/lib/sourcing/coupang-price'`로 바꾼다. `ASSUMED_ORDER_QTY`라는 이름으로 쓰던 두 곳도 `DEFAULT_ORDER_QTY`를 직접 쓴다 — 이름이 둘인 이유가 없었고, `DiscoveryTab.tsx:449`의 주석이 이미 "쇼트리스트 POST의 기본값과 같다"고 실토하고 있다.

- [ ] **Step 3: 마이그레이션**

`supabase/migrations/099_order_qty_default_30.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 099_order_qty_default_30.sql
-- [Render PostgreSQL] Supabase 마이그레이션이 아니다. SOURCING_DATABASE_URL로
-- 접속하는 Render DB 전용이며, Supabase 프로젝트에는 적용되지 않는다.
--
-- 사입 수량 기본값 10 → 30.
--
-- 개당 배송비 환산 기준이다. 1688에서 2개만 샘플로 사서 붙여넣어도 배송비는
-- 실제 사입 예정 수량으로 나눠야 하는데, 10개 기준이면 국제배송비 최소
-- 구간(0.5kg·4,180원)이 소수에 얹혀 개당 원가가 뻥튀기된다.
--
-- 기존 행도 함께 올린다. 사입 수량이 바뀌면 개당 배송비·실효원가·손익분기가
-- 전부 달라지므로 verified_at을 비워 재검증 큐 앞으로 보낸다 —
-- 낡은 판정을 그대로 두면 화면이 조용히 틀린 값을 보여준다.
--
-- 적용: node scripts/migrate-sourcing.mjs 099
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sourcing_shortlist
  ALTER COLUMN order_qty SET DEFAULT 30;

UPDATE public.sourcing_shortlist
   SET order_qty = 30,
       verified_at = NULL
 WHERE order_qty = 10;

COMMENT ON COLUMN public.sourcing_shortlist.order_qty IS
  '검증 사입 수량. 개당 배송비 환산 기준. 기본 30 (코드의 DEFAULT_ORDER_QTY와 같다)';
```

**DB에 적용하지 않는다.** 소유자가 직접 실행한다.

- [ ] **Step 4: 검증**

```bash
npx vitest run 2>&1 | tail -20   # 래칫 유지
npx tsc --noEmit
```

`keyword-pipeline.test.ts`의 `evaluateCandidate` 회귀 테스트가 사입 수량에 의존한다면 기대값이 바뀐다. **깨지면 그 테스트가 무엇을 지키려던 것인지 먼저 읽고**, 사입 수량 변경으로 정당하게 바뀐 값인지 판단해 고친다.

- [ ] **Step 5: 커밋**

```bash
git add -A src/lib/sourcing/coupang-price.ts src/app/api/sourcing/shortlist/route.ts \
  src/components/sourcing/ShortlistTab.tsx src/components/sourcing/DiscoveryTab.tsx \
  src/lib/sourcing-agent/keyword-pipeline.ts supabase/migrations/099_order_qty_default_30.sql
git commit -m "feat(sourcing): 사입 수량 기본값 30으로, 상수 단일화

10이 네 파일에 복제돼 있었고 DiscoveryTab의 주석이 이미 '쇼트리스트
POST의 기본값과 같다'고 실토하고 있었다. coupang-price.ts로 모았다.

30인 이유는 샘플 구매 때문이다. 1688에서 2개만 사서 붙여넣어도 배송비는
실제 사입 예정 수량으로 나눠야 한다. 샘플 수량으로 나누면 국제배송비
최소 구간(0.5kg·4,180원)이 두세 개에 얹혀 개당 원가가 뻥튀기되고,
팔 수 있는 상품이 미달로 보인다."
```

---

## Task 2: 국제배송비 자동 추정

**Files:**
- Modify: `src/lib/sourcing/intl-shipping.ts`
- Modify: `src/lib/sourcing/cost-1688.ts`
- Test: `src/__tests__/lib/sourcing/intl-shipping.test.ts` (기존), `src/__tests__/lib/sourcing/cost-1688.test.ts` (기존)

- [ ] **Step 1: 실패 테스트 — 추정 함수**

`src/__tests__/lib/sourcing/intl-shipping.test.ts`에 추가:

```typescript
import { estimateIntlShipPerUnitKrw, ASSUMED_UNIT_WEIGHT_KG } from '@/lib/sourcing/intl-shipping';

describe('estimateIntlShipPerUnitKrw', () => {
  it('극소형 30개 — 9kg 구간 15,980원을 30으로 나눈다', () => {
    const r = estimateIntlShipPerUnitKrw('xsmall', 30);
    expect(r.billedKg).toBe(9);
    expect(r.totalKrw).toBe(15980);
    expect(r.perUnitKrw).toBe(533);
    expect(r.extrapolated).toBe(false);
  });

  it('사입 수량이 늘면 개당이 싸진다 — 요율이 무게에 체감하기 때문', () => {
    const q10 = estimateIntlShipPerUnitKrw('xsmall', 10).perUnitKrw;
    const q30 = estimateIntlShipPerUnitKrw('xsmall', 30).perUnitKrw;
    const q50 = estimateIntlShipPerUnitKrw('xsmall', 50).perUnitKrw;
    expect(q10).toBe(743);
    expect(q30).toBe(533);
    expect(q50).toBe(464);
    expect(q10).toBeGreaterThan(q30);
    expect(q30).toBeGreaterThan(q50);
  });

  it('요율표를 넘어서면 외삽 표시를 세운다', () => {
    // 극소형 100개 = 30kg. 표는 15.5kg까지다
    const r = estimateIntlShipPerUnitKrw('xsmall', 100);
    expect(r.extrapolated).toBe(true);
    expect(r.perUnitKrw).toBe(397);
  });

  it('사이즈마다 가정 무게가 다르다', () => {
    expect(ASSUMED_UNIT_WEIGHT_KG.xsmall).toBe(0.3);
    expect(ASSUMED_UNIT_WEIGHT_KG.small).toBe(1.0);
    expect(ASSUMED_UNIT_WEIGHT_KG.medium).toBe(3.0);
    // 같은 수량이면 무거운 사이즈가 비싸다
    const q = 30;
    expect(estimateIntlShipPerUnitKrw('medium', q).perUnitKrw)
      .toBeGreaterThan(estimateIntlShipPerUnitKrw('xsmall', q).perUnitKrw);
  });

  it('수량이 0 이하면 계산하지 않는다', () => {
    expect(estimateIntlShipPerUnitKrw('xsmall', 0)).toBeNull();
    expect(estimateIntlShipPerUnitKrw('xsmall', -1)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/intl-shipping.test.ts`
Expected: FAIL — `estimateIntlShipPerUnitKrw`가 export되지 않음

- [ ] **Step 3: 구현**

`src/lib/sourcing/intl-shipping.ts`:

**파일 상단**에 import를 추가한다 (`@/types/shortlist`는 순수 타입 모듈이라 순환 참조가 생기지 않는다):

```typescript
import type { LogisticsSize } from '@/types/shortlist';
```

그리고 **파일 하단**에 아래를 추가한다:

```typescript
/**
 * 사이즈별 가정 개당 무게 (kg).
 *
 * 로켓그로스 사이즈 유형의 무게 **상한**(극소형 2kg / 소형 5kg / 중형 10kg)을
 * 그대로 쓰지 않는 이유: 상한은 "그 유형에 들어가는 최대"라 대표값이 아니다.
 * 극소형에 2kg을 쓰면 파우치 30개가 60kg이 되어 배송비가 상품가를 몇 배
 * 넘어선다. 실제 극소형 소품은 0.1~0.5kg대다.
 *
 * 이 값들은 실측이 아니라 가정이다. 사장님이 실제 발주 무게를 확인하면
 * 이 상수만 고치면 된다 — 추정값은 저장하지 않으므로 다음 조회부터 즉시 반영된다.
 */
export const ASSUMED_UNIT_WEIGHT_KG: Record<LogisticsSize, number> = {
  xsmall: 0.3,
  small: 1.0,
  medium: 3.0,
};

export interface IntlShipEstimate {
  /** 개당 국제배송비 */
  perUnitKrw: number;
  /** 발주 전체 배송비 */
  totalKrw: number;
  /** 과금에 쓰인 절상 무게 */
  billedKg: number;
  /** 요율표 범위를 넘어 외삽한 값인가 */
  extrapolated: boolean;
}

/**
 * 사이즈와 사입 수량으로 개당 국제배송비를 추정한다.
 *
 * 관세사 수임료는 넣지 않는다 — 배대지가 통관 대행을 포함하므로
 * 별도로 얹으면 이중 계상이 된다.
 *
 * 개당 값이 수량에 따라 달라지는 것이 핵심이다. 요율이 무게에 체감하므로
 * 많이 살수록 개당이 싸진다. 그래서 샘플 수량이 아니라 실제 사입 예정
 * 수량(DEFAULT_ORDER_QTY)으로 계산해야 한다.
 */
export function estimateIntlShipPerUnitKrw(
  size: LogisticsSize,
  orderQty: number,
): IntlShipEstimate | null {
  if (orderQty <= 0) return null;

  const totalWeightKg = ASSUMED_UNIT_WEIGHT_KG[size] * orderQty;
  const { fee, estimated, billedKg } = shippingFeeKrw(totalWeightKg);

  return {
    perUnitKrw: Math.round(fee / orderQty),
    totalKrw: fee,
    billedKg,
    extrapolated: estimated,
  };
}
```

- [ ] **Step 4: 실패 테스트 — cost-1688 연결**

`src/__tests__/lib/sourcing/cost-1688.test.ts`에 추가:

```typescript
describe('calc1688UnitCost — 국제배송비 추정', () => {
  it('배송비가 null이면 사입 수량 기준으로 추정한다', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867,
      orderQty: 2,              // 1688에서 실제로 산 수량 (샘플)
      sourcingOrderQty: 30,     // 사입 예정 수량 — 배송비 환산 기준
      intlShipPerUnitKrw: null, // 사람이 아직 안 넣었다
      itemName: '실리콘 필통',
      logisticsSize: 'xsmall',
    });

    expect(r.unitKrw).toBe(1934);            // 3867 / 2 — 샘플 수량으로 나눈다
    expect(r.intlShipPerUnitKrw).toBe(533);  // 30개 기준으로 추정
    expect(r.shipEstimated).toBe(true);
    expect(r.shippingMissing).toBe(false);   // 추정값이 있으니 누락이 아니다
    expect(r.effectiveCostKrw).toBe(2930);
    expect(r.breakEvenPriceKrw).toBe(8710);
  });

  it('사람이 넣은 값이 추정값을 이긴다', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867, orderQty: 2, sourcingOrderQty: 30,
      intlShipPerUnitKrw: 322,
      itemName: '실리콘 필통', logisticsSize: 'xsmall',
    });
    expect(r.intlShipPerUnitKrw).toBe(322);
    expect(r.shipEstimated).toBe(false);
    expect(r.effectiveCostKrw).toBe(2680);   // 기존 테스트와 같은 값
  });

  it('추정도 불가능하면 배송비 누락으로 표시한다', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867, orderQty: 2, sourcingOrderQty: 0,
      intlShipPerUnitKrw: null,
      itemName: '실리콘 필통', logisticsSize: 'xsmall',
    });
    expect(r.intlShipPerUnitKrw).toBe(0);
    expect(r.shippingMissing).toBe(true);
  });
});
```

**기존 테스트 4건의 입력에 `sourcingOrderQty`를 추가해야 한다.** `intlShipPerUnitKrw`를 명시적으로 넘기는 케이스이므로 기대값은 바뀌지 않는다 — 바뀐다면 구현이 틀린 것이다.

- [ ] **Step 5: 구현**

`src/lib/sourcing/cost-1688.ts`:

```typescript
// Cost1688Input에 추가
  /** 사입 예정 수량 — 국제배송비 환산 기준. 1688에서 실제로 산 수량(orderQty)과 다르다 */
  sourcingOrderQty: number;
  /** 개당 국제배송비. null이면 사이즈·사입 수량으로 추정한다 */
  intlShipPerUnitKrw: number | null;

// Cost1688Result에 추가
  /** 실제로 계산에 쓰인 개당 국제배송비 */
  intlShipPerUnitKrw: number;
  /** 위 값이 추정치인가 (사람이 넣은 값이 아닌가) */
  shipEstimated: boolean;
```

함수 안에서 배송비를 정하는 부분:

```typescript
  // 사람이 넣은 값이 항상 이긴다. 추정은 실측이 없을 때의 대체재다.
  const est = input.intlShipPerUnitKrw === null
    ? estimateIntlShipPerUnitKrw(input.logisticsSize, input.sourcingOrderQty)
    : null;
  const ship = input.intlShipPerUnitKrw ?? est?.perUnitKrw ?? 0;
  const shipEstimated = input.intlShipPerUnitKrw === null && est !== null;
  // 추정조차 못 한 경우에만 누락이다 — 추정값이 있으면 0이 아니므로 낙관 오류가 아니다
  const shippingMissing = ship <= 0;
```

`calcImportTax`에 넘기는 `dutiableFreightKrw`는 `ship`이다.

- [ ] **Step 6: 통과 확인 + 커밋**

```bash
npx vitest run src/__tests__/lib/sourcing/
npx tsc --noEmit
git add src/lib/sourcing/intl-shipping.ts src/lib/sourcing/cost-1688.ts \
  src/__tests__/lib/sourcing/intl-shipping.test.ts src/__tests__/lib/sourcing/cost-1688.test.ts
git commit -m "feat(sourcing): 국제배송비 자동 추정

intl-shipping.ts에 실측 요율표(더싼배대지 위해 해운)가 있는데 테스트
말고는 아무 데서도 쓰이지 않는 고아 모듈이었다. 사이즈별 가정 무게를
곱해 개당 배송비를 낸다.

사람이 넣은 값이 항상 추정값을 이긴다. 추정값은 저장하지 않는다 —
요율표나 사입 수량이 바뀌면 저장값이 조용히 낡는다.

관세사 수임료는 넣지 않는다. 배대지가 통관 대행을 포함하므로 별도로
얹으면 이중 계상이 된다."
```

---

## Task 3: 공급처 판정 공유 모듈

지금 판정 로직이 두 곳에 있다. `shortlist-verify.ts`가 도매꾹 기준으로 계산해 DB에 저장하고, `SupplierCompare.tsx`의 `judge()`가 화면에서 따로 계산한다. 상단 표까지 세 번째 사본을 만들면 셋이 어긋난다.

**Files:**
- Create: `src/lib/sourcing/supplier-verdict.ts`
- Test: `src/__tests__/lib/sourcing/supplier-verdict.test.ts`

- [ ] **Step 1: 실패 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { judgeSupplier, pickBestSupplier } from '@/lib/sourcing/supplier-verdict';

const DOME = {
  supplier: 'dome' as const,
  unitPriceKrw: 48100,
  shipPerUnitKrw: 300,
  shipEstimated: false,
  effectiveCostKrw: 48400,
  breakEvenPriceKrw: 86542,
};
const CN = {
  supplier: 'cn1688' as const,
  unitPriceKrw: 1934,
  shipPerUnitKrw: 533,
  shipEstimated: true,
  effectiveCostKrw: 2930,
  breakEvenPriceKrw: 8710,
};

describe('judgeSupplier', () => {
  it('실판가가 손익분기 이상이면 통과', () => {
    const r = judgeSupplier(12000, CN, 'xsmall');
    expect(r.verdict).toBe('pass');
    expect(r.marginRatePct).toBeGreaterThan(0);
  });

  it('손익분기 미달이면 부족액을 말한다', () => {
    const r = judgeSupplier(12000, DOME, 'xsmall');
    expect(r.verdict).toBe('fail');
    expect(r.why).toContain('74,542');
  });

  it('1만원 하한이 손익분기보다 먼저다', () => {
    // 9,900원은 1688 손익분기 8,710원을 넘지만 하한 미만이다
    const r = judgeSupplier(9900, CN, 'xsmall');
    expect(r.verdict).toBe('fail');
    expect(r.why).toContain('하한');
    expect(r.why).toContain('공급처와 무관');
  });

  it('실판가가 없으면 판정하지 않는다', () => {
    expect(judgeSupplier(null, CN, 'xsmall').verdict).toBe('unknown');
  });
});

describe('pickBestSupplier', () => {
  it('실효원가가 낮은 쪽을 고른다', () => {
    expect(pickBestSupplier(DOME, CN).supplier).toBe('cn1688');
  });

  it('1688 값이 없으면 도매꾹', () => {
    expect(pickBestSupplier(DOME, null).supplier).toBe('dome');
  });

  it('도매꾹이 더 싸면 도매꾹', () => {
    const cheapDome = { ...DOME, effectiveCostKrw: 1000, breakEvenPriceKrw: 5000 };
    expect(pickBestSupplier(cheapDome, CN).supplier).toBe('dome');
  });

  it('동률이면 도매꾹 — 리드타임이 짧고 통관 위험이 없다', () => {
    const tie = { ...CN, effectiveCostKrw: DOME.effectiveCostKrw };
    expect(pickBestSupplier(DOME, tie).supplier).toBe('dome');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/supplier-verdict.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/sourcing/supplier-verdict.ts`:

```typescript
/**
 * 공급처별 판정과 "좋은 쪽" 선택.
 *
 * 상단 표와 비교 패널이 같은 규칙을 써야 하므로 순수 함수로 뽑았다.
 * 이전에는 shortlist-verify.ts(저장용)와 SupplierCompare.tsx(화면용)에
 * 같은 규칙이 두 벌 있었다.
 */

import { breakEvenPrice, marginOf, MIN_SELL_PRICE_KRW } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize, Verdict } from '@/types/shortlist';

export type SupplierKind = 'dome' | 'cn1688';

export interface SupplierCost {
  supplier: SupplierKind;
  /** 개당 매입가 */
  unitPriceKrw: number;
  /** 개당 배송비 (도매꾹은 국내, 1688은 국제 구간) */
  shipPerUnitKrw: number;
  /** 배송비가 추정치인가 */
  shipEstimated: boolean;
  /** 관세·부가세까지 포함한 개당 실효원가 */
  effectiveCostKrw: number;
  breakEvenPriceKrw: number;
}

export interface SupplierJudgement {
  verdict: Verdict;
  /** 사람이 읽는 사유 */
  why: string;
  marginKrw: number | null;
  marginRatePct: number | null;
}

/**
 * 판정. 하한이 손익분기보다 **먼저**다 —
 * 애초에 팔지 않을 가격대라면 손익분기를 논할 이유가 없다.
 */
export function judgeSupplier(
  coupangP25: number | null,
  cost: SupplierCost,
  size: LogisticsSize,
): SupplierJudgement {
  if (coupangP25 === null) {
    return { verdict: 'unknown', why: '쿠팡 실판가 미입력', marginKrw: null, marginRatePct: null };
  }

  if (coupangP25 < MIN_SELL_PRICE_KRW) {
    return {
      verdict: 'fail',
      // "공급처와 무관"을 붙이는 이유: 하한은 판매가의 성질이라 두 줄이 함께
      // 미달로 나온다. 문구가 없으면 1688 줄까지 미달인 것이 계산 오류처럼 읽힌다.
      why: `판매가 ${coupangP25.toLocaleString()}원 · ${MIN_SELL_PRICE_KRW.toLocaleString()}원 하한 미만 (공급처와 무관)`,
      marginKrw: null,
      marginRatePct: null,
    };
  }

  const margin = marginOf(coupangP25, cost.effectiveCostKrw, size);
  const marginRatePct = Math.round((margin / coupangP25) * 1000) / 10;

  if (coupangP25 >= cost.breakEvenPriceKrw) {
    return {
      verdict: 'pass',
      why: `개당 ${margin.toLocaleString()}원 · ${marginRatePct}%`,
      marginKrw: margin,
      marginRatePct,
    };
  }

  return {
    verdict: 'fail',
    why: `손익분기 ${(cost.breakEvenPriceKrw - coupangP25).toLocaleString()}원 부족`,
    marginKrw: margin,
    marginRatePct,
  };
}

/**
 * 두 공급처 중 좋은 쪽.
 *
 * 실효원가가 낮은 쪽이 무조건 이긴다. 물류비는 사이즈로 정해지고 같은
 * 상품이라 양쪽이 같으므로, 손익분기도 마진도 실효원가에 단조다.
 * 즉 "원가가 싼 쪽"과 "판정이 좋은 쪽"이 항상 일치한다.
 *
 * 동률이면 도매꾹을 고른다 — 리드타임이 2~3일이고 통관 위험이 없다.
 */
export function pickBestSupplier(
  dome: SupplierCost,
  cn1688: SupplierCost | null,
): SupplierCost {
  if (!cn1688) return dome;
  return cn1688.effectiveCostKrw < dome.effectiveCostKrw ? cn1688 : dome;
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
npx vitest run src/__tests__/lib/sourcing/supplier-verdict.test.ts
npx tsc --noEmit
git add src/lib/sourcing/supplier-verdict.ts src/__tests__/lib/sourcing/supplier-verdict.test.ts
git commit -m "feat(sourcing): 공급처 판정 공유 모듈

판정 규칙이 shortlist-verify.ts(저장용)와 SupplierCompare.tsx(화면용)에
두 벌 있었다. 상단 표까지 세 번째 사본을 만들면 셋이 어긋난다.

좋은 쪽 선택은 실효원가 비교 하나로 끝난다. 물류비가 사이즈로 정해지고
같은 상품이라 양쪽이 같으므로 손익분기도 마진도 실효원가에 단조다.
동률이면 도매꾹 — 리드타임이 짧고 통관 위험이 없다."
```

---

## Task 4: 상단 표를 좋은 쪽 기준으로

**Files:**
- Modify: `src/components/sourcing/ShortlistTab.tsx`
- Modify: `src/components/sourcing/SupplierCompare.tsx`

> **이 Task는 코드 대신 요구사항을 적는다.** `ShortlistTab.tsx`의 표 렌더는
> 기존 구조에 얹는 변경이라 조각 코드를 옮겨 적으면 실제 파일과 어긋난다.
> 아래 Step들이 요구하는 것을 전부 만족시키되, 구현 형태는 그 파일의
> 기존 관례를 따른다.

### 왜 상태만 바꾸면 안 되는가

표 한 줄은 이렇다:

```
상품 | 도매가 | 배송 | 실효원가 | 쿠팡 실판가 | 손익분기 | 마진율 | 사이즈 | 상태
```

상태만 좋은 쪽으로 바꾸면 **실효원가 48,400 · 손익분기 86,542 · 마진율 −331%인데 상태만 통과**가 되어 줄이 자기모순에 빠진다. 그래서 `실효원가`·`손익분기`·`마진율`·`상태` 넷이 함께 이긴 쪽 값이어야 하고, 그러면 `도매가`·`배송`도 따라가야 한다 (48,100 + 300인데 실효원가가 2,298일 수는 없다).

- [ ] **Step 1: 헤더 일반화**

`도매가` → `매입가`. 공급처가 둘이므로 컬럼 이름이 한쪽에 묶이면 안 된다.

- [ ] **Step 2: 행 계산**

각 행에서:

1. 도매꾹 `SupplierCost`를 저장된 값(`domePrice`, `unitDeliFee`, `effectiveCost`, `breakEvenPrice`)으로 만든다
2. 1688 값이 있으면(`buyKrwTotal !== null && orderQty1688 !== null`) `calc1688UnitCost`로 `SupplierCost`를 만든다. `sourcingOrderQty`에는 그 행의 `orderQty`를 넘긴다
3. `pickBestSupplier`로 고르고 `judgeSupplier`로 판정한다
4. `매입가`·`배송`·`실효원가`·`손익분기`·`마진율`·`상태`를 이긴 쪽 값으로 렌더한다

**DB의 `verdict` 컬럼은 그대로 둔다.** 그 값은 도매꾹 재검증 이력이고, 화면이 답하는 질문("지금 이 상품을 팔 수 있나")과 다르다. 상단 표는 렌더 시점에 계산한 판정을 쓴다.

- [ ] **Step 3: 이긴 공급처 표시**

`매입가` 값 옆(또는 위)에 공급처 라벨을 둔다. 없으면 "48,100원짜리가 왜 실효원가 2,298원이지?"가 된다.

- 도매꾹이 이기면 라벨 없음 (기본값이라 조용히)
- 1688이 이기면 `1688` 배지 — 기존 접힌 행의 `🇨🇳 1688` 표시는 "데이터가 있다"는 뜻이었는데, 이제 **"1688이 이겼다"**로 의미를 바꾼다. 데이터만 있고 도매꾹이 이긴 경우는 표시하지 않는다

배송비가 추정치면 `배송` 칸에 그 사실을 드러낸다 (`~533` 또는 물음표 아이콘 + 툴팁). 사람이 넣은 값과 구분되지 않으면 사후 수정을 유도할 수 없다.

- [ ] **Step 4: `SupplierCompare`를 공유 모듈에 위임**

`judge()` 로컬 구현을 지우고 `judgeSupplier`를 쓴다. 공유하는 것은 **판정 규칙**이지 표현이 아니므로, 색 관례는 컴포넌트에 남기고 `Verdict`를 패널의 `Tone`으로 매핑한다:

```typescript
// 판정(Verdict)은 공유하고 색(Tone)은 패널 고유다.
// 미달에 경고색을 쓰지 않는 이유는 기존 주석 그대로 — 후보 대부분이 미달이라
// 흔한 정상 결과에 경고색을 쓰면 진짜 봐야 할 것이 묻힌다.
const TONE_OF: Record<Verdict, Tone> = {
  pass: 'pass',
  fail: 'miss',
  unknown: 'hold',
  dead: 'hold',
};
```

`judgeSupplier`가 돌려주는 `why`를 그대로 쓰고, 라벨은 `pass`→`통과` / `fail`→`미달` / 나머지→`판정 불가`로 둔다.

`calc1688UnitCost` 호출에 `sourcingOrderQty: item.orderQty`를 넘긴다. 이제 배송비가 자동으로 추정되므로 기존 "배송비 미반영" 경고는 **추정조차 못 한 경우에만** 뜬다.

- [ ] **Step 5: 검증**

```bash
npx tsc --noEmit
npm run build
npx vitest run 2>&1 | tail -20
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/ShortlistTab.tsx src/components/sourcing/SupplierCompare.tsx
git commit -m "feat(sourcing): 상단 표 판정을 두 공급처 중 좋은 쪽으로

실판가 12,000원 항목이 표에는 미달·마진율 -331%로 뜨는데 펼치면 1688은
53.1% 마진 통과였다. 소싱리스트를 훑을 때 빨간 미달만 보고 넘기면
1688로 팔 수 있는 상품을 놓친다 — 이 기능이 막으려던 바로 그 일이다.

상태만 바꾸면 줄이 자기모순에 빠지므로 매입가·배송·실효원가·손익분기·
마진율까지 이긴 쪽 값으로 맞췄다. 도매가 헤더는 매입가로 일반화했다.

DB의 verdict 컬럼은 그대로 둔다 — 그건 도매꾹 재검증 이력이고, 화면이
답하는 질문과 다르다."
```

---

## Task 5: 동작 확인

- [ ] **Step 1: 마이그레이션 적용** (소유자)

```bash
node scripts/migrate-sourcing.mjs 099
```

- [ ] **Step 2: 화면 확인**

| 확인 | 기대 |
|---|---|
| 사입 수량 | 기본 30 |
| 1688 미입력 행 | 도매꾹 기준 그대로, 배지 없음 |
| 1688 입력 + 1688이 쌈 | 매입가·배송·실효원가·손익분기·마진율이 1688 값, `1688` 배지 |
| 1688 입력 + 도매꾹이 쌈 | 도매꾹 값, 배지 없음 |
| 국제배송비 미입력 | 추정값이 들어가고 추정 표시가 보임 |
| 국제배송비 직접 입력 | 그 값이 이기고 추정 표시가 사라짐 |
| 실판가 9,900원 | 두 줄 다 하한 미달, `(공급처와 무관)` |

---

## Open Questions

- `ASSUMED_UNIT_WEIGHT_KG`는 실측이 아니라 가정이다. 첫 실제 발주의 송장 무게로 교정해야 한다.
- 해운에도 부피무게가 적용되는지 확인하지 못했다. `VOLUMETRIC_DIVISOR = 6000`은 주석에 "항공 기준으로 안내"라고 되어 있다. 부피가 큰 경량 상품은 추정이 낮게 나올 수 있다.
- `DEFAULT_EXCHANGE_RATE_KRW_PER_RMB = 195`(`margin-1688.ts`)는 실측 환율 221 대비 11.8% 낮다. 이번 붙여넣기 경로는 실제 환율을 쓰므로 영향이 없지만 다른 경로는 여전히 195로 계산한다.

## Changelog
- 2026-08-01 · 최초 작성
