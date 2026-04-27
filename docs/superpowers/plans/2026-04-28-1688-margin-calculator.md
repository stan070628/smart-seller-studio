# 1688 사입 마진 계산기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1688 사입가(위안) + 환율 + 관세 + 국제배송 + 쿠팡 로켓그로스 운영비를 합산하여 SKU별 실 마진을 계산하고, 도매꾹 위탁 마진과 비교하여 사입 전환 권장 여부를 판단하는 도구를 구현한다.

**Architecture:** 기존 `shared/channel-policy.ts`(채널 수수료/VAT) + `costco-pricing.ts`(사입 모델 패턴)를 재사용. 1688 전용 파라미터(환율/관세/국제배송/그로스 운영비)를 입력 인터페이스에 추가한 순수 계산 함수 `calc1688Margin()` + 위탁/사입 비교 함수 `compareWholesaleVsBuy()`를 lib에 작성. UI는 단일 페이지 form + 결과 카드.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, 기존 `src/lib/sourcing/shared/` 인프라
**전략 v2 의존도:** high (Week 8 시작 전 완료 권장)
**근거 spec:** `docs/superpowers/specs/2026-04-27-seller-strategy-v2-design.md` §6.5

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `src/lib/sourcing/margin-1688.ts` | 순수 계산: `calc1688Margin`, `compareWholesaleVsBuy`, 환율/관세 상수 |
| 신규 | `src/lib/sourcing/__tests__/margin-1688.test.ts` | 계산 단위 테스트 |
| 신규 | `src/app/sourcing/margin-calculator/page.tsx` | 페이지 라우트 |
| 신규 | `src/components/sourcing/MarginCalc.tsx` | 입력 폼 + 결과 표시 (클라이언트) |

---

## Task 1: 1688 마진 계산 코어

**Files:**
- Create: `src/lib/sourcing/margin-1688.ts`
- Test: `src/lib/sourcing/__tests__/margin-1688.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sourcing/__tests__/margin-1688.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  IMPORT_VAT_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
} from '../margin-1688';

describe('상수 검증', () => {
  it('환율 기본값 190 ~ 200 범위', () => {
    expect(DEFAULT_EXCHANGE_RATE_KRW_PER_RMB).toBeGreaterThan(180);
    expect(DEFAULT_EXCHANGE_RATE_KRW_PER_RMB).toBeLessThan(210);
  });

  it('관세 기본값 8%', () => {
    expect(DEFAULT_TARIFF_RATE).toBe(0.08);
  });

  it('수입 VAT 10%', () => {
    expect(IMPORT_VAT_RATE).toBe(0.1);
  });
});

describe('calc1688Margin — 1688 사입 실 마진', () => {
  it('가장 단순한 케이스: 위안가 10원, 환율 200, 관세 8%, 수입VAT 10%, 시장가 10000원', () => {
    const r = calc1688Margin({
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    });

    // 사입원가 = 10*200 + 10*200*0.08 + (10*200+관세)*0.1 + 1000
    //         = 2000 + 160 + 216 + 1000 = 3376
    expect(r.purchaseCostKrw).toBeCloseTo(3376, 0);
    expect(r.netProfit).toBeGreaterThan(0);
    expect(r.marginRatePct).toBeGreaterThan(0);
  });

  it('packQty 입수 단위 적용: 100개 박스 단가는 buyPriceRmb / packQty', () => {
    const r = calc1688Margin({
      buyPriceRmb: 1000,        // 박스 1000원(위안)
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 0,
      packQty: 100,             // 100개입
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    });

    // 개당 위안 = 1000 / 100 = 10
    // 사입원가 = 2000 + 160 + 216 + 0 = 2376
    expect(r.purchaseCostKrw).toBeCloseTo(2376, 0);
  });

  it('그로스 운영비(입고+보관+출고) 가산', () => {
    const r = calc1688Margin({
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 1500, // 입고 200 + 보관 300 + 출고 1000
    });

    expect(r.totalCostKrw).toBeCloseTo(3376 + 1500, 0);
  });

  it('사입원가 > 시장가 → 마이너스 마진, isViable=false', () => {
    const r = calc1688Margin({
      buyPriceRmb: 100,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 5000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 1500,
    });

    expect(r.netProfit).toBeLessThan(0);
    expect(r.isViable).toBe(false);
  });

  it('네이버 채널은 coupang보다 수수료 낮아 마진 더 큼 (동일 조건)', () => {
    const base = {
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    } as const;

    const naver = calc1688Margin({ ...base, channel: 'naver' });
    const coupang = calc1688Margin({ ...base, channel: 'coupang' });
    expect(naver.netProfit).toBeGreaterThan(coupang.netProfit);
  });
});

describe('compareWholesaleVsBuy — 위탁 vs 사입 비교', () => {
  it('사입 마진이 위탁보다 큼 → "buy" 권장', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1500,   // 도매꾹 위탁 개당 마진
      buyMarginPerUnitKrw: 4000,         // 1688 사입 개당 마진
      monthlySalesQty: 30,
      buyCapitalNeededKrw: 600000,       // 첫 사입 자본
    });
    expect(result.recommendation).toBe('buy');
    expect(result.monthlyDiffKrw).toBeCloseTo((4000 - 1500) * 30);
  });

  it('월 마진 차액으로 사입 자본 회수 ≤ 1개월 → 강력 권장 (buy_strong)', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1000,
      buyMarginPerUnitKrw: 5000,
      monthlySalesQty: 50,                   // 월 차액 = 4000*50 = 200,000
      buyCapitalNeededKrw: 150000,           // 1개월 미만 회수
    });
    expect(result.recommendation).toBe('buy_strong');
    expect(result.paybackMonths).toBeLessThan(1);
  });

  it('사입 마진이 위탁과 비슷 → "hold" (전환 비추천)', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 2000,
      buyMarginPerUnitKrw: 2200,
      monthlySalesQty: 20,
      buyCapitalNeededKrw: 500000,
    });
    expect(result.recommendation).toBe('hold');
  });

  it('사입 마진 < 위탁 마진 → "wholesale_only"', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 3000,
      buyMarginPerUnitKrw: 1500,
      monthlySalesQty: 10,
      buyCapitalNeededKrw: 300000,
    });
    expect(result.recommendation).toBe('wholesale_only');
  });

  it('월 판매량 0 → "insufficient_data"', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1000,
      buyMarginPerUnitKrw: 3000,
      monthlySalesQty: 0,
      buyCapitalNeededKrw: 500000,
    });
    expect(result.recommendation).toBe('insufficient_data');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/margin-1688.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: margin-1688.ts 구현**

`src/lib/sourcing/margin-1688.ts`:

```ts
/**
 * 1688 사입 마진 계산기
 *
 * 채널 spec v2 §6.5
 * 1688 위안가 + 환율 + 관세 + 국제배송 + (선택) 쿠팡 로켓그로스 운영비
 * → SKU별 실 마진. 도매꾹 위탁 마진과 비교하여 사입 전환 권장.
 *
 * 공식:
 *   perUnitRmb         = buyPriceRmb / packQty
 *   landedKrw          = perUnitRmb * exchangeRate
 *   tariffKrw          = landedKrw * tariffRate
 *   importVatKrw       = (landedKrw + tariffKrw) * IMPORT_VAT_RATE
 *   purchaseCostKrw    = landedKrw + tariffKrw + importVatKrw + shippingPerUnitKrw
 *   totalCostKrw       = purchaseCostKrw + groceryRunningCost
 *   channelFeeKrw      = sellPrice * categoryFeeRate
 *   sellVatKrw         = sellPrice * VAT_RATE      // 판매 시 매출 VAT (별도)
 *   netProfit          = sellPrice - sellVatKrw - channelFeeKrw - totalCostKrw
 *   marginRate         = netProfit / sellPrice
 */

import {
  CHANNEL_FEE,
  VAT_RATE,
  getCategoryFeeRate,
  type Channel,
} from './shared/channel-policy';

export type { Channel };

// 환율 — Week 17 (2026-04 기준 평균치) 참고. 실시간 변동은 사용자가 입력.
export const DEFAULT_EXCHANGE_RATE_KRW_PER_RMB = 195;

// 일반 소비재 관세율 (FTA 미적용 기준)
export const DEFAULT_TARIFF_RATE = 0.08;

// 수입 VAT (관세포함가 기준 10%)
export const IMPORT_VAT_RATE = 0.1;

export interface Margin1688Input {
  /** 1688 위안 사입가 (박스 단위) */
  buyPriceRmb: number;
  /** 환율 (KRW per RMB) */
  exchangeRate: number;
  /** 관세율 (소수, 0.08 = 8%) */
  tariffRate: number;
  /** 개당 국제배송비 (원). 1688 박스가격에 미포함 시 별도 계산 */
  shippingPerUnitKrw: number;
  /** 박스 입수 (개). 단품이면 1 */
  packQty: number;
  /** 판매 채널 */
  channel: Channel;
  /** 카테고리명 (수수료율 결정) */
  categoryName: string | null;
  /** 시장 판매가 (원) */
  sellPrice: number;
  /** 쿠팡 로켓그로스 운영비 — 입고+보관+출고 SKU당 합산 (원). 그로스 미사용 시 0 */
  groceryRunningCost: number;
}

export interface Margin1688Result {
  perUnitRmb: number;
  landedKrw: number;            // 환율적용 후 원가
  tariffKrw: number;
  importVatKrw: number;
  purchaseCostKrw: number;      // 입고 직전까지의 개당 사입원가
  totalCostKrw: number;         // 그로스 운영비 포함 총원가
  channelFeeKrw: number;        // 마켓플레이스 수수료
  sellVatKrw: number;
  netProfit: number;
  marginRate: number;           // 0~1
  marginRatePct: number;        // 소수점 1자리
  isViable: boolean;
  channelFeeRate: number;
}

export function calc1688Margin(input: Margin1688Input): Margin1688Result {
  const perUnitRmb = input.buyPriceRmb / Math.max(input.packQty, 1);
  const landedKrw = perUnitRmb * input.exchangeRate;
  const tariffKrw = landedKrw * input.tariffRate;
  const importVatKrw = (landedKrw + tariffKrw) * IMPORT_VAT_RATE;
  const purchaseCostKrw = landedKrw + tariffKrw + importVatKrw + input.shippingPerUnitKrw;
  const totalCostKrw = purchaseCostKrw + input.groceryRunningCost;

  const channelFeeRate = getCategoryFeeRate(input.categoryName, input.channel) ?? CHANNEL_FEE[input.channel];
  const channelFeeKrw = input.sellPrice * channelFeeRate;
  const sellVatKrw = input.sellPrice * VAT_RATE;

  const netProfit = input.sellPrice - sellVatKrw - channelFeeKrw - totalCostKrw;
  const marginRate = input.sellPrice > 0 ? netProfit / input.sellPrice : 0;

  return {
    perUnitRmb: round2(perUnitRmb),
    landedKrw: round0(landedKrw),
    tariffKrw: round0(tariffKrw),
    importVatKrw: round0(importVatKrw),
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

// ─────────────────────────────────────────────────────────────────────────────
// 위탁 vs 사입 비교
// ─────────────────────────────────────────────────────────────────────────────

export type WholesaleVsBuyRecommendation =
  | 'buy_strong'        // 사입 강력 권장 (자본 회수 < 1개월)
  | 'buy'               // 사입 권장 (마진 차이 명확)
  | 'hold'              // 마진 차이 미미 — 전환 보류
  | 'wholesale_only'    // 위탁 마진이 더 좋음
  | 'insufficient_data'; // 판매량 0 등 판단 불가

export interface CompareInput {
  wholesaleMarginPerUnitKrw: number;
  buyMarginPerUnitKrw: number;
  monthlySalesQty: number;
  buyCapitalNeededKrw: number;
}

export interface CompareResult {
  recommendation: WholesaleVsBuyRecommendation;
  monthlyDiffKrw: number;        // 월간 마진 차액
  paybackMonths: number | null;  // 사입 자본 회수 개월 (사입 권장 시)
  reason: string;
}

const HOLD_RATIO = 1.2;          // 사입 마진이 위탁의 1.2배 미만이면 hold

export function compareWholesaleVsBuy(input: CompareInput): CompareResult {
  if (input.monthlySalesQty <= 0) {
    return {
      recommendation: 'insufficient_data',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: '월 판매량이 0이라 판단 불가',
    };
  }

  if (input.buyMarginPerUnitKrw < input.wholesaleMarginPerUnitKrw) {
    return {
      recommendation: 'wholesale_only',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: '사입 마진이 위탁 마진보다 낮음 — 전환 비추천',
    };
  }

  if (input.buyMarginPerUnitKrw < input.wholesaleMarginPerUnitKrw * HOLD_RATIO) {
    return {
      recommendation: 'hold',
      monthlyDiffKrw: 0,
      paybackMonths: null,
      reason: `마진 차이가 ${HOLD_RATIO}배 미만 — 사입 자본 리스크 대비 이득 부족`,
    };
  }

  const monthlyDiffKrw = (input.buyMarginPerUnitKrw - input.wholesaleMarginPerUnitKrw) * input.monthlySalesQty;
  const paybackMonths = monthlyDiffKrw > 0 ? input.buyCapitalNeededKrw / monthlyDiffKrw : null;

  if (paybackMonths !== null && paybackMonths < 1) {
    return {
      recommendation: 'buy_strong',
      monthlyDiffKrw,
      paybackMonths,
      reason: `자본 회수 ${paybackMonths.toFixed(2)}개월 — 즉시 사입 권장`,
    };
  }

  return {
    recommendation: 'buy',
    monthlyDiffKrw,
    paybackMonths,
    reason:
      paybackMonths !== null
        ? `자본 회수 ${paybackMonths.toFixed(1)}개월 예상`
        : '월 판매량 기준 회수 가능',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
function round0(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sourcing/__tests__/margin-1688.test.ts`
Expected: PASS — 12개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sourcing/margin-1688.ts src/lib/sourcing/__tests__/margin-1688.test.ts
git commit -m "feat(sourcing): add 1688 margin calculator + wholesale-vs-buy comparator"
```

---

## Task 2: UI 컴포넌트 — MarginCalc

**Files:**
- Create: `src/components/sourcing/MarginCalc.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/sourcing/MarginCalc.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
  type Margin1688Input,
  type Margin1688Result,
  type CompareResult,
  type Channel,
} from '@/lib/sourcing/margin-1688';

const CATEGORY_OPTIONS = [
  '생활용품',
  '주방용품',
  '욕실용품',
  '청소/세탁',
  '자동차용품',
  '스포츠/아웃도어',
  '가방/지갑',
  '패션잡화',
  '패션의류',
  '유아/아동',
  '완구/장난감',
  '건강/의료',
  '기타',
] as const;

const CHANNEL_OPTIONS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: 'coupang', label: '쿠팡 (그로스/일반)' },
  { value: 'naver', label: '네이버 스마트스토어' },
];

const RECO_STYLE: Record<
  CompareResult['recommendation'],
  { bg: string; border: string; emoji: string; label: string }
> = {
  buy_strong:        { bg: 'bg-emerald-50', border: 'border-emerald-400', emoji: '🚀', label: '강력 사입 권장' },
  buy:               { bg: 'bg-green-50',   border: 'border-green-400',   emoji: '✅', label: '사입 권장' },
  hold:              { bg: 'bg-yellow-50',  border: 'border-yellow-400',  emoji: '⏸️', label: '전환 보류' },
  wholesale_only:    { bg: 'bg-orange-50',  border: 'border-orange-400',  emoji: '🛒', label: '위탁 유지' },
  insufficient_data: { bg: 'bg-gray-50',    border: 'border-gray-300',    emoji: '❓', label: '데이터 부족' },
};

interface FormState extends Omit<Margin1688Input, 'categoryName' | 'channel'> {
  categoryName: string;
  channel: Channel;
  // 비교용 — 도매꾹 위탁 마진(개당)
  wholesaleMarginPerUnitKrw: number;
  monthlySalesQty: number;
}

const INITIAL: FormState = {
  buyPriceRmb: 0,
  exchangeRate: DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  tariffRate: DEFAULT_TARIFF_RATE,
  shippingPerUnitKrw: 1000,
  packQty: 1,
  channel: 'coupang',
  categoryName: '생활용품',
  sellPrice: 0,
  groceryRunningCost: 0,
  wholesaleMarginPerUnitKrw: 0,
  monthlySalesQty: 0,
};

export default function MarginCalc() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [result, setResult] = useState<Margin1688Result | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleCalculate() {
    const r = calc1688Margin({
      buyPriceRmb: form.buyPriceRmb,
      exchangeRate: form.exchangeRate,
      tariffRate: form.tariffRate,
      shippingPerUnitKrw: form.shippingPerUnitKrw,
      packQty: Math.max(form.packQty, 1),
      channel: form.channel,
      categoryName: form.categoryName,
      sellPrice: form.sellPrice,
      groceryRunningCost: form.groceryRunningCost,
    });
    setResult(r);

    if (form.wholesaleMarginPerUnitKrw > 0 && form.monthlySalesQty > 0) {
      const buyCapital = (r.purchaseCostKrw + form.shippingPerUnitKrw) * form.monthlySalesQty;
      const c = compareWholesaleVsBuy({
        wholesaleMarginPerUnitKrw: form.wholesaleMarginPerUnitKrw,
        buyMarginPerUnitKrw: r.netProfit,
        monthlySalesQty: form.monthlySalesQty,
        buyCapitalNeededKrw: buyCapital,
      });
      setCompare(c);
    } else {
      setCompare(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded border border-gray-200 p-4">
        <h2 className="mb-3 text-base font-semibold">입력</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField label="1688 박스가 (위안)" value={form.buyPriceRmb} onChange={(v) => update('buyPriceRmb', v)} step={0.01} />
          <NumField label="입수 (개/박스)" value={form.packQty} onChange={(v) => update('packQty', v)} step={1} />
          <NumField label="환율 (원/위안)" value={form.exchangeRate} onChange={(v) => update('exchangeRate', v)} step={0.1} />
          <NumField label="관세율 (0.08 = 8%)" value={form.tariffRate} onChange={(v) => update('tariffRate', v)} step={0.01} />
          <NumField label="개당 국제배송 (원)" value={form.shippingPerUnitKrw} onChange={(v) => update('shippingPerUnitKrw', v)} step={100} />
          <NumField label="개당 그로스 운영비 (원)" value={form.groceryRunningCost} onChange={(v) => update('groceryRunningCost', v)} step={100} hint="입고+보관+출고. 그로스 미사용 0" />
          <SelectField
            label="채널"
            value={form.channel}
            options={CHANNEL_OPTIONS}
            onChange={(v) => update('channel', v as Channel)}
          />
          <SelectField
            label="카테고리"
            value={form.categoryName}
            options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => update('categoryName', v)}
          />
          <NumField label="판매가 (원)" value={form.sellPrice} onChange={(v) => update('sellPrice', v)} step={100} />
          <div className="col-span-2 mt-2 border-t border-gray-200 pt-3">
            <h3 className="mb-2 text-sm font-semibold">위탁 비교 (선택)</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="도매꾹 위탁 개당 마진 (원)" value={form.wholesaleMarginPerUnitKrw} onChange={(v) => update('wholesaleMarginPerUnitKrw', v)} step={100} />
              <NumField label="월 판매량 (개)" value={form.monthlySalesQty} onChange={(v) => update('monthlySalesQty', v)} step={1} />
            </div>
          </div>
        </div>
        <button
          onClick={handleCalculate}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          계산
        </button>
      </section>

      <section className="space-y-4">
        {result && <ResultCard r={result} />}
        {compare && <CompareCard c={compare} />}
        {!result && (
          <div className="rounded border border-gray-200 p-6 text-center text-sm text-gray-500">
            입력값을 채우고 계산을 실행하세요.
          </div>
        )}
      </section>
    </div>
  );
}

function NumField({
  label, value, onChange, step, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        type="number"
        step={step}
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-gray-500">{hint}</span>}
    </label>
  );
}

function SelectField<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ResultCard({ r }: { r: Margin1688Result }) {
  const profitColor = r.netProfit > 0 ? 'text-green-700' : 'text-red-700';
  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-4">
      <h2 className="mb-3 text-base font-semibold">실 마진 결과</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="환율 적용 원가" value={`${r.landedKrw.toLocaleString()} 원`} />
        <Row label="관세" value={`${r.tariffKrw.toLocaleString()} 원`} />
        <Row label="수입 VAT" value={`${r.importVatKrw.toLocaleString()} 원`} />
        <Row label="입고 직전 사입원가" value={`${r.purchaseCostKrw.toLocaleString()} 원`} />
        <Row label="총 원가 (그로스 포함)" value={`${r.totalCostKrw.toLocaleString()} 원`} />
        <Row label="채널 수수료" value={`${r.channelFeeKrw.toLocaleString()} 원 (${(r.channelFeeRate * 100).toFixed(2)}%)`} />
        <Row label="매출 VAT" value={`${r.sellVatKrw.toLocaleString()} 원`} />
        <Row label="순이익" value={`${r.netProfit.toLocaleString()} 원`} valueClass={profitColor} bold />
        <Row label="마진율" value={`${r.marginRatePct}%`} valueClass={profitColor} bold />
      </dl>
    </div>
  );
}

function CompareCard({ c }: { c: CompareResult }) {
  const s = RECO_STYLE[c.recommendation];
  return (
    <div className={`rounded border p-4 ${s.bg} ${s.border}`}>
      <h2 className="mb-1 text-base font-semibold">{s.emoji} {s.label}</h2>
      <p className="text-sm text-gray-700">{c.reason}</p>
      {c.monthlyDiffKrw > 0 && (
        <p className="mt-1 text-xs text-gray-600">월간 마진 차액: {c.monthlyDiffKrw.toLocaleString()} 원</p>
      )}
      {c.paybackMonths !== null && (
        <p className="text-xs text-gray-600">자본 회수 기간: {c.paybackMonths.toFixed(2)} 개월</p>
      )}
    </div>
  );
}

function Row({ label, value, valueClass = '', bold = false }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <>
      <dt className="text-gray-600">{label}</dt>
      <dd className={`text-right ${bold ? 'font-semibold' : ''} ${valueClass}`}>{value}</dd>
    </>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add src/components/sourcing/MarginCalc.tsx
git commit -m "feat(ui): add MarginCalc component for 1688 sourcing calculator"
```

---

## Task 3: 페이지 라우트

**Files:**
- Create: `src/app/sourcing/margin-calculator/page.tsx`

- [ ] **Step 1: 페이지 작성**

`src/app/sourcing/margin-calculator/page.tsx`:

```tsx
import MarginCalc from '@/components/sourcing/MarginCalc';

export const metadata = {
  title: '1688 사입 마진 계산기',
  description: '1688 위안가 → 환율/관세/배송/그로스 운영비 합산 후 실 마진 산출',
};

export default function MarginCalculatorPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 사입 마진 계산기</h1>
      <p className="mb-6 text-sm text-gray-600">
        1688 박스 위안가에 환율·관세·국제배송·쿠팡 그로스 운영비까지 모두 반영한
        실 마진을 계산합니다. 도매꾹 위탁 마진과 비교하여 사입 전환 권장 여부를 판단합니다.
        (전략 v2 §6.5)
      </p>
      <MarginCalc />
    </main>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공, `/sourcing/margin-calculator` 경로 포함

- [ ] **Step 3: 커밋**

```bash
git add src/app/sourcing/margin-calculator/
git commit -m "feat(page): add /sourcing/margin-calculator page route"
```

---

## Task 4: 수동 동작 검증

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: localhost:3000

- [ ] **Step 2: 페이지 접근**

URL: `http://localhost:3000/sourcing/margin-calculator`
Expected: 입력 폼 좌측, 결과 placeholder 우측 표시

- [ ] **Step 3: 검증 케이스 1 — 단순 계산**

입력:
- 1688 박스가: `10`
- 입수: `1`
- 환율: `200`
- 관세율: `0.08`
- 개당 국제배송: `1000`
- 개당 그로스 운영비: `0`
- 채널: 쿠팡
- 카테고리: 생활용품
- 판매가: `10000`

"계산" 클릭 → Expected:
- 입고 직전 사입원가 ≈ 3,376원
- 채널 수수료 ≈ 1,100원
- 매출 VAT 1,000원
- 순이익 약 4,524원
- 마진율 약 45.2%

- [ ] **Step 4: 검증 케이스 2 — 위탁 vs 사입 비교**

위 케이스에서 추가 입력:
- 도매꾹 위탁 개당 마진: `1500`
- 월 판매량: `30`

"계산" 클릭 → Expected:
- 결과 카드 아래에 비교 카드 표시
- 사입 마진 4,524 > 위탁 1,500 × 1.2 → "사입 권장" 또는 "강력 사입 권장"
- 자본 회수 개월 표시

- [ ] **Step 5: 검증 케이스 3 — 마이너스 마진**

입력:
- 1688 박스가: `100`
- 환율: `200`
- 개당 국제배송: `5000`
- 판매가: `10000`

→ Expected:
- 순이익 빨간색 음수
- 마진율 음수
- 위탁 비교 입력 시 "wholesale_only" 권장

- [ ] **Step 6: 검증 결과 메모**

UX 이슈 / 추가 필요 입력 발견 시 retrospective 노트로 기록.

---

## Self-Review Checklist

**1. Spec coverage** ✅
- §6.5 "1688 가격 + 관세 + 배송 + 그로스 수수료/보관료 = 실 마진" → Task 1 (calc1688Margin)
- §6.5 "위탁 마진 vs 사입 마진 비교 → 사입 전환 임계값 자동 계산" → Task 1 (compareWholesaleVsBuy + paybackMonths)
- §6.5 "위치: src/components/sourcing/MarginCalc.tsx" → Task 2 정확히 일치

**2. Placeholder scan** ✅
- TBD/TODO 0건. 모든 코드 블록 완전.

**3. Type consistency** ✅
- `Channel` — 기존 `shared/channel-policy.ts`에서 import (재정의 X)
- `Margin1688Input/Result`, `CompareInput/Result`, `WholesaleVsBuyRecommendation` — Task 1에서 정의, Task 2에서 import
- `RECO_STYLE` — `WholesaleVsBuyRecommendation`의 모든 5개 케이스를 빠짐없이 처리

**4. 기존 인프라 재사용**
- `getCategoryFeeRate(categoryName, channel)` — 기존 채널 수수료 정책 그대로 사용 (재구현 없음)
- `VAT_RATE` — 기존 상수 import
- `Channel` 타입 — 기존 정의 import

**5. 한계 및 개선 여지**
- 환율은 사용자 수동 입력. 추후 외부 환율 API 연동 시 default 값을 자동 갱신하는 별도 plan 가능.
- 그로스 운영비는 사용자가 합산값 입력. coupang-fee-mapping-redesign plan 완료 후 자동 산출 가능.
- 비교 시 사입 자본 = `(개당 사입원가 + 배송) × 월판매량` 단순 추정. 첫 발주 최소 수량(MOQ)이나 안전재고 미반영 — 보수적 1차 추정.

**6. 회귀 위험**
- 신규 모듈 + 신규 페이지만 추가. 기존 코드 0줄 수정.
