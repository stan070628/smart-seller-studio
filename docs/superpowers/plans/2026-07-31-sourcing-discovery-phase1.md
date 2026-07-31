# 소싱 발굴 파이프라인 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 쌓이는 트렌드 시드를 화면에서 골라 실행하면 도매꾹 후보가 쿠팡 시세 기준으로 판정되어 소싱리스트에 자동으로 쌓이게 한다.

**Architecture:** 원가 계산 정확도를 먼저 고친 뒤(수수료 VAT·관세 과세운임·품목별 관세율), 텔레그램 전용이던 `keyword-pipeline`을 웹에서 실행 가능하게 라우트를 열고, 시세 기준을 네이버 최저가에서 쿠팡 p25로 교체한 다음, 판정 통과분을 `shortlist`에 적재한다. UI는 기존 `SourcingAgentTab`(봇결과)을 발굴 탭으로 개편한다.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Postgres(`getSourcingPool`), 도매꾹 API, 네이버 쇼핑 API

**Spec:** `docs/superpowers/specs/2026-07-31-sourcing-discovery-pipeline-design.md`

---

## File Structure

**신규 파일**

| 경로 | 책임 |
|---|---|
| `src/lib/sourcing/intl-shipping.ts` | 해운 요율표 룩업, 부피무게, 발주 실비 배분 |
| `src/lib/sourcing/tariff.ts` | 카테고리 → 관세율, 과세가격 → 관세·부가세 |
| `src/app/api/sourcing/agent/run/route.ts` | 웹에서 키워드 파이프라인 실행 |
| `src/app/api/sourcing/seeds/route.ts` | `trend_seeds` 목록 조회 |
| `src/components/sourcing/DiscoveryTab.tsx` | 발굴 탭 (시드 목록 + 실행 + 결과) |

**수정 파일**

| 경로 | 변경 |
|---|---|
| `src/lib/sourcing/coupang-price.ts` | `COMMISSION_RATE`를 `effectiveFeeRate()` 경유로, `LOGISTICS_FEE`를 `resolveRgShippingFee()` 경유로 |
| `src/lib/sourcing/margin-1688.ts` | 과세가격에 운임 포함, 결과에 `dutiableValueKrw` 추가 |
| `src/lib/sourcing/trend-discovery.ts` | 프롬프트를 함수화하고 규제·단가·SKU·시즌 조건 주입 |
| `src/lib/sourcing-agent/keyword-pipeline.ts` | 시세 기준을 쿠팡 p25로 교체, `shortlist` 자동 적재, 1688 매칭 제거 |
| `src/components/sourcing/SourcingDashboard.tsx` | 탭 라벨·구성 변경 |

**테스트 파일**

| 경로 | 대상 |
|---|---|
| `src/__tests__/lib/sourcing/intl-shipping.test.ts` | 요율 룩업·부피무게·배분 |
| `src/__tests__/lib/sourcing/tariff.test.ts` | 관세율 매핑·관세 계산 |
| `src/__tests__/lib/sourcing/coupang-price.test.ts` | (기존 수정) VAT 반영 회귀 |
| `src/lib/sourcing/__tests__/margin-1688.test.ts` | (기존 수정) 과세운임 반영 |
| `src/__tests__/lib/trend-discovery.test.ts` | (기존 수정) 프롬프트 조건 |

---

## Task 1: 쿠팡 수수료 VAT 반영

**Files:**
- Modify: `src/lib/sourcing/coupang-price.ts:28`
- Test: `src/__tests__/lib/sourcing/coupang-price.test.ts`

기존 테스트가 `COMMISSION_RATE`를 import해 계산에 쓰므로 상수를 바꿔도 통과한다. **명시적 기대값 테스트를 추가**해야 회귀를 잡는다.

> **2026-07-31 범위 정정.** 최초 작성 시 이 Task는 `COMMISSION_RATE`만 바꾸는 것으로 적혀 있었으나, 아래 기대값(9,471원)은 `LOGISTICS_FEE.xsmall = 1898`(VAT 포함)을 전제한다. 선행 커밋 `1bc6a664`가 `resolveRgShippingFee()`를 만들면서 `coupang-price.ts` 배선을 빠뜨려 실제 값은 1725(VAT 별도)였다. 따라서 이 Task는 `LOGISTICS_FEE`의 VAT 반영까지 포함한다. 또한 기존 하드코딩 기대값 5건(`7638` / `8535` / `9671` / `8891` / `3506`)은 옛 원가 모델의 값이므로 새 계산값으로 갱신한다 — Task 3 Step 4와 같은 원칙이다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/coupang-price.test.ts` 파일 맨 아래에 추가:

```typescript
describe('COMMISSION_RATE VAT 반영', () => {
  it('간이과세자 기준 실질 수수료율은 11.88%다', () => {
    expect(COMMISSION_RATE).toBeCloseTo(0.1188, 6);
  });

  it('손익분기가가 VAT 포함 수수료로 계산된다', () => {
    // 실효원가 3,600원, 극소형(물류비 1,898원 VAT포함)
    // byRate   = (3600 + 1898) / (1 - 0.1188 - 0.30) = 5498 / 0.5812 = 9459.74
    // byAmount = (3600 + 1898 * 2.5) / (1 - 0.1188)  = 8345 / 0.8812 = 9470.04
    // max(byRate, byAmount) = byAmount → Math.ceil → 9471
    //
    // 옛 모델(수수료 10.8%, 물류비 1,725원 VAT 미반영)과 비교하면 지배 조건이 뒤집힌다:
    //   byRate   = (3600 + 1725) / (1 - 0.108 - 0.30) = 5325 / 0.592 = 8994.93
    //   byAmount = (3600 + 1725 * 2.5) / (1 - 0.108)  = 7912.5 / 0.892 = 8870.52
    //   max(byRate, byAmount) = byRate → Math.ceil → 8995
    // 옛 모델은 마진율 조건(byRate)이 구속했지만, VAT를 반영하면 물류비 배수 조건(byAmount)이
    // 구속한다 — 원가 구조가 바뀌면서 어느 제약이 이기는지도 바뀐다. Math.ceil로 정수를
    // 반환하므로 값을 정확히 못 박는다(MARGIN_TO_LOGISTICS 같은 계수의 미세한 변경도 잡아낸다).
    expect(breakEvenPrice(3600, 'xsmall')).toBe(9471);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts -t 'VAT 반영'`
Expected: FAIL — `expected 0.108 to be close to 0.1188`

- [ ] **Step 3: 구현**

`src/lib/sourcing/coupang-price.ts` 상단 import에 추가:

```typescript
import { effectiveFeeRate } from '@/lib/tax';
```

`getRgShippingFee` import를 VAT 반영판으로 교체하고, `LOGISTICS_FEE`의 세 항목을 모두 경유시킨다:

```typescript
import { resolveRgShippingFee, type RgSizeType } from '@/lib/roi/rg-fees';

// resolveRgShippingFee(measuredFee, sizeType) — 이 상수는 실측 정산값을 쓰지
// 않으므로 첫 인자는 null이다.
export const LOGISTICS_FEE: Record<LogisticsSize, number> = {
  xsmall: resolveRgShippingFee(null, RG_SIZE_KEY.xsmall),
  small: resolveRgShippingFee(null, RG_SIZE_KEY.small),
  medium: resolveRgShippingFee(null, RG_SIZE_KEY.medium),
};
```

`LOGISTICS_FEE` 주석에 왜 VAT 반영판을 쓰는지 한 줄 덧붙인다 — 간이과세자는 매입세액 공제를 받지 못해 물류비 VAT가 그대로 원가가 된다.

28번째 줄을 교체:

```typescript
export const COMMISSION_RATE = effectiveFeeRate(0.108);
```

주석도 함께 갱신 — 기존 "주의: 이 값이 calculator/coupang-fees.ts 등 여러 곳에 각각 하드코딩되어 있다." 문단 아래에 한 줄 추가:

```
 * VAT 처리: 쿠팡 고지 요율은 VAT 별도다. 간이과세자는 매입세액 공제를 받지 못해
 * VAT가 그대로 비용이 되므로 effectiveFeeRate()를 거쳐 실질 부담률을 쓴다.
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/coupang-price.test.ts`
Expected: PASS (전체 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/coupang-price.ts src/__tests__/lib/sourcing/coupang-price.test.ts
git commit -m "fix(sourcing): 쿠팡 수수료에 VAT 반영 (10.8% → 11.88%)"
```

---

## Task 2: 관세 계산 모듈 신설

**Files:**
- Create: `src/lib/sourcing/tariff.ts`
- Test: `src/__tests__/lib/sourcing/tariff.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/tariff.test.ts` 신규 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { getTariffRate, calcImportTax, DEFAULT_TARIFF_RATE } from '@/lib/sourcing/tariff';

describe('getTariffRate', () => {
  it('의류는 13%다', () => {
    expect(getTariffRate('의류')).toBe(0.13);
    expect(getTariffRate('수영복')).toBe(0.13);
    expect(getTariffRate('신발류')).toBe(0.13);
  });

  it('장갑·가방·액세서리는 8%다', () => {
    expect(getTariffRate('장갑')).toBe(0.08);
    expect(getTariffRate('가방')).toBe(0.08);
    expect(getTariffRate('액세서리')).toBe(0.08);
  });

  it('부분 문자열로도 매칭된다', () => {
    expect(getTariffRate('방한 장갑')).toBe(0.08);
    expect(getTariffRate('겨울 의류 세트')).toBe(0.13);
  });

  it('모르는 카테고리는 기본값 8%다', () => {
    expect(getTariffRate('캠핑용품')).toBe(DEFAULT_TARIFF_RATE);
    expect(getTariffRate(null)).toBe(DEFAULT_TARIFF_RATE);
  });
});

describe('calcImportTax', () => {
  it('과세가격에 운임이 포함된다', () => {
    // 상품가 10,000 + 운임 322 = 과세가격 10,322
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10322);
  });

  it('장갑 8% — 관세 826원, 부가세 1,115원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.tariffKrw).toBe(826);
    expect(r.importVatKrw).toBe(1115);
    expect(r.totalKrw).toBe(12263);
  });

  it('의류 13% — 관세 1,342원, 부가세 1,166원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.13 });
    expect(r.tariffKrw).toBe(1342);
    expect(r.importVatKrw).toBe(1166);
    expect(r.totalKrw).toBe(12830);
  });

  it('운임이 0이면 상품가만 과세된다', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 0, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10000);
    expect(r.tariffKrw).toBe(800);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/tariff.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sourcing/tariff'`

- [ ] **Step 3: 구현**

`src/lib/sourcing/tariff.ts` 신규 생성:

```typescript
/**
 * 수입 관세·부가세 계산.
 *
 * 근거: 더싼배대지 통관 안내 (2026-07-31 확인)
 *   과세가격 = 상품 총 결제금액 × 관세청 고시환율 + 과세운임
 *   관세     = 과세가격 × 품목별 관세율
 *   부가세   = (과세가격 + 관세) × 0.1
 *
 * 주의 1: 과세가격에 **운임이 포함된다.** 상품가만 쓰면 관세·부가세가 과소 계상된다.
 * 주의 2: 관세사 수임료는 과세운임이 아니다. 과세가격에 넣으면 세금이 이중으로 붙는다.
 * 주의 3: 간이과세자는 수입 부가세를 매입세액으로 공제받지 못하므로 그대로 원가가 된다.
 */

/** 관세율표에 없는 품목의 기본 세율 */
export const DEFAULT_TARIFF_RATE = 0.08;

/** 수입 부가세율 */
export const IMPORT_VAT_RATE = 0.1;

/**
 * 품목 키워드 → 관세율.
 * 앞에서부터 순서대로 부분 문자열 매칭하므로, 더 구체적인 항목을 위에 둔다.
 */
const TARIFF_TABLE: ReadonlyArray<{ keywords: readonly string[]; rate: number }> = [
  { keywords: ['의류', '수영복', '속옷', '신발'], rate: 0.13 },
  { keywords: ['스카프', '숄', '넥타이', '장갑'], rate: 0.08 },
  { keywords: ['가방', '핸드백'], rate: 0.08 },
  { keywords: ['액세서리', '악세서리', '선글라스'], rate: 0.08 },
  { keywords: ['화장품', '향수'], rate: 0.08 },
];

/** 카테고리명에서 관세율을 찾는다. 못 찾으면 기본값. */
export function getTariffRate(categoryName: string | null): number {
  if (!categoryName) return DEFAULT_TARIFF_RATE;
  for (const row of TARIFF_TABLE) {
    if (row.keywords.some((kw) => categoryName.includes(kw))) return row.rate;
  }
  return DEFAULT_TARIFF_RATE;
}

export interface ImportTaxInput {
  /** 상품가 (원화 환산 후) */
  goodsKrw: number;
  /** 과세운임 — 배송비 몫만. 관세사 수임료는 제외한다 */
  dutiableFreightKrw: number;
  tariffRate: number;
}

export interface ImportTaxResult {
  dutiableValueKrw: number;
  tariffKrw: number;
  importVatKrw: number;
  /** 과세가격 + 관세 + 부가세 */
  totalKrw: number;
}

export function calcImportTax(input: ImportTaxInput): ImportTaxResult {
  const dutiableValueKrw = Math.round(input.goodsKrw + input.dutiableFreightKrw);
  const tariffKrw = Math.round(dutiableValueKrw * input.tariffRate);
  const importVatKrw = Math.round((dutiableValueKrw + tariffKrw) * IMPORT_VAT_RATE);
  return {
    dutiableValueKrw,
    tariffKrw,
    importVatKrw,
    totalKrw: dutiableValueKrw + tariffKrw + importVatKrw,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/tariff.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/tariff.ts src/__tests__/lib/sourcing/tariff.test.ts
git commit -m "feat(sourcing): 품목별 관세율과 과세운임 반영 계산 모듈"
```

---

## Task 3: margin-1688에 과세운임·품목별 관세율 반영

**Files:**
- Modify: `src/lib/sourcing/margin-1688.ts:19-20, 22-32, 50-56`
- Modify: `src/components/sourcing/MarginCalc.tsx`
- Modify: `src/lib/sourcing-agent/china-matcher.ts:206`
- Test: `src/lib/sourcing/__tests__/margin-1688.test.ts`

> `shippingPerUnitKrw`를 쪼개면 **컴파일이 깨지는 호출부가 셋**이다. 값 불일치가 아니라 타입 오류라
> `npx tsc --noEmit`으로 전부 드러난다. `MarginCalc.tsx`(58·82·114행)는 Step 5에서,
> `china-matcher.ts`(206행)는 아래 Step 3 끝에서, 기존 테스트 6곳은 Step 4에서 처리한다.

> **2026-07-31 범위 정정 두 건.** Task 2 코드 리뷰에서 나온 것으로, 초안대로 진행하면 둘 다 실제로 터진다.
>
> **(1) 운임을 과세분/비과세분으로 쪼갠다.** 초안은 `dutiableFreightKrw`에 `shippingPerUnitKrw`를 통째로 넣었다.
> 그런데 `tariff.ts`가 스스로 "주의 2: 관세사 수임료는 과세운임이 아니다"라고 금지한 것을 첫 호출부가
> 어기는 꼴이다. 게다가 Task 4의 `allocateOrderCost()`는 이미 운임을 두 갈래(`perUnitKrw` = 배송비+고정비,
> `dutiableFreightPerUnitKrw` = 배송비만)로 내주므로, 어느 쪽을 넣어도 틀린다 —
> 전자는 수임료에 세금을 물리고, 후자는 비과세분이 원가에서 통째로 증발한다.
> 따라서 `Margin1688Input`의 `shippingPerUnitKrw`를 `dutiableFreightKrw` + `nonDutiableFreightKrw`로 나눈다.
>
> **(2) 세율 자동 반영은 카테고리가 아니라 품목명 기준이다.** 초안 Step 5는 카테고리 select에
> `getTariffRate`를 물렸는데, 앱의 정규 카테고리 13종 중 표가 답을 바꾸는 것은 `패션의류` 하나뿐이다.
> 세율을 가르는 품목(신발·우산·카페트)이 커머스 카테고리를 **가로지르기** 때문이다.
> 반면 상품명에는 그 단어가 그대로 들어 있다. 그래서 품목명 입력란을 두고 거기에 문다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/sourcing/__tests__/margin-1688.test.ts` 파일 맨 아래에 추가:

```typescript
describe('과세운임 반영 (2026-07-31)', () => {
  const base = {
    buyPriceRmb: 512.82,   // 10개입 박스, 개당 51.282위안
    packQty: 10,
    exchangeRate: 195,     // 개당 10,000원
    dutiableFreightKrw: 322,     // 배송비 몫 — 과세 대상
    nonDutiableFreightKrw: 0,    // 관세사 수임료 등 — 과세 대상 아님
    channel: 'coupang' as const,
    categoryName: null,
    sellPrice: 20000,
    groceryRunningCost: 0,
  };

  it('과세가격은 상품가 + 운임이다', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    expect(r.landedKrw).toBe(10000);
    expect(r.dutiableValueKrw).toBe(10322);
  });

  it('관세는 과세가격 기준으로 계산된다 (상품가 기준이 아님)', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    expect(r.tariffKrw).toBe(826);     // 10322 × 0.08, 기존 버그면 800
    expect(r.importVatKrw).toBe(1115); // (10322+826) × 0.1, 기존 버그면 1080
  });

  it('매입원가에 운임이 이중 계상되지 않는다', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    // 과세가격 10,322 + 관세 826 + 부가세 1,115 = 12,263
    expect(r.purchaseCostKrw).toBe(12263);
  });

  it('의류 13%가 장갑 8%보다 비싸다', () => {
    const glove = calc1688Margin({ ...base, tariffRate: 0.08 });
    const cloth = calc1688Margin({ ...base, tariffRate: 0.13 });
    expect(cloth.purchaseCostKrw).toBe(12830);
    expect(cloth.purchaseCostKrw - glove.purchaseCostKrw).toBe(567);
  });

  it('비과세 부대비는 원가에는 들어가되 과세는 되지 않는다', () => {
    // 관세사 수임료 22,000원을 10개에 배분 → 개당 2,200원
    const r = calc1688Margin({ ...base, tariffRate: 0.08, nonDutiableFreightKrw: 2200 });

    // 과세 쪽은 부대비가 0일 때와 완전히 동일해야 한다
    expect(r.dutiableValueKrw).toBe(10322);
    expect(r.tariffKrw).toBe(826);
    expect(r.importVatKrw).toBe(1115);

    // 원가에는 더해진다 — 12,263 + 2,200
    expect(r.purchaseCostKrw).toBe(14463);
  });
});
```

> 마지막 테스트가 이 Task의 핵심이다. 부대비를 과세가격에 넣으면 `tariffKrw`가 826이 아니라 1,002가 되고,
> 원가에서 빼먹으면 `purchaseCostKrw`가 12,263에 머문다. 두 오류를 동시에 잡는다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/margin-1688.test.ts -t '과세운임'`
Expected: FAIL — `Property 'dutiableValueKrw' does not exist` 또는 `expected 800 to be 826`

- [ ] **Step 3: 구현**

`src/lib/sourcing/margin-1688.ts` 수정 — import에 추가:

```typescript
import { calcImportTax, IMPORT_VAT_RATE } from './tariff';
```

기존 `export const IMPORT_VAT_RATE = 0.1;` **와 `export const DEFAULT_TARIFF_RATE = 0.08;` 두 줄을 모두** 삭제하고 re-export로 교체한다:

```typescript
import { calcImportTax, IMPORT_VAT_RATE, DEFAULT_TARIFF_RATE } from './tariff';
export { IMPORT_VAT_RATE, DEFAULT_TARIFF_RATE };
```

> `DEFAULT_TARIFF_RATE`도 `tariff.ts`와 중복이다. 초안은 `IMPORT_VAT_RATE`만 통합하고 이걸 남겨 절반만
> 정리하는 상태가 됐다. 소비자(`MarginCalc.tsx`, `china-matcher.ts`)는 계속 `margin-1688`에서 가져오므로
> re-export만 하면 호출부는 손댈 필요가 없다.

`Margin1688Input`의 `shippingPerUnitKrw`를 두 필드로 교체:

```typescript
  /** 과세운임 — 배송비 몫만. 관세 과표에 들어간다 */
  dutiableFreightKrw: number;
  /** 비과세 부대비 — 관세사 수임료 등. 원가에는 들어가되 과세되지 않는다 */
  nonDutiableFreightKrw: number;
```

`Margin1688Result` 인터페이스에 필드 추가 (`landedKrw` 바로 아래):

```typescript
  /** 과세가격 = 상품가 + 과세운임. 관세·부가세의 과표다 */
  dutiableValueKrw: number;
```

`calc1688Margin` 본문의 계산부를 교체:

```typescript
export function calc1688Margin(input: Margin1688Input): Margin1688Result {
  const perUnitRmb = input.buyPriceRmb / Math.max(input.packQty, 1);
  const landedKrw = perUnitRmb * input.exchangeRate;

  // 과세가격에 운임이 포함된다. 상품가만 쓰면 관세·부가세가 과소 계상된다.
  // 단 배송비 몫만 넣는다 — 관세사 수임료를 과세가격에 넣으면 세금이 이중으로 붙는다.
  const tax = calcImportTax({
    goodsKrw: landedKrw,
    dutiableFreightKrw: input.dutiableFreightKrw,
    tariffRate: input.tariffRate,
  });

  // 과세운임은 이미 dutyPaidValueKrw에 들어갔으므로 다시 더하지 않는다.
  // 비과세 부대비는 과세는 안 됐지만 실제로 지불한 돈이므로 여기서 더한다.
  const purchaseCostKrw = tax.dutyPaidValueKrw + input.nonDutiableFreightKrw;
  const totalCostKrw = purchaseCostKrw + input.groceryRunningCost;

  const channelFeeRate = getCategoryFeeRate(input.categoryName, input.channel) ?? CHANNEL_FEE[input.channel];
  const channelFeeKrw = input.sellPrice * channelFeeRate;
  const sellVatKrw = input.sellPrice * VAT_RATE;

  const netProfit = input.sellPrice - sellVatKrw - channelFeeKrw - totalCostKrw;
  const marginRate = input.sellPrice > 0 ? netProfit / input.sellPrice : 0;

  return {
    perUnitRmb: round2(perUnitRmb),
    landedKrw: round0(landedKrw),
    dutiableValueKrw: tax.dutiableValueKrw,
    tariffKrw: tax.tariffKrw,
    importVatKrw: tax.importVatKrw,
    purchaseCostKrw: round0(purchaseCostKrw),
    totalCostKrw: round0(totalCostKrw),
    channelFeeKrw: round0(channelFeeKrw),
    sellVatKrw: round0(sellVatKrw),
    netProfit: round0(netProfit),
    marginRate,
    marginRatePct: Math.round(marginRate * 1000) / 10,
    isViable: netProfit > 0,
    channelFeeRate,
  };
}
```

> 기존 return 문의 나머지 필드(`sellVatKrw` 이후)는 현재 코드와 동일하게 유지한다. 위 코드는 전체 함수를 대체한다.
>
> **2026-07-31 정정.** 초안의 이 블록은 `marginRatePct: round2(marginRate * 100)`과
> `isViable: marginRate >= 0.3`으로 적혀 있어 바로 위 산문("현재 코드와 동일하게 유지")과 충돌했다.
> 실제 코드는 `Math.round(marginRate * 1000) / 10`과 `netProfit > 0`이고, 자매 모듈
> `costco-margin.ts:48-49`도 같은 패턴이다. 이 Task의 목표는 과세운임·관세율이지 수익성 임계값이
> 아니므로 **기존 동작을 유지**하도록 블록을 실제 코드에 맞췄다.
>
> 다만 `isViable`(이익 > 0)과 `coupang-price.ts`의 `TARGET_MARGIN_RATE`(30%)가 서로 다른 기준을
> 쓰는 것은 사실이다. 별건으로 다룬다 — 아래 "이 계획에서 제외한 것" 참조.

이어서 `src/lib/sourcing-agent/china-matcher.ts:206`을 고친다. 자동 매칭 경로는 관세사 수임료를 따로
알지 못하므로 기존 상수를 전부 과세운임으로 본다 — 현재 동작을 그대로 보존하는 매핑이다:

```typescript
    dutiableFreightKrw: DEFAULT_SHIPPING_PER_UNIT_KRW,
    nonDutiableFreightKrw: 0,
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/margin-1688.test.ts`
Expected: PASS

기존 테스트가 두 가지 이유로 깨진다. 성격이 다르니 구분해서 처리한다.

1. **컴파일 오류** — `shippingPerUnitKrw`를 쓰는 6곳(27·45·61·77·98행 근처). 전부
   `dutiableFreightKrw`로 바꾸고 `nonDutiableFreightKrw: 0`을 추가한다. 기존 테스트는 전부
   관세사 수임료가 없는 시나리오이므로 0이 맞고, 이 치환은 **값을 바꾸지 않는다.**
2. **값 불일치** — 옛 계산은 관세를 상품가에만 물렸다. 새 계산이 맞으므로 **기대값을 갱신**하고
   주석으로 `// 2026-07-31 과세운임 반영` 표시를 남긴다.

1번을 2번으로 착각해 기대값을 건드리면 안 된다. 1번은 값이 그대로여야 정상이다.

- [ ] **Step 5: MarginCalc 배선**

`src/components/sourcing/MarginCalc.tsx`를 두 가지 고친다.

**(a) 운임 입력을 둘로 나눈다.** 기존 `NumField label="개당 국제배송 (원)"`이 `form.shippingPerUnitKrw`에 물려 있다. 이것을 두 칸으로 바꾼다:

```tsx
<NumField label="개당 과세운임 (원)" value={form.dutiableFreightKrw}
          onChange={(v) => update('dutiableFreightKrw', v)} step={100}
          hint="배송비 몫. 관세 과표에 포함된다" />
<NumField label="개당 통관 부대비 (원)" value={form.nonDutiableFreightKrw}
          onChange={(v) => update('nonDutiableFreightKrw', v)} step={100}
          hint="관세사 수임료 등. 원가에는 들어가되 과세되지 않는다" />
```

`INITIAL`의 `shippingPerUnitKrw: 1000`도 `dutiableFreightKrw: 1000, nonDutiableFreightKrw: 0`으로 교체한다.

**(b) 품목명으로 관세율을 채운다.** 카테고리가 아니라 품목명이다 — 세율을 가르는 품목(신발·우산·카페트)이 커머스 카테고리를 가로지르기 때문이다.

import 추가:

```typescript
import { getTariffRate } from '@/lib/sourcing/tariff';
```

`FormState`에 `itemName: string` 추가(`INITIAL`은 빈 문자열). `update` 함수 아래에 핸들러 추가:

```typescript
  /**
   * 품목명을 바꾸면 관세율을 표 기준으로 맞춰준다.
   * 카테고리가 아니라 품목명에 무는 이유: 세율이 갈리는 품목(신발 13%, 우산 13%,
   * 카페트 10%)이 커머스 카테고리를 가로질러서, 카테고리로는 판별되지 않는다.
   * 표에 없으면 기본값 8%가 들어오고, 사용자가 관세율 칸을 직접 고치면 그대로 남는다.
   */
  function updateItemName(v: string) {
    setForm((f) => ({ ...f, itemName: v, tariffRate: getTariffRate(v) }));
  }
```

품목명 텍스트 입력을 관세율 칸 **위에** 둔다 — 값이 흘러가는 방향과 화면 순서를 맞춘다:

```tsx
<TextField label="품목명" value={form.itemName} onChange={updateItemName}
           placeholder="예: 3단 자동우산, 방한 장갑"
           hint="관세율이 자동으로 채워진다. 아래에서 직접 고칠 수 있다" />
```

`TextField`가 없으면 `NumField`·`SelectField` 옆에 같은 스타일로 새로 만든다.

카테고리 SelectField는 **그대로 둔다.** 그건 채널 수수료율(`getCategoryFeeRate`)이 쓰는 값이라 관세와 무관하다.

- [ ] **Step 6: 전체 테스트**

Run: `npx vitest run`
Expected: 실패가 7개 파일 / 14건을 넘지 않는다 (완료 기준의 래칫 참조). 늘었다면 이번 변경이 범인이다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sourcing/margin-1688.ts src/lib/sourcing/__tests__/margin-1688.test.ts src/components/sourcing/MarginCalc.tsx
git commit -m "fix(sourcing): 관세 과세가격에 운임 포함, 품목별 관세율 자동 적용"
```

---

## Task 4: 국제배송 요율 모듈

**Files:**
- Create: `src/lib/sourcing/intl-shipping.ts`
- Test: `src/__tests__/lib/sourcing/intl-shipping.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/intl-shipping.test.ts` 신규 생성:

```typescript
import { describe, it, expect } from 'vitest';
import {
  chargeableWeightKg,
  volumetricWeightKg,
  shippingFeeKrw,
  allocateOrderCost,
  CUSTOMS_BROKER_FEE_KRW,
} from '@/lib/sourcing/intl-shipping';

describe('volumetricWeightKg', () => {
  it('가로×세로×높이 ÷ 6000이다', () => {
    expect(volumetricWeightKg({ w: 25, d: 20, h: 12 })).toBeCloseTo(1.0, 4);
    expect(volumetricWeightKg({ w: 18, d: 12, h: 6 })).toBeCloseTo(0.216, 4);
  });
});

describe('chargeableWeightKg', () => {
  it('실무게와 부피무게 중 큰 값을 쓴다', () => {
    // 모자: 실무게 0.1kg, 부피무게 1.0kg → 1.0kg
    expect(chargeableWeightKg(0.1, { w: 25, d: 20, h: 12 })).toBeCloseTo(1.0, 4);
    // 치수를 모르면 실무게
    expect(chargeableWeightKg(0.5, null)).toBe(0.5);
  });
});

describe('shippingFeeKrw', () => {
  it('요율표 값을 그대로 쓴다', () => {
    expect(shippingFeeKrw(1.0).fee).toBe(4580);
    expect(shippingFeeKrw(10.0).fee).toBe(17390);
    expect(shippingFeeKrw(15.0).fee).toBe(23190);
  });

  it('0.5kg 단위로 절상한다', () => {
    expect(shippingFeeKrw(8.3).fee).toBe(15280); // 8.5kg 구간
    expect(shippingFeeKrw(0.1).fee).toBe(4180);  // 최소 0.5kg
  });

  it('선형 근사식과 다르다 — 11kg부터 증분이 꺾인다', () => {
    // 근사식 4580 + (15-1)*1423 = 24,502원이지만 실제는 23,190원
    expect(shippingFeeKrw(15.0).fee).toBe(23190);
    expect(shippingFeeKrw(15.0).estimated).toBe(false);
  });

  it('표 범위를 넘으면 외삽하고 estimated 플래그를 세운다', () => {
    const r = shippingFeeKrw(20.0);
    expect(r.estimated).toBe(true);
    // 15.5kg 23,740에서 0.5kg당 550원 외삽 → 23,740 + 9*550 = 28,690
    expect(r.fee).toBe(28690);
  });
});

describe('allocateOrderCost', () => {
  it('과금무게 비례로 배송비와 고정비를 함께 배분한다', () => {
    const r = allocateOrderCost({
      actualShippingKrw: 15280,
      fixedCostKrw: CUSTOMS_BROKER_FEE_KRW,
      items: [
        { key: 'glove', qty: 52, unitWeightKg: 0.1 },
        { key: 'neck', qty: 20, unitWeightKg: 0.08 },
        { key: 'pouch', qty: 10, unitWeightKg: 0.15 },
      ],
    });

    expect(r.totalWeightKg).toBeCloseTo(8.3, 4);
    expect(r.totalCostKrw).toBe(37280);

    const glove = r.items.find((i) => i.key === 'glove')!;
    expect(glove.allocatedKrw).toBe(23356);
    expect(glove.perUnitKrw).toBe(449);

    // 배분 합계가 총액과 일치한다 (반올림 잔차를 최대 항목에 흡수)
    const sum = r.items.reduce((a, i) => a + i.allocatedKrw, 0);
    expect(sum).toBe(37280);
  });

  it('과세운임은 배송비 몫만이다 (고정비 제외)', () => {
    const r = allocateOrderCost({
      actualShippingKrw: 15280,
      fixedCostKrw: CUSTOMS_BROKER_FEE_KRW,
      items: [{ key: 'a', qty: 10, unitWeightKg: 1.0 }],
    });
    expect(r.items[0].dutiableFreightPerUnitKrw).toBe(1528);
    expect(r.items[0].perUnitKrw).toBe(3728);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/intl-shipping.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sourcing/intl-shipping'`

- [ ] **Step 3: 구현**

`src/lib/sourcing/intl-shipping.ts` 신규 생성:

```typescript
/**
 * 국제배송(중국 → 한국) 비용 계산.
 *
 * 요율 출처: 더싼배대지 위해 해운 (2026-07-31 확인).
 *   개인회원·사업자회원 요율이 동일하다.
 *   "배송요금은 관·부가세 수입세 및 특별처리비용이 포함되지 않은 금액"
 *
 * 선형 근사식을 쓰지 않는 이유: 증분이 1~10kg 구간에서는 660~800원이지만
 * 11kg부터 550~600원으로 꺾인다. 근사식 `4580 + (kg-1)*1423`은 15kg에서
 * 24,502원을 내는데 실제는 23,190원으로 1,312원 과대평가한다.
 */

/** 부피무게 제수. 항공 기준으로 안내되어 있다 */
export const VOLUMETRIC_DIVISOR = 6000;

/** 관세사 수임료 (사업자). 발주 건당 정액이며 과세운임이 아니다 */
export const CUSTOMS_BROKER_FEE_KRW = 22000;

/** 0.5kg 단위 요율표. 인덱스 = kg × 2 - 1 */
const RATE_TABLE_KRW: readonly number[] = [
  4180,  // 0.5
  4580,  // 1.0
  5280,  // 1.5
  5990,  // 2.0
  6680,  // 2.5
  7430,  // 3.0
  8130,  // 3.5
  8830,  // 4.0
  9490,  // 4.5
  10290, // 5.0
  10970, // 5.5
  11670, // 6.0
  12390, // 6.5
  13090, // 7.0
  13790, // 7.5
  14540, // 8.0
  15280, // 8.5
  15980, // 9.0
  16640, // 9.5
  17390, // 10.0
  18090, // 10.5
  18690, // 11.0
  19240, // 11.5
  19840, // 12.0
  20390, // 12.5
  20940, // 13.0
  21490, // 13.5
  22040, // 14.0
  22640, // 14.5
  23190, // 15.0
  23740, // 15.5
];

/** 표 범위를 넘어설 때 쓰는 0.5kg당 증분 (마지막 구간 기울기) */
const EXTRAPOLATION_STEP_KRW = 550;

export interface Dimensions {
  /** cm */
  w: number;
  d: number;
  h: number;
}

/** 부피무게(kg) */
export function volumetricWeightKg(dims: Dimensions): number {
  return (dims.w * dims.d * dims.h) / VOLUMETRIC_DIVISOR;
}

/** 과금무게 = max(실무게, 부피무게). 치수를 모르면 실무게 */
export function chargeableWeightKg(actualKg: number, dims: Dimensions | null): number {
  if (!dims) return actualKg;
  return Math.max(actualKg, volumetricWeightKg(dims));
}

export interface ShippingFee {
  fee: number;
  /** 요율표 범위를 벗어나 외삽한 값인가 */
  estimated: boolean;
  /** 실제 과금에 쓰인 절상 무게 */
  billedKg: number;
}

/** 과금무게 → 배송비. 0.5kg 단위로 절상한다 */
export function shippingFeeKrw(weightKg: number): ShippingFee {
  const steps = Math.max(1, Math.ceil(weightKg * 2));
  const billedKg = steps / 2;

  if (steps <= RATE_TABLE_KRW.length) {
    return { fee: RATE_TABLE_KRW[steps - 1], estimated: false, billedKg };
  }

  const last = RATE_TABLE_KRW[RATE_TABLE_KRW.length - 1];
  const over = steps - RATE_TABLE_KRW.length;
  return { fee: last + over * EXTRAPOLATION_STEP_KRW, estimated: true, billedKg };
}

export interface AllocationItemInput {
  key: string;
  qty: number;
  /** 개당 과금무게 */
  unitWeightKg: number;
}

export interface AllocationItemResult extends AllocationItemInput {
  totalWeightKg: number;
  /** 배송비 + 고정비 배분액 */
  allocatedKrw: number;
  perUnitKrw: number;
  /** 관세 과표에 넣을 개당 운임 — 배송비 몫만 */
  dutiableFreightPerUnitKrw: number;
}

export interface AllocationInput {
  /** 실제 청구된 배송비 */
  actualShippingKrw: number;
  /** 발주 건당 고정비 (관세사 수임료 등). 과세운임이 아니다 */
  fixedCostKrw: number;
  items: readonly AllocationItemInput[];
}

export interface AllocationResult {
  totalWeightKg: number;
  totalCostKrw: number;
  items: AllocationItemResult[];
}

/**
 * 발주 실비를 과금무게 비례로 배분한다.
 *
 * 배송비와 고정비를 모두 배분하되, 관세 과표에 쓸 운임은 배송비 몫만 따로 낸다.
 * 반올림 잔차는 가장 무거운 항목에 흡수시켜 합계가 총액과 일치하게 한다.
 */
export function allocateOrderCost(input: AllocationInput): AllocationResult {
  const rows = input.items.map((it) => ({ ...it, totalWeightKg: it.qty * it.unitWeightKg }));
  const totalWeightKg = rows.reduce((a, r) => a + r.totalWeightKg, 0);
  const totalCostKrw = input.actualShippingKrw + input.fixedCostKrw;

  if (totalWeightKg <= 0) {
    return {
      totalWeightKg: 0,
      totalCostKrw,
      items: rows.map((r) => ({
        ...r,
        allocatedKrw: 0,
        perUnitKrw: 0,
        dutiableFreightPerUnitKrw: 0,
      })),
    };
  }

  const items: AllocationItemResult[] = rows.map((r) => {
    const share = r.totalWeightKg / totalWeightKg;
    const allocatedKrw = Math.round(totalCostKrw * share);
    const shippingShare = Math.round(input.actualShippingKrw * share);
    return {
      ...r,
      allocatedKrw,
      perUnitKrw: r.qty > 0 ? Math.round(allocatedKrw / r.qty) : 0,
      dutiableFreightPerUnitKrw: r.qty > 0 ? Math.round(shippingShare / r.qty) : 0,
    };
  });

  // 반올림 잔차를 가장 무거운 항목에 흡수시킨다
  const diff = totalCostKrw - items.reduce((a, i) => a + i.allocatedKrw, 0);
  if (diff !== 0) {
    let heaviest = 0;
    for (let i = 1; i < items.length; i++) {
      if (items[i].totalWeightKg > items[heaviest].totalWeightKg) heaviest = i;
    }
    items[heaviest].allocatedKrw += diff;
    items[heaviest].perUnitKrw =
      items[heaviest].qty > 0 ? Math.round(items[heaviest].allocatedKrw / items[heaviest].qty) : 0;
  }

  return { totalWeightKg, totalCostKrw, items };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/intl-shipping.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/intl-shipping.ts src/__tests__/lib/sourcing/intl-shipping.test.ts
git commit -m "feat(sourcing): 해운 요율표·부피무게·발주 실비 배분 모듈"
```

---

## Task 5: 시드 프롬프트 교정

**Files:**
- Modify: `src/lib/sourcing/trend-discovery.ts`
- Test: `src/__tests__/lib/trend-discovery.test.ts`

시즌 조건이 오늘 날짜에 의존하므로 프롬프트를 **함수로 바꿔 날짜를 주입**받게 한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/trend-discovery.test.ts` 파일 맨 아래에 추가:

```typescript
import { buildDiscoverPrompt } from '@/lib/sourcing/trend-discovery';

describe('buildDiscoverPrompt', () => {
  const p = buildDiscoverPrompt(new Date('2026-07-31T00:00:00+09:00'));

  it('규제 차단 카테고리를 금지어로 명시한다', () => {
    for (const kw of ['전기', '충전', '아동', '장난감', '식품', '건강기능식품', '화장품', '세제']) {
      expect(p).toContain(kw);
    }
  });

  it('실제 차단 실적이 있는 예시를 금지 예시로 든다', () => {
    for (const kw of ['선풍기', '랜턴', '장난감']) {
      expect(p).toContain(kw);
    }
  });

  it('단가 하한과 우대 구간을 명시한다', () => {
    expect(p).toContain('10,000원');
    expect(p).toContain('20,000원');
  });

  it('SKU 분기 상한을 명시한다', () => {
    expect(p).toMatch(/색상.*사이즈.*3개/);
  });

  it('오늘 기준 2~4개월 뒤 시즌을 지목한다', () => {
    // 2026-07-31 → 2026-09 ~ 2026-11
    expect(p).toContain('2026년 9월');
    expect(p).toContain('2026년 11월');
  });

  it('추천 카테고리에서 주방·건강식품·뷰티를 뺀다', () => {
    expect(p).not.toContain('주방');
    expect(p).not.toContain('뷰티');
    expect(p).toContain('골프');
    expect(p).toContain('낚시');
  });

  it('JSON 응답 형식을 유지한다', () => {
    expect(p).toContain('"seeds"');
    expect(p).toContain('keyword');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/trend-discovery.test.ts -t 'buildDiscoverPrompt'`
Expected: FAIL — `buildDiscoverPrompt is not a function`

- [ ] **Step 3: 구현**

`src/lib/sourcing/trend-discovery.ts`에서 `DISCOVER_PROMPT` 상수를 삭제하고 함수로 교체:

```typescript
/** 월 이름을 "2026년 9월" 형태로 (KST 기준) */
function kstMonthLabel(base: Date, addMonths: number): string {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + addMonths, 1));
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`;
}

/**
 * 트렌드 시드 발굴 프롬프트.
 *
 * 규제 필터(lib/sourcing/legal/)에 걸리는 키워드를 애초에 만들지 않도록
 * 차단 카테고리를 역주입한다. 실제 차단 실적이 있는 품목을 금지 예시로 든다
 * (선풍기 420건 · 장난감 466건 · 식품용기 169건).
 *
 * 시즌은 1688 리드타임(해운 약 30일)과 검증 4주를 고려해 2~4개월 뒤를 노린다.
 */
export function buildDiscoverPrompt(now: Date): string {
  const from = kstMonthLabel(now, 2);
  const to = kstMonthLabel(now, 4);

  return `한국 온라인 커머스에서 지금 수요가 오르는 소비재 상품 키워드를 찾아줘.

【시즌】
지금 소싱하면 판매 시점은 ${from} ~ ${to}이다. 그 시기에 팔릴 상품을 골라라.

【반드시 제외할 것 — 수입·판매 규제로 진입이 막힌다】
- 전기·충전·배터리를 쓰는 모든 것 (예: 선풍기, 랜턴, 히터, 조명)
- 아동·유아용품, 장난감
- 식품, 건강기능식품, 영양제, 식품용기 (예: 도시락통, 에어프라이어 용기)
- 화장품, 향수, 세제, 세정제, 탈취제, 위생용품
- 브랜드·캐릭터가 붙은 것
- 부피가 큰 것 (가구, 대형가전)

【우선할 카테고리】
골프 액세서리, 낚시 용품, 등산·트레킹, 캠핑 수납·정리, 방한·보온, 차량용품, 반려동물 산책용품

【가격】
개당 예상 판매가 10,000원 이상만. 20,000원 이상이면 더 좋다.

【옵션】
색상·사이즈를 합친 옵션이 3개 이하로 팔 수 있는 상품. 의류는 프리사이즈나 밴딩처럼 사이즈 분기가 적은 것만.

【형식】
상품 키워드 10개를 아래 JSON으로만 응답:
{"seeds": [{"keyword": "키워드", "source": "youtube|instagram|threads|naver", "reason": "수요 근거 1문장"}]}`;
}
```

`discoverTrendSeeds()` 안에서 `DISCOVER_PROMPT`를 쓰던 부분을 교체:

```typescript
  const prompt = buildDiscoverPrompt(new Date());
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/trend-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/trend-discovery.ts src/__tests__/lib/trend-discovery.test.ts
git commit -m "fix(sourcing): 시드 프롬프트에 규제 필터·단가·SKU 분기·시즌 조건 주입"
```

---

## Task 6: 시드 목록 조회 API

**Files:**
- Create: `src/app/api/sourcing/seeds/route.ts`
- Test: `src/__tests__/api/sourcing-seeds.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/sourcing-seeds.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

import { GET } from '@/app/api/sourcing/seeds/route';

describe('GET /api/sourcing/seeds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('시드 목록과 마지막 수집 시각을 함께 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, keyword: '등산 모자', source: 'youtube', reason: '가을 등산 증가', seed_date: '2026-07-31', created_at: '2026-07-31T06:00:00Z' },
      ],
    });

    const res = await GET();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.seeds).toHaveLength(1);
    expect(body.data.seeds[0].keyword).toBe('등산 모자');
    expect(body.data.lastCollectedAt).toBe('2026-07-31T06:00:00Z');
  });

  it('시드가 없으면 lastCollectedAt이 null이다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET();
    const body = await res.json();

    expect(body.data.seeds).toHaveLength(0);
    expect(body.data.lastCollectedAt).toBeNull();
  });

  it('DB 오류 시 500과 메시지를 반환한다', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/sourcing-seeds.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/sourcing/seeds/route'`

- [ ] **Step 3: 구현**

`src/app/api/sourcing/seeds/route.ts` 신규 생성:

```typescript
/**
 * GET /api/sourcing/seeds
 * 트렌드 시드 목록 조회.
 *
 * 크론이 조용히 죽는 것을 막기 위해 마지막 수집 시각을 함께 반환한다.
 * (크론 4개가 405로 3개월간 실패했는데 아무도 몰랐던 전례가 있다)
 */

import { getSourcingPool } from '@/lib/sourcing/db';

const LIMIT = 30;

export async function GET() {
  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `SELECT id, keyword, source, reason, seed_date, created_at
         FROM trend_seeds
        ORDER BY created_at DESC
        LIMIT $1`,
      [LIMIT],
    );

    return Response.json({
      success: true,
      data: {
        seeds: rows,
        lastCollectedAt: rows.length > 0 ? rows[0].created_at : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/sourcing/seeds] 조회 실패:', message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/sourcing-seeds.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/seeds/route.ts src/__tests__/api/sourcing-seeds.test.ts
git commit -m "feat(sourcing): 트렌드 시드 목록 조회 API"
```

---

## Task 7: 파이프라인 시세 기준을 쿠팡 p25로 교체

**Files:**
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts`
- Test: `src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts`

현재 파이프라인은 `searchNaverLowestPrice`(네이버 최저가)로 마진을 계산한다. 실측에서 네이버 시세가 **쿠팡 실판가의 2~3배**였고, 이 오판으로 마진율 판정이 59.8% → 11.7%로 뒤집힌 사례가 있다.

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts` 신규 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateCandidate } from '@/lib/sourcing-agent/keyword-pipeline';

describe('evaluateCandidate', () => {
  it('쿠팡 p25가 손익분기가 이상이면 pass다', () => {
    // 실효원가 3,600 · 극소형 → 손익분기 9,471. p25 9,900
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 9900,
      coupangSampleN: 91,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('pass');
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471); // 2026-07-31 VAT 반영 — Task 1 참조
  });

  it('p25가 손익분기 미달이면 fail이다', () => {
    const r = evaluateCandidate({
      domePrice: 6930,
      unitDeliFee: 300,
      coupangP25: 6515,
      coupangSampleN: 40,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
  });

  it('쿠팡 표본이 3건 미만이면 unknown이다 (fail이 아니다)', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 20000,
      coupangSampleN: 2,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('p25를 못 구하면 unknown이다', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: null,
      coupangSampleN: 0,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('판매가 1만원 미만이면 fail이다 (목표 역산 기준)', () => {
    const r = evaluateCandidate({
      domePrice: 1000,
      unitDeliFee: 100,
      coupangP25: 8000,
      coupangSampleN: 50,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
    expect(r.failReason).toBe('under_min_price');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts`
Expected: FAIL — `evaluateCandidate is not exported`

- [ ] **Step 3: 구현**

`src/lib/sourcing-agent/keyword-pipeline.ts` 상단 import를 교체한다. `searchNaverLowestPrice`와 `matchOn1688`, `calcMarginRate` import를 삭제하고 추가:

```typescript
import { estimateCoupangPrice } from '@/lib/sourcing/coupang-price';
import { breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize, Verdict } from '@/types/shortlist';
```

상수 교체:

```typescript
/** 목표 역산 기준 최소 판매가 */
const MIN_SELL_PRICE_KRW = 10000;
/** 쿠팡 표본이 이보다 적으면 판정하지 않는다 */
const MIN_COUPANG_SAMPLE_N = 3;
const TOP_N = 5;
const DOMEGGOOK_PAGE_SIZE = 10;
```

판정 함수를 추가한다 (파일 상단, `runKeywordPipeline` 위):

```typescript
export interface CandidateInput {
  domePrice: number;
  /** 개당 환산 배송비 */
  unitDeliFee: number;
  coupangP25: number | null;
  coupangSampleN: number;
  logisticsSize: LogisticsSize;
}

export interface CandidateVerdict {
  effectiveCost: number;
  breakEvenPrice: number;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict;
  failReason: 'under_min_price' | 'below_breakeven' | null;
}

/**
 * 후보 하나를 판정한다.
 *
 * 시세 기준은 쿠팡 p25다. 네이버 최저가는 쿠팡 실판가의 2~3배로 나와
 * 마진율 판정을 뒤집는다(실측: 접이식 쓰레기통 15,160원 vs 5,490원).
 *
 * unknown을 fail로 뭉치지 않는다. 표본이 얇아 모르는 것과 마진이 안 나오는 것은 다르다.
 */
export function evaluateCandidate(input: CandidateInput): CandidateVerdict {
  const effectiveCost = input.domePrice + input.unitDeliFee;
  const be = breakEvenPrice(effectiveCost, input.logisticsSize);

  if (input.coupangP25 === null || input.coupangSampleN < MIN_COUPANG_SAMPLE_N) {
    return {
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
      failReason: null,
    };
  }

  if (input.coupangP25 < MIN_SELL_PRICE_KRW) {
    return {
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'fail',
      failReason: 'under_min_price',
    };
  }

  const margin = marginOf(input.coupangP25, effectiveCost, input.logisticsSize);
  const marginRate = margin / input.coupangP25;
  const pass = input.coupangP25 >= be;

  return {
    effectiveCost,
    breakEvenPrice: be,
    margin,
    marginRate,
    verdict: pass ? 'pass' : 'fail',
    failReason: pass ? null : 'below_breakeven',
  };
}
```

`runKeywordPipeline` 본문에서 네이버 조회 블록(주석 `// 3. 네이버쇼핑 소비자가 조회`부터 `}` 까지)을 삭제한다. 후보 루프를 교체:

```typescript
    // 5. 각 후보 처리 — 쿠팡 시세 추정 후 판정
    const resultRows: Array<KeywordResultInsert & { _sort: number }> = [];

    for (const item of candidates) {
      const est = await estimateCoupangPrice(item.title);
      const deli = parseUnitDeliFee(item);

      // estimateCoupangPrice는 표본이 MIN_SAMPLE(3) 미만이면 **null을 반환한다**.
      // evaluateCandidate가 p25=null을 이미 unknown으로 처리하도록 설계돼 있으므로
      // 여기서 분기하지 말고 그대로 흘려보낸다. est.p25로 직접 접근하면 터진다.
      const v = evaluateCandidate({
        domePrice: item.price,
        unitDeliFee: deli,
        coupangP25: est?.p25 ?? null,
        coupangSampleN: est?.sampleN ?? 0,
        logisticsSize: 'xsmall',
      });

      if (v.verdict === 'fail') continue;

      resultRows.push({
        rank: 0,
        naver_price: est?.p25 ?? null,
        naver_url: null,
        domeggook_product_name: item.title,
        domeggook_price: item.price,
        domeggook_url: item.url,
        domeggook_image_url: item.thumb || null,
        domeggook_margin_rate: v.marginRate !== null ? v.marginRate * 100 : null,
        china_product_name: null,
        china_price_krw: null,
        china_url: null,
        china_margin_rate: null,
        _sort: est?.p25 ?? 0,
      });

      // pass 판정의 쇼트리스트 적재는 Task 8에서 붙인다.
      // 여기서 미리 호출하면 아직 없는 함수를 참조해 컴파일이 깨진다.
    }

    // 6. 예상 판매가 내림차순 상위 5개 — 고단가 우선
    const top = resultRows
      .sort((a, b) => b._sort - a._sort)
      .slice(0, TOP_N)
      .map(({ _sort: _, ...row }, idx) => ({ ...row, rank: idx + 1 }));
```

`formatResultMessage`의 시그니처에서 `naverPrice`를 유지하되 호출부를 바꾼다:

```typescript
    const message = formatResultMessage(keyword, top[0]?.naver_price ?? 0, top);
```

배송비 파싱 헬퍼를 파일 하단에 추가:

```typescript
/** 도매꾹 목록 항목에서 개당 배송비를 뽑는다. 알 수 없으면 0 */
function parseUnitDeliFee(item: DomeggookListItem): number {
  const raw = (item as { deli?: { dome?: { fee?: string } } }).deli?.dome?.fee;
  const fee = raw ? Number(raw) : 0;
  if (!Number.isFinite(fee) || fee <= 0) return 0;
  return Math.round(fee / 10); // 10개 사입 기준 개당 환산
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing-agent/keyword-pipeline.ts src/__tests__/lib/sourcing-agent/keyword-pipeline.test.ts
git commit -m "fix(sourcing): 파이프라인 시세 기준을 네이버 최저가에서 쿠팡 p25로 교체"
```

---

## Task 8: 소싱리스트 자동 적재

**Files:**
- Modify: `src/lib/sourcing/shortlist-db.ts`
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts`
- Test: `src/__tests__/lib/sourcing/shortlist-db.test.ts`

> **2026-07-31 정정 — 이 Task의 테스트는 스키마를 검증하지 못한다.**
> 아래 테스트는 `pool.query`를 통째로 mock하므로 SQL이 실제 DB와 맞는지 **전혀 확인하지 않는다.**
> 초안에 실제로 두 가지 오류가 있었고 둘 다 이 테스트를 통과했을 것이다:
>
> | 오류 | 결과 |
> |---|---|
> | `INSERT INTO shortlist` — 실제 테이블명은 `sourcing_shortlist` | 런타임에 `relation does not exist` |
> | `margin_rate`에 비율(`0.3259`)을 넣음 — 컬럼은 `numeric(5,1)` 백분율 | **0.3으로 반올림되어 값 소실** |
>
> 둘 다 아래 코드에 반영해 두었다. 구현 시 `supabase/migrations/094_sourcing_shortlist.sql`을
> 직접 열어 컬럼명·타입·제약을 대조하라. **mock 테스트 통과를 스키마 검증으로 착각하지 마라.**

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/sourcing/shortlist-db.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertShortlistCandidate } from '@/lib/sourcing/shortlist-db';

const mockQuery = vi.fn();
const pool = { query: mockQuery } as never;

describe('upsertShortlistCandidate', () => {
  beforeEach(() => mockQuery.mockReset());

  it('신규 후보를 삽입한다', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await upsertShortlistCandidate(pool, {
      itemNo: 55788793,
      title: '메쉬 반장갑',
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 9900,
      coupangSampleN: 91,
      effectiveCost: 3600,
      breakEvenPrice: 9471,
      margin: 3226,
      marginRate: 32.6,   // 백분율 1자리 — DB가 numeric(5,1)이다
      verdict: 'pass',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe(55788793);
  });

  it('같은 item_no를 다시 넣어도 실패하지 않는다 (재검증만 갱신)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    await upsertShortlistCandidate(pool, {
      itemNo: 55788793,
      title: '메쉬 반장갑',
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 9900,
      coupangSampleN: 91,
      effectiveCost: 3600,
      breakEvenPrice: 9471,
      margin: 3226,
      marginRate: 32.6,   // 백분율 1자리 — DB가 numeric(5,1)이다
      verdict: 'pass',
    });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('DO UPDATE');
    expect(sql).not.toContain('memo = EXCLUDED.memo'); // 사용자 메모를 덮지 않는다
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-db.test.ts`
Expected: FAIL — `upsertShortlistCandidate is not exported`

- [ ] **Step 3: 구현**

`src/lib/sourcing/shortlist-db.ts` 하단에 추가:

```typescript
export interface ShortlistCandidateInput {
  itemNo: number;
  title: string;
  domePrice: number;
  unitDeliFee: number;
  coupangP25: number | null;
  coupangSampleN: number;
  effectiveCost: number;
  breakEvenPrice: number;
  margin: number | null;
  marginRate: number | null;
  verdict: string;
}

/**
 * 발굴 파이프라인이 판정한 후보를 쇼트리스트에 넣는다.
 *
 * 이미 있는 항목이면 검증 결과만 갱신한다. **사용자 메모와 아카이브 상태는 덮지 않는다** —
 * 자동 적재가 사람의 판단을 지우면 안 되기 때문이다.
 *
 * marginRate 단위 주의: DB의 margin_rate는 numeric(5,1) — **백분율 1자리**다(예: 32.6).
 * evaluateCandidate()는 비율(0.326)을 돌려주므로 호출부에서 변환해 넘긴다.
 * 비율을 그대로 넣으면 0.3으로 반올림되어 값이 소실된다.
 */
export async function upsertShortlistCandidate(
  pool: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  c: ShortlistCandidateInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO sourcing_shortlist (
       item_no, title, dome_price, unit_deli_fee,
       coupang_p25, coupang_sample_n,
       effective_cost, break_even_price, margin, margin_rate,
       verdict, verified_at, added_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), NOW())
     ON CONFLICT (item_no) DO UPDATE SET
       title             = EXCLUDED.title,
       dome_price        = EXCLUDED.dome_price,
       unit_deli_fee     = EXCLUDED.unit_deli_fee,
       coupang_p25       = EXCLUDED.coupang_p25,
       coupang_sample_n  = EXCLUDED.coupang_sample_n,
       effective_cost    = EXCLUDED.effective_cost,
       break_even_price  = EXCLUDED.break_even_price,
       margin            = EXCLUDED.margin,
       margin_rate       = EXCLUDED.margin_rate,
       verdict           = EXCLUDED.verdict,
       verified_at       = NOW()`,
    [
      c.itemNo, c.title, c.domePrice, c.unitDeliFee,
      c.coupangP25, c.coupangSampleN,
      c.effectiveCost, c.breakEvenPrice, c.margin, c.marginRate,
      c.verdict,
    ],
  );
}
```

`src/lib/sourcing-agent/keyword-pipeline.ts`에 import 추가:

```typescript
import { upsertShortlistCandidate } from '@/lib/sourcing/shortlist-db';
```

Task 7에서 주석으로 비워둔 자리(`// pass 판정의 쇼트리스트 적재는 Task 8에서 붙인다`)를 실제 호출로 교체:

```typescript
      if (v.verdict === 'pass') {
        await upsertShortlistCandidate(pool, {
          itemNo: item.no,
          title: item.title,
          domePrice: item.price,
          unitDeliFee: deli,
          // est는 null일 수 있다 (Task 7 참조). 다만 이 블록은 verdict === 'pass'일 때만
          // 도달하고, p25가 null이면 evaluateCandidate가 unknown을 내므로 실제로는
          // 항상 값이 있다. 그래도 타입을 좁혀야 컴파일된다.
          coupangP25: est?.p25 ?? null,
          coupangSampleN: est?.sampleN ?? 0,
          effectiveCost: v.effectiveCost,
          breakEvenPrice: v.breakEvenPrice,
          margin: v.margin,
          // DB의 margin_rate는 백분율 1자리다. 비율을 그대로 넣으면 0.3으로 뭉개진다.
          // 변환식은 shortlist-verify.ts:283과 동일하게 맞춘다.
          marginRate: v.marginRate !== null ? Math.round(v.marginRate * 1000) / 10 : null,
          verdict: v.verdict,
        }).catch((e) =>
          console.warn('[keyword-pipeline] 쇼트리스트 적재 실패:', item.no, e),
        );
      }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/sourcing/shortlist-db.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: 전체 테스트**

Run: `npx vitest run`
Expected: 실패가 7개 파일 / 14건을 넘지 않는다 (완료 기준의 래칫 참조). 늘었다면 이번 변경이 범인이다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing/shortlist-db.ts src/lib/sourcing-agent/keyword-pipeline.ts src/__tests__/lib/sourcing/shortlist-db.test.ts
git commit -m "feat(sourcing): pass 판정 후보를 쇼트리스트에 자동 적재"
```

---

## Task 9: 웹 실행 라우트

**Files:**
- Create: `src/app/api/sourcing/agent/run/route.ts`
- Test: `src/__tests__/api/sourcing-agent-run.test.ts`

시드를 골라서 실행하는 설계이므로 크론 진입점 없이 웹 실행용 POST만 만든다.

> **2026-07-31 전제 정정.** 초안은 "`vercel.json`에 등록된 `agent/run` 크론이 파일이 없어 매번 404였다"고
> 적었으나, 확인해 보니 **`vercel.json`에 그 항목이 이미 없다.** 등록된 크론 12개를 전수 점검한 결과
> 전부 라우트 파일이 존재하고 `GET`을 export한다 — 죽은 크론은 하나도 없다.
> 따라서 아래 Step 5는 이미 충족된 상태이며, 확인만 하고 넘어간다. **없는 항목을 찾다가
> 새로 추가했다 지우는 짓을 하지 마라.**

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/api/sourcing-agent-run.test.ts` 신규 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn();
vi.mock('@/lib/sourcing-agent/keyword-pipeline', () => ({
  runKeywordPipeline: mockRun,
}));

import { POST } from '@/app/api/sourcing/agent/run/route';

function req(body: unknown): Request {
  return new Request('http://localhost/api/sourcing/agent/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sourcing/agent/run', () => {
  beforeEach(() => mockRun.mockReset());

  it('키워드 배열을 받아 각각 파이프라인을 돌린다', async () => {
    mockRun.mockResolvedValue(undefined);
    const res = await POST(req({ keywords: ['등산 모자', '방한 장갑'] }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(2);
  });

  it('키워드가 비어 있으면 400이다', async () => {
    const res = await POST(req({ keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('한 번에 처리할 키워드 수를 제한한다', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `키워드${i}`);
    const res = await POST(req({ keywords: many }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('10');
  });

  it('본문이 JSON이 아니면 400이다', async () => {
    const bad = new Request('http://localhost/api/sourcing/agent/run', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/sourcing/agent/run/route'`

- [ ] **Step 3: 구현**

`src/app/api/sourcing/agent/run/route.ts` 신규 생성:

```typescript
/**
 * POST /api/sourcing/agent/run
 * 발굴 탭에서 선택한 키워드를 파이프라인에 태운다.
 *
 * 텔레그램 웹훅과 같은 엔진(runKeywordPipeline)을 쓰되 실행 경로만 웹으로 연다.
 * 결과는 keyword_requests / keyword_results에 쌓이고, pass 판정은 shortlist로 간다.
 *
 * 시드를 전량 자동 투입하지 않는 설계이므로 크론 진입점(GET)은 두지 않는다.
 */

import { after } from 'next/server';
import { runKeywordPipeline } from '@/lib/sourcing-agent/keyword-pipeline';

export const maxDuration = 60;

/** 한 번에 받을 수 있는 키워드 수. API 호출량과 실행 시간을 묶어 제한한다 */
const MAX_KEYWORDS = 10;

/** 웹 실행은 텔레그램 chat_id가 없으므로 빈 문자열을 넘긴다 */
const NO_TELEGRAM_CHAT = '';

export async function POST(request: Request) {
  let payload: { keywords?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const raw = Array.isArray(payload.keywords) ? payload.keywords : [];
  const keywords = raw
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    return Response.json({ success: false, error: '키워드를 하나 이상 지정하세요.' }, { status: 400 });
  }

  if (keywords.length > MAX_KEYWORDS) {
    return Response.json(
      { success: false, error: `한 번에 최대 ${MAX_KEYWORDS}개까지 실행할 수 있습니다.` },
      { status: 400 },
    );
  }

  // 응답을 먼저 돌려주고 백그라운드에서 순차 실행한다.
  // 동시 실행하면 네이버·도매꾹 API에 순간 부하가 몰린다.
  after(
    (async () => {
      for (const kw of keywords) {
        try {
          await runKeywordPipeline(kw, NO_TELEGRAM_CHAT);
        } catch (err) {
          console.error('[api/sourcing/agent/run] 파이프라인 실패:', kw, err);
        }
      }
    })(),
  );

  return Response.json({ success: true, data: { accepted: keywords.length } });
}
```

`runKeywordPipeline`이 chatId가 비었을 때 텔레그램을 부르지 않도록 `src/lib/sourcing-agent/keyword-pipeline.ts`의 전송부를 감싼다. 파일 상단에 헬퍼 추가:

```typescript
/** 웹 실행(chatId 없음)에서는 텔레그램을 부르지 않는다 */
async function notify(chatId: string, message: string): Promise<void> {
  if (!chatId) return;
  await sendTelegramMessage(chatId, message);
}
```

본문의 `sendTelegramMessage(chatId, ...)` 호출을 모두 `notify(chatId, ...)`로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/sourcing-agent-run.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: 죽은 크론 확인** (제거할 것이 이미 없다 — 위 전제 정정 참조)

Run: `grep -n 'agent/run' vercel.json`
Expected: 출력 없음 — **이미 그렇다.** `vercel.json`을 수정하지 마라.

확인만 하고 넘어간다. 2026-07-31 기준 등록된 크론 12개는 전부 라우트 파일이 있고 `GET`을 export한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/sourcing/agent/run/route.ts src/lib/sourcing-agent/keyword-pipeline.ts src/__tests__/api/sourcing-agent-run.test.ts
git commit -m "feat(sourcing): 발굴 웹 실행 라우트 추가, 404 크론 제거"
```

---

## Task 10: 발굴 탭 UI

**Files:**
- Create: `src/components/sourcing/DiscoveryTab.tsx`
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

기존 `SourcingAgentTab.tsx`(봇결과)는 결과 조회 로직을 담고 있으므로 **삭제하지 않고 결과 표시 부분을 그대로 재사용**한다.

- [ ] **Step 1: 발굴 탭 컴포넌트 작성**

`src/components/sourcing/DiscoveryTab.tsx` 신규 생성:

```tsx
'use client';

/**
 * DiscoveryTab.tsx
 * 발굴 탭 — "오늘 뭘 찾아볼까?"에 답하는 화면.
 *
 * 매일 크론이 모은 트렌드 시드를 보여주고, 체크한 것만 파이프라인에 태운다.
 * 전량 자동 실행하지 않는 이유: 하루 10시드 × 후보 5개면 5개월에 7,500개가 되어
 * 리스트가 오염되고 쓰지도 않을 후보에 API 비용이 나간다.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface Seed {
  id: number;
  keyword: string;
  source: string;
  reason: string | null;
  created_at: string;
}

const STALE_MS = 24 * 60 * 60 * 1000;

export default function DiscoveryTab() {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [lastCollectedAt, setLastCollectedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sourcing/seeds');
      const body = await res.json();
      if (body.success) {
        setSeeds(body.data.seeds);
        setLastCollectedAt(body.data.lastCollectedAt);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    const picked = seeds.filter((s) => checked.has(s.id)).map((s) => s.keyword);
    const extra = manual.trim();
    const keywords = extra ? [...picked, extra] : picked;
    if (keywords.length === 0) return;

    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sourcing/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      const body = await res.json();
      setMessage(
        body.success
          ? `${body.data.accepted}개 분석을 시작했습니다. 결과는 잠시 후 아래 목록과 소싱리스트에 반영됩니다.`
          : `실행 실패: ${body.error}`,
      );
      if (body.success) {
        setChecked(new Set());
        setManual('');
      }
    } finally {
      setRunning(false);
    }
  }

  const isStale =
    !lastCollectedAt || Date.now() - new Date(lastCollectedAt).getTime() > STALE_MS;
  const selectedCount = checked.size + (manual.trim() ? 1 : 0);

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>오늘의 트렌드 시드</h2>
        {isStale && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.warning }}>
            <AlertTriangle size={14} />
            수집이 24시간 넘게 없습니다 — 크론을 확인하세요
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textSub }}>
          {lastCollectedAt ? new Date(lastCollectedAt).toLocaleString('ko-KR') : '수집 이력 없음'}
        </span>
        <button onClick={() => void load()} disabled={loading} aria-label="새로고침">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {seeds.length === 0 && !loading && (
        <p style={{ color: C.textSub, fontSize: 14 }}>
          수집된 시드가 없습니다. 아래에 키워드를 직접 입력해 분석할 수 있습니다.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {seeds.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 8px', borderBottom: `1px solid ${C.border}`,
            }}
          >
            <input
              type="checkbox"
              checked={checked.has(s.id)}
              onChange={() => toggle(s.id)}
              aria-label={`${s.keyword} 선택`}
            />
            <span style={{ fontWeight: 600, color: C.text, minWidth: 140 }}>{s.keyword}</span>
            <span style={{ fontSize: 12, color: C.textSub, minWidth: 80 }}>{s.source}</span>
            <span style={{ fontSize: 12, color: C.textSub }}>{s.reason}</span>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="또는 직접 입력 (예: 넥워머)"
          style={{
            flex: 1, padding: '8px 10px',
            border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14,
          }}
        />
        <button
          onClick={() => void run()}
          disabled={running || selectedCount === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600,
            background: selectedCount > 0 ? C.accent : C.border,
            color: '#fff', border: 'none',
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          선택한 {selectedCount}개 분석
        </button>
      </div>

      {message && (
        <p style={{ marginTop: 12, fontSize: 13, color: C.textSub }}>{message}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 대시보드 배선**

`src/components/sourcing/SourcingDashboard.tsx` 수정.

import 추가:

```typescript
import DiscoveryTab from '@/components/sourcing/DiscoveryTab';
```

`Tab` 타입과 `TABS`를 교체:

```typescript
type Tab = 'discovery' | 'shortlist' | 'costco' | 'agent' | 'memo';

const TABS: { key: Tab; label: string }[] = [
  { key: 'discovery', label: '발굴' },
  { key: 'shortlist', label: '소싱리스트' },
  { key: 'costco', label: '코스트코' },
  { key: 'agent', label: '분석결과' },
  { key: 'memo', label: '메모' },
];
```

초기 탭을 발굴로:

```typescript
  const [activeTab, setActiveTab] = useState<Tab>('discovery');
```

렌더 분기에 추가:

```typescript
        {activeTab === 'discovery' && <DiscoveryTab />}
```

- [ ] **Step 3: 타입 검사와 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npm run build`
Expected: 빌드 성공

- [ ] **Step 4: 전체 테스트**

Run: `npx vitest run`
Expected: 실패가 7개 파일 / 14건을 넘지 않는다 (완료 기준의 래칫 참조). 늘었다면 이번 변경이 범인이다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/sourcing/DiscoveryTab.tsx src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat(sourcing): 발굴 탭 추가 — 시드 선택 실행"
```

---

## Task 11: 동작 확인

**Files:** 없음 (수동 검증)

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

- [ ] **Step 2: 발굴 탭 확인**

브라우저에서 `http://localhost:3000/sourcing` 접속.

확인할 것:
1. 첫 탭이 **발굴**이고 시드 목록이 뜬다
2. 시드가 없으면 "수집된 시드가 없습니다" 문구와 직접 입력창이 보인다
3. 마지막 수집 시각이 표시되고, 24시간이 지났으면 경고 배지가 뜬다

- [ ] **Step 3: 실행 확인**

직접 입력창에 `방한 장갑`을 넣고 **분석** 버튼을 누른다.

확인할 것:
1. "1개 분석을 시작했습니다" 메시지가 뜬다
2. 서버 로그에 파이프라인 실행 흔적이 남는다
3. 1~2분 뒤 **분석결과** 탭에 결과가 쌓인다
4. `pass` 판정이 있었다면 **소싱리스트** 탭에 항목이 생긴다

- [ ] **Step 4: 판정 정확도 확인**

소싱리스트에 생긴 항목의 수수료가 11.88%로 계산됐는지 확인한다. 손익분기가가 이전보다 **높게** 나와야 정상이다(수수료가 올랐으므로).

- [ ] **Step 5: 커밋**

수동 검증에서 고칠 것이 나오면 수정 후 커밋한다. 없으면 이 단계를 건너뛴다.

---

## 완료 기준

- [ ] 소싱 스위트 전체 통과

  ```bash
  npx vitest run src/__tests__/lib/sourcing/ src/lib/sourcing/__tests__/ \
                 src/__tests__/lib/sourcing-agent/ src/__tests__/api/sourcing-*.test.ts
  ```

- [ ] `npx vitest run` 실패가 **7개 파일 / 14건을 넘지 않는다** (기존 부채 래칫)

  > **왜 "전체 통과"가 아닌가.** 이 계획 착수 시점에 소싱과 무관한 영역(이미지 생성·키워드 AI·에셋 UI)에
  > 이미 깨진 테스트가 있었다. 원인은 전부 코드가 움직인 뒤 테스트가 따라가지 않은 노후이며,
  > 고치려면 각기 별도 조사가 필요해 이 계획에 묶으면 소싱 작업이 무관한 고고학에 발이 묶인다.
  >
  > 대신 **래칫**을 건다. 숫자가 늘면 범인은 이번 작업이다. 15건을 먼저 갚지 않고도 새 파손은 즉시 잡힌다.
  >
  > 착수 시 9개 파일 / 17건 → Task 1에서 `shortlist-verify` 2건, `dashboard-summary` 1건을 해소해
  > 현재 7개 파일 / 14건. 남은 7개 파일은 아래 "이 계획에서 제외한 것" 표를 참조.
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] `npm run build` 성공
- [ ] `/sourcing`에서 시드를 골라 실행하면 소싱리스트에 `pass` 후보가 쌓인다
- [ ] `grep -rn 'agent/run' vercel.json` 결과 없음 (착수 시점에 이미 충족 — 새로 넣지 않았는지 확인용)

## 이 계획에서 제외한 것

| 항목 | 이유 | 다음 단계 |
|---|---|---|
| 1688 붙여넣기 파싱 | 발굴이 먼저 돌아야 붙여넣을 후보가 생긴다 | 2단계 — 프로토타입이 커밋 `eed33c82`에 있다 (`tools/margin-calculator/src/lib/parse-1688.ts`). 단가×수량≈합계 관계로 가격 구간이 섞인 텍스트에서 실제 적용 단가를 판별한다. 같은 커밋의 `grocery-cost.ts`(그로스 운영비 분해)·`fx.ts`(실시간 환율)도 함께 볼 것 |
| 국제배송 설정 화면 | `intl-shipping.ts`는 만들되 UI는 발주 시점에 필요하다 | 2~3단계 |
| 발주 화면·실비 배분 | 첫 발주 직전에 만들면 된다 | 3단계 |
| 액션 탭 | 재고가 도착해 판매 데이터가 쌓인 뒤에야 판정할 것이 생긴다 | 4단계 |
| SKU 분기 자동 판별 | 도매꾹 목록 API에 옵션 정보가 없다. 상세 조회가 필요해 비용이 는다 | 미정 |
| 기존 실패 테스트 7파일 14건 | 소싱과 무관한 영역(이미지·키워드 AI·에셋 UI)이고 각각 별도 조사가 필요하다 | 별도 과제 |
| `ProductAdTable.tsx` 물류비 VAT 미반영 | Task 1 범위 밖. 광고전략 화면이 아직 `getRgShippingFee()`(VAT 별도)를 쓴다 | 별도 과제 (2026-07-31 해소 — 커밋 `66c3dc40`·`94fd69e9`) |
| `isViable` 기준 불일치 | `margin-1688.ts:95`·`costco-margin.ts:49`는 `netProfit > 0`인데 `coupang-price.ts`의 `TARGET_MARGIN_RATE`는 30%다. 같은 질문에 두 기준이 답한다 | 별도 과제 — 임계값을 바꾸면 두 모듈의 기존 테스트 의미가 조용히 달라지므로 단독 커밋으로 |
| 관세·부가세 절사 처리 | 국고금 관리법 제47조상 반올림이 아니라 절사(과세표준 1원 미만, 징수세액 10원 미만)로 보이나, 관세액 **중간단계** 처리 규정을 확인하지 못했다. 차이는 건당 최대 9원 | 별도 과제 — 관세청 1차 자료 확인 후 |
| 마이그레이션 디렉터리 이원화 | 스키마가 `supabase/migrations/`와 `src/db/migrations/` 두 곳에 나뉘어 있다 (`trend_seeds`는 후자) | 별도 과제 |

### 남은 기존 실패 테스트 (2026-07-31 기준 7파일 14건)

| 파일 | 건수 | 확인된 원인 |
|---|---|---|
| `components/add-product-modal-naver.test.tsx` | 5 | `"네이버 상품"` 버튼을 못 찾음 — 해당 UI가 사라진 뒤 테스트 방치 |
| `api/keyword-discover.test.ts` | 3 | `evaluateKeyword`가 spy가 아님 — mock 대상 export 형태 변경 |
| `api/keyword-suggest-with-evaluate.test.ts` | 2 | 위와 같은 계열 |
| `api/cleanup-image-region.test.ts` | 1 | 미조사 |
| `api/image/analyze-detail-images.test.ts` | 1 | 미조사 |
| `components/assets-tab.test.tsx` | 1 | 미조사 |
| `components/detail-maker-thumbnail-panel.test.tsx` | 1 | 미조사 |

> 해소된 것: `lib/sourcing/shortlist-verify.test.ts`(2건) · `api/dashboard-summary.test.ts`(1건).
> 후자는 활성 플랜을 v2→v3로 교체한 뒤 테스트만 v2 값을 하드코딩한 채 남은 경우였다.
> 대시보드 자체는 정상이었다 — 커밋 `39e6dfdf`.
