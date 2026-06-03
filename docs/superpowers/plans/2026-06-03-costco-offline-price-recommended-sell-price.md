# 코스트코 오프라인가 기반 추천 판매가 제안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코스트코모바일 상품코드 검색 카드 Step 2에서 오프라인 매장가 입력 시 마진 20% 기준 추천 판매가(네이버·쿠팡)를 즉시 계산해 표시한다.

**Architecture:** `calcCostcoPrice()`에 선택적 `targetRate` 파라미터를 추가해 20% 고정 마진을 지원하고, `MobileCodeSearchCard` Step 2 하단에 네이버·쿠팡 채널별 추천가 블록을 조건부 렌더링한다. API 호출 없는 순수 클라이언트 계산이다.

**Tech Stack:** TypeScript, React, Vitest, costco-pricing.ts (calcCostcoPrice)

---

## 변경 파일

| 파일 | 역할 |
|---|---|
| `src/lib/sourcing/costco-pricing.ts` | `CostcoPriceInput.targetRate` 추가, `calcCostcoPrice()` 내부 우선순위 조정 |
| `src/lib/sourcing/__tests__/costco-pricing.test.ts` | `targetRate` 동작 검증 테스트 추가 |
| `src/components/sourcing/mobile/MobileCodeSearchCard.tsx` | Step 2 하단에 추천 판매가 블록 추가 |

---

## Task 1: `calcCostcoPrice()` — targetRate 파라미터 추가

**Files:**
- Modify: `src/lib/sourcing/costco-pricing.ts`
- Test: `src/lib/sourcing/__tests__/costco-pricing.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/costco-pricing.test.ts` 파일 하단에 다음 `describe` 블록을 추가한다.

```ts
describe('calcCostcoPrice — targetRate override', () => {
  it('targetRate: 0.2 전달 시 realMarginRate ≈ 20% (±2%p 허용)', () => {
    const r = calcCostcoPrice({
      buyPrice: 20000,
      packQty: 1,
      categoryName: '식품',   // 기본 카테고리 마진율 13%
      channel: 'naver',
      targetRate: 0.2,         // override
    });
    // 목표 마진 20% → realMarginRate 는 추천가 역산 후 실제 계산이므로 근사
    expect(r.realMarginRate).toBeGreaterThanOrEqual(18);
    expect(r.realMarginRate).toBeLessThanOrEqual(22);
  });

  it('targetRate: 0.2 는 카테고리 기본값(13%)보다 높은 추천가를 만든다', () => {
    const base = { buyPrice: 20000, packQty: 1, categoryName: '식품', channel: 'naver' as const };
    const withOverride    = calcCostcoPrice({ ...base, targetRate: 0.2 });
    const withoutOverride = calcCostcoPrice({ ...base });
    expect(withOverride.recommendedPrice).toBeGreaterThan(withoutOverride.recommendedPrice);
  });

  it('targetRate 미전달 시 기존 동작 유지 (하위 호환)', () => {
    const r1 = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '생활용품', channel: 'naver' });
    const r2 = calcCostcoPrice({ buyPrice: 20000, packQty: 1, categoryName: '생활용품', channel: 'naver', targetRate: undefined });
    expect(r1.recommendedPrice).toBe(r2.recommendedPrice);
    expect(r1.netProfit).toBe(r2.netProfit);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/lib/sourcing/__tests__/costco-pricing.test.ts
```

`targetRate` 관련 테스트 3개가 FAIL해야 한다. 나머지 기존 테스트는 PASS 유지.

- [ ] **Step 3: `CostcoPriceInput` 인터페이스에 `targetRate` 추가**

`src/lib/sourcing/costco-pricing.ts` 의 `CostcoPriceInput` 인터페이스를 다음과 같이 수정한다.

```ts
export interface CostcoPriceInput {
  /** 코스트코 매입가 (VAT 포함 구매가) */
  buyPrice: number;
  /** 입수 단위 (쉐이빙폼 6개입 → 6, 단품이면 1) */
  packQty: number;
  /** 카테고리명 (목표 마진율 결정) */
  categoryName: string | null;
  /** 판매 채널 */
  channel: Channel;
  /** 무게(kg) — null이면 3,500원 기본 배송비 */
  weightKg?: number | null;
  /** 포장비 — null이면 500원 기본값 */
  packingCost?: number | null;
  /** 시장 최저가 (null이면 vsMarket 계산 불가) */
  marketPrice?: number | null;
  /** 목표 마진율 override (0~1). 미전달 시 카테고리 기본값 적용 */
  targetRate?: number;
}
```

- [ ] **Step 4: `calcCostcoPrice()` 내부 targetRate 우선순위 조정**

`src/lib/sourcing/costco-pricing.ts`의 `calcCostcoPrice()` 함수에서 아래 한 줄을 수정한다.

```ts
// Before (기존 코드 — 정확한 위치)
const targetRate   = CATEGORY_TARGET_RATES[categoryName ?? ''] ?? COSTCO_TARGET_MARGIN_RATE;

// After
const targetRate =
  input.targetRate ??
  CATEGORY_TARGET_RATES[categoryName ?? ''] ??
  COSTCO_TARGET_MARGIN_RATE;
```

- [ ] **Step 5: 테스트 실행 → 전체 PASS 확인**

```bash
npx vitest run src/lib/sourcing/__tests__/costco-pricing.test.ts
```

기존 테스트 포함 모든 케이스가 PASS해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing/costco-pricing.ts src/lib/sourcing/__tests__/costco-pricing.test.ts
git commit -m "feat: calcCostcoPrice에 targetRate override 파라미터 추가"
```

---

## Task 2: MobileCodeSearchCard — Step 2 추천 판매가 블록 추가

**Files:**
- Modify: `src/components/sourcing/mobile/MobileCodeSearchCard.tsx`

- [ ] **Step 1: weightKg 파생 로직 및 추천가 계산값 추가**

`MobileCodeSearchCard.tsx`에서 `offlinePriceNum` / `isValidPrice` 선언 바로 아래(약 147~148번째 줄)에 다음을 추가한다.

```ts
// 오프라인가 기반 weightKg 파생 (LookupResult 필드 기준)
const offlineWeightKg =
  product?.unitType === 'weight' &&
  product.totalQuantity !== null &&
  product.totalQuantity > 0
    ? product.totalQuantity / 1000
    : null;

// 마진 20% 추천 판매가 계산 (네이버·쿠팡) — isValidPrice일 때만 의미 있음
import { calcCostcoPrice, PACKING_COST } from '@/lib/sourcing/costco-pricing';

const naverRec = isValidPrice
  ? calcCostcoPrice({
      buyPrice: offlinePriceNum,
      packQty: 1,
      categoryName: product?.categoryName ?? null,
      channel: 'naver',
      weightKg: offlineWeightKg,
      targetRate: 0.2,
    })
  : null;

const coupangRec = isValidPrice
  ? calcCostcoPrice({
      buyPrice: offlinePriceNum,
      packQty: 1,
      categoryName: product?.categoryName ?? null,
      channel: 'coupang',
      weightKg: offlineWeightKg,
      targetRate: 0.2,
    })
  : null;
```

> **주의:** `import` 문은 파일 최상단의 기존 import 블록에 추가해야 한다. 인라인에 import를 쓰면 안 됨. 파일 상단에 이미 `calcRecommendedPrice` 등을 import하고 있으므로, 해당 import 문을 다음과 같이 확장한다.

```ts
// Before (기존 import)
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';
import type { NaverCompareResponse } from '@/app/api/sourcing/costco/naver-compare/route';

// After (추가)
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';
import type { NaverCompareResponse } from '@/app/api/sourcing/costco/naver-compare/route';
import { calcCostcoPrice, PACKING_COST } from '@/lib/sourcing/costco-pricing';
```

그리고 컴포넌트 본문에 아래 계산 블록을 추가한다(State 선언 이후, return 문 이전):

```ts
// 오프라인가 기반 weightKg 파생 (LookupResult 필드 기준)
const offlineWeightKg =
  product?.unitType === 'weight' &&
  product.totalQuantity !== null &&
  product.totalQuantity > 0
    ? product.totalQuantity / 1000
    : null;

const naverRec = isValidPrice && product
  ? calcCostcoPrice({
      buyPrice: offlinePriceNum,
      packQty: 1,
      categoryName: product.categoryName ?? null,
      channel: 'naver',
      weightKg: offlineWeightKg,
      targetRate: 0.2,
    })
  : null;

const coupangRec = isValidPrice && product
  ? calcCostcoPrice({
      buyPrice: offlinePriceNum,
      packQty: 1,
      categoryName: product.categoryName ?? null,
      channel: 'coupang',
      weightKg: offlineWeightKg,
      targetRate: 0.2,
    })
  : null;
```

- [ ] **Step 2: Step 2 UI 블록에 추천 판매가 섹션 추가**

Step 2 영역 끝(약 293번째 줄, `</div>` 닫히는 부분) 바로 위에 다음 JSX를 추가한다. 추가 위치는 `온라인과 다른 실제 매장 가격을 입력하세요` 안내 문구 아래이다.

```tsx
{/* 추천 판매가 블록 — isValidPrice일 때만 표시 */}
{naverRec && coupangRec && (
  <div style={{
    marginTop: 10,
    background: '#f0fdf4',
    borderRadius: 8,
    padding: '10px 12px',
    border: '1px solid #bbf7d0',
  }}>
    {/* 블록 제목 */}
    <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginBottom: 8, letterSpacing: '0.3px' }}>
      추천 판매가 (마진 20%)
    </div>

    {/* 네이버·쿠팡 2열 */}
    <div style={{ display: 'flex', gap: 8 }}>
      {/* 네이버 */}
      <div style={{
        flex: 1, background: '#fff', borderRadius: 6, padding: '8px 10px',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 10, color: '#03c75a', fontWeight: 700, marginBottom: 4 }}>네이버 쇼핑</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1c1c' }}>
          {naverRec.recommendedPrice.toLocaleString('ko-KR')}원
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          마진율 <span style={{ color: '#16a34a', fontWeight: 700 }}>{naverRec.realMarginRate.toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          순이익 <span style={{ color: '#1a1c1c', fontWeight: 600 }}>{naverRec.netProfit.toLocaleString('ko-KR')}원</span>
        </div>
      </div>

      {/* 쿠팡 */}
      <div style={{
        flex: 1, background: '#fff', borderRadius: 6, padding: '8px 10px',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 10, color: '#e52222', fontWeight: 700, marginBottom: 4 }}>쿠팡</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1c1c' }}>
          {coupangRec.recommendedPrice.toLocaleString('ko-KR')}원
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          마진율 <span style={{ color: '#16a34a', fontWeight: 700 }}>{coupangRec.realMarginRate.toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          순이익 <span style={{ color: '#1a1c1c', fontWeight: 600 }}>{coupangRec.netProfit.toLocaleString('ko-KR')}원</span>
        </div>
      </div>
    </div>

    {/* 배송비·포장비 안내 */}
    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8 }}>
      배송비 {naverRec.shippingCost.toLocaleString('ko-KR')}원 + 포장비 {PACKING_COST.toLocaleString('ko-KR')}원 포함
    </div>
  </div>
)}
```

- [ ] **Step 3: 타입 체크**

```bash
npx tsc --noEmit
```

오류 없이 통과해야 한다.

- [ ] **Step 4: 전체 테스트 실행**

```bash
npx vitest run
```

기존 테스트 전체 PASS 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/components/sourcing/mobile/MobileCodeSearchCard.tsx
git commit -m "feat: MobileCodeSearchCard Step 2에 마진 20% 추천 판매가 블록 추가"
```

---

## 동작 검증 체크리스트

구현 완료 후 `/m/costco` 페이지에서 수동으로 확인한다.

- [ ] 6~7자리 상품코드 입력 → `MobileCodeSearchCard` 표시
- [ ] 오프라인 가격 입력 전 → 추천 판매가 블록 미표시
- [ ] 오프라인 가격 입력(예: `29900`) → 네이버·쿠팡 추천가·마진율·순이익 즉시 표시
- [ ] 배송비·포장비 안내 문구 표시 확인
- [ ] 비교하기 버튼 클릭 → Step 3으로 정상 전환, 추천 판매가 블록 자연스럽게 사라짐
- [ ] 가격 수정 버튼 클릭 → Step 1로 돌아간 뒤 새 가격 입력 시 추천가 재계산
