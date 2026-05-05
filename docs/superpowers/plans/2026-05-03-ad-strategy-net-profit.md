# Ad Strategy 상품별 순이익 계산 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광고 전략 페이지에서 상품별로 광고비를 감안한 순이익(월 순이익, 건당 순이익, 손익분기점 ROAS)을 자동 계산하여 표시한다.

**Architecture:** 광고센터 상품별 보고서 페이지를 추가 스크래핑하여 상품별 광고비/ROAS를 수집하고, 사용자가 입력한 원가(localStorage 저장)와 결합해 client-side에서 순이익을 계산한다. 판매량은 기존 Coupang 주문 API가 이미 처리하므로 그대로 활용한다.

**Tech Stack:** Playwright(스크래퍼), TypeScript, React, localStorage, 인라인 style(기존 패턴 유지)

---

## 순이익 공식 (making-money-hippo 기준)

```
마진(건당)      = 판매가 × (1 - 쿠팡수수료율) - 원가(VAT포함)
광고비(건당)    = 월 광고비 ÷ 월 판매량
건당 순이익     = 마진(건당) - 광고비(건당)
월 순이익       = 건당 순이익 × 월 판매량
손익분기점 ROAS = (판매가 ÷ 마진) × 1.1 × 100   ← 부가세 보정 포함
실제 ROAS      = adRoas (광고센터 스크래핑 값)
```

- 쿠팡 로켓그로스 기본 수수료: **10.8%** (설정 가능)
- 원가는 VAT 포함 금액으로 입력 (하마 원칙)

---

## File Map

| 파일 | 역할 | 변경 유형 |
|---|---|---|
| `src/lib/ad-strategy/types.ts` | 타입 정의 — `RawProduct`, `ProductAdGrade` 확장 | Modify |
| `src/lib/ad-strategy/scraper.ts` | 광고센터 상품별 보고서 추가 스크래핑 | Modify |
| `src/lib/ad-strategy/net-profit.ts` | 순이익 계산 순수 함수 | Create |
| `src/lib/ad-strategy/use-cost-store.ts` | 원가 localStorage hook | Create |
| `src/components/ad-strategy/ProductAdTable.tsx` | 순이익 컬럼 추가 + 원가 인라인 입력 | Modify |
| `src/components/ad-strategy/AdStrategyPanel.tsx` | 수수료율 설정 UI 추가 | Modify |
| `src/lib/ad-strategy/analyzer-prompt.ts` | 광고비/ROAS 데이터 프롬프트에 반영 | Modify |
| `src/__tests__/lib/ad-strategy/net-profit.test.ts` | 순이익 계산 단위 테스트 | Create |

---

## Task 1: types.ts — RawProduct · ProductAdGrade 확장

**Files:**
- Modify: `src/lib/ad-strategy/types.ts`

- [ ] **Step 1: 타입 확장 적용**

`src/lib/ad-strategy/types.ts` 전체를 아래로 교체한다:

```typescript
export type UrgentActionType =
  | 'IMAGE_FIX'
  | 'BUDGET_INCREASE'
  | 'CAMPAIGN_EXTEND'
  | 'RESTOCK'
  | 'CAMPAIGN_CREATE';

export interface UrgentAction {
  type: UrgentActionType;
  product: string;
  reason: string;
  action: string;
  deepLink?: string;
}

export type AdGrade = 'A' | 'B' | 'C' | 'HOLD';

export interface ProductAdGrade {
  name: string;
  grade: AdGrade;
  isItemWinner: boolean;
  monthlySales: number;
  stock: number;
  currentPrice: number;
  reason: string;
  suggestedDailyBudget?: number;
  // ── 순이익 관련 (스크래핑 + 사용자 입력으로 채워짐) ──
  adSpend?: number;          // 월 광고비 (원)
  adRoas?: number;           // 광고 ROAS (%)
}

export interface SourcingAlert {
  product: string;
  issue: 'LOW_STOCK' | 'NO_WINNER' | 'CAMPAIGN_ENDING' | 'ZERO_SALES_30D';
  detail: string;
  action: string;
}

export interface CampaignSummary {
  totalBudget: number;
  totalRoas: number;
  activeCampaigns: number;
  blockedProducts: number;
}

export interface AdStrategyReport {
  collectedAt: string;
  urgentActions: UrgentAction[];
  productAdRanking: ProductAdGrade[];
  sourcingAlerts: SourcingAlert[];
  campaignSummary: CampaignSummary;
  summary: string;
}

export interface RawProduct {
  name: string;
  sellerProductId: string;
  isItemWinner: boolean;
  stock: number;
  salePrice: number;
  monthlySales: number;
  imageViolation: boolean;
  // ── 광고 성과 (광고센터 상품별 보고서에서 추가) ──
  adSpend?: number;    // 30일 광고비 합계 (원)
  adRoas?: number;     // 30일 ROAS (%)
  adOrders?: number;   // 30일 광고 전환 주문수
}

export interface RawCampaign {
  campaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  dailyBudget: number;
  roas: number;
  ctr: number;
  endDate?: string;
}

export interface CollectedData {
  products: RawProduct[];
  campaigns: RawCampaign[];
  collectedAt: string;
}

// ── 원가 스토어 (localStorage) ──
export interface CostEntry {
  productName: string;
  costPrice: number;   // 원가 (VAT 포함, 원)
  feeRate: number;     // 쿠팡 수수료율 (0~1, 기본 0.108)
}
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | head -20
```

오류 없이 (또는 기존 테스트 파일 오류만) 통과해야 한다.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/ad-strategy/types.ts
git commit -m "feat(ad-strategy): RawProduct·ProductAdGrade에 광고비/순이익 필드 추가"
```

---

## Task 2: net-profit.ts — 순이익 계산 순수 함수

**Files:**
- Create: `src/lib/ad-strategy/net-profit.ts`
- Create: `src/__tests__/lib/ad-strategy/net-profit.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/ad-strategy/net-profit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  calcNetProfit,
  calcBreakEvenRoas,
  calcMarginPerUnit,
} from '@/lib/ad-strategy/net-profit';

describe('calcMarginPerUnit', () => {
  it('판매가 30000, 원가 18000, 수수료 10.8%', () => {
    // 30000 × (1 - 0.108) - 18000 = 26760 - 18000 = 8760
    expect(calcMarginPerUnit(30000, 18000, 0.108)).toBe(8760);
  });

  it('원가가 판매가보다 크면 음수 마진', () => {
    expect(calcMarginPerUnit(10000, 12000, 0.108)).toBeLessThan(0);
  });
});

describe('calcBreakEvenRoas', () => {
  it('판매가 30000, 마진 8760 → (30000/8760)×1.1×100 ≈ 376', () => {
    const result = calcBreakEvenRoas(30000, 8760);
    expect(result).toBeCloseTo(376.7, 0);
  });

  it('마진 0이면 Infinity', () => {
    expect(calcBreakEvenRoas(30000, 0)).toBe(Infinity);
  });
});

describe('calcNetProfit', () => {
  it('월 판매 10건, 월 광고비 5000원, 마진 8760원/건', () => {
    // 건당 광고비 = 5000/10 = 500
    // 건당 순이익 = 8760 - 500 = 8260
    // 월 순이익 = 8260 × 10 = 82600
    const result = calcNetProfit({
      monthlySales: 10,
      monthlyAdSpend: 5000,
      marginPerUnit: 8760,
    });
    expect(result.perUnit).toBe(8260);
    expect(result.monthly).toBe(82600);
  });

  it('판매량 0이면 광고비 계산 불가 → perUnit = marginPerUnit', () => {
    const result = calcNetProfit({
      monthlySales: 0,
      monthlyAdSpend: 5000,
      marginPerUnit: 8760,
    });
    expect(result.perUnit).toBe(8760);
    expect(result.monthly).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/ad-strategy/net-profit.test.ts 2>&1 | tail -15
```

Expected: FAIL (함수 없음)

- [ ] **Step 3: 구현**

`src/lib/ad-strategy/net-profit.ts`:

```typescript
/** 건당 마진 = 판매가 × (1 - 수수료율) - 원가 */
export function calcMarginPerUnit(
  salePrice: number,
  costPrice: number,
  feeRate: number,
): number {
  return Math.round(salePrice * (1 - feeRate) - costPrice);
}

/**
 * 손익분기점 ROAS (부가세 보정 포함)
 * = (판매가 ÷ 마진) × 1.1 × 100
 * 마진 ≤ 0 이면 Infinity 반환
 */
export function calcBreakEvenRoas(salePrice: number, marginPerUnit: number): number {
  if (marginPerUnit <= 0) return Infinity;
  return (salePrice / marginPerUnit) * 1.1 * 100;
}

interface NetProfitInput {
  monthlySales: number;
  monthlyAdSpend: number;
  marginPerUnit: number;
}

interface NetProfitResult {
  perUnit: number;    // 건당 순이익 (원)
  monthly: number;    // 월 순이익 (원)
}

/**
 * 순이익 계산
 * - 판매량 0이면 광고비 안분 불가 → 건당 순이익 = 마진(광고비 미반영)
 */
export function calcNetProfit(input: NetProfitInput): NetProfitResult {
  const { monthlySales, monthlyAdSpend, marginPerUnit } = input;

  if (monthlySales === 0) {
    return { perUnit: marginPerUnit, monthly: 0 };
  }

  const adCostPerUnit = Math.round(monthlyAdSpend / monthlySales);
  const perUnit = marginPerUnit - adCostPerUnit;
  const monthly = perUnit * monthlySales;

  return { perUnit, monthly };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/ad-strategy/net-profit.test.ts 2>&1 | tail -10
```

Expected: 5 passed

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ad-strategy/net-profit.ts src/__tests__/lib/ad-strategy/net-profit.test.ts
git commit -m "feat(ad-strategy): 순이익/손익분기점 ROAS 계산 순수 함수"
```

---

## Task 3: use-cost-store.ts — 원가 localStorage hook

**Files:**
- Create: `src/lib/ad-strategy/use-cost-store.ts`

- [ ] **Step 1: hook 구현**

`src/lib/ad-strategy/use-cost-store.ts`:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CostEntry } from './types';

const STORAGE_KEY = 'ad_strategy_cost_entries';
const DEFAULT_FEE_RATE = 0.108; // 쿠팡 로켓그로스 기본 수수료

function loadEntries(): CostEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CostEntry[]) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: CostEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useCostStore() {
  const [entries, setEntries] = useState<CostEntry[]>([]);

  useEffect(() => {
    setEntries(loadEntries());
  }, []);

  const upsert = useCallback((productName: string, costPrice: number, feeRate?: number) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.productName !== productName);
      next.push({
        productName,
        costPrice,
        feeRate: feeRate ?? prev.find((e) => e.productName === productName)?.feeRate ?? DEFAULT_FEE_RATE,
      });
      saveEntries(next);
      return next;
    });
  }, []);

  const setFeeRate = useCallback((productName: string, feeRate: number) => {
    setEntries((prev) => {
      const entry = prev.find((e) => e.productName === productName);
      if (!entry) return prev;
      const next = prev.map((e) =>
        e.productName === productName ? { ...e, feeRate } : e,
      );
      saveEntries(next);
      return next;
    });
  }, []);

  const get = useCallback(
    (productName: string): CostEntry | undefined =>
      entries.find((e) => e.productName === productName),
    [entries],
  );

  return { entries, upsert, setFeeRate, get, DEFAULT_FEE_RATE };
}
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep "use-cost-store" | head -10
```

오류 없어야 한다.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/ad-strategy/use-cost-store.ts
git commit -m "feat(ad-strategy): 원가 localStorage hook (useCostStore)"
```

---

## Task 4: scraper.ts — 광고센터 상품별 보고서 추가 스크래핑

**Files:**
- Modify: `src/lib/ad-strategy/scraper.ts`

배경: 현재 `scrapeAdsCampaigns()`는 캠페인 목록 페이지를 스크래핑한다. 상품별 광고비/ROAS는 광고센터의 **"상품 보고서"** 페이지(`/marketing/report/product`)에 있다. 이 함수를 추가하고 `scrapeAdData()`에서 병렬 호출한다.

- [ ] **Step 1: `scrapeAdProductReport` 함수 추가**

`src/lib/ad-strategy/scraper.ts` 의 `export async function scrapeAdData()` 위에 아래 함수를 추가한다:

```typescript
interface ProductAdStat {
  name: string;
  adSpend: number;   // 원
  adRoas: number;    // %
  adOrders: number;
}

async function scrapeAdProductReport(): Promise<ProductAdStat[]> {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) {
    console.warn('[scraper] COUPANG_ADS_COOKIE 미설정 — 상품별 광고 데이터 없이 진행');
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext();

    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        const name = c.slice(0, eqIdx).trim();
        const value = c.slice(eqIdx + 1).trim();
        return { name, value, domain: '.advertising.coupang.com', path: '/' };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0);

    await context.addCookies(cookiePairs);

    const page = await context.newPage();

    // 30일 상품별 보고서 페이지
    await page.goto(
      'https://advertising.coupang.com/marketing/report/product?period=30d',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );

    if (page.url().includes('login') || page.url().includes('sign-in')) {
      console.warn('[scraper] 광고센터 세션 만료 — 상품별 광고 데이터 없이 진행');
      return [];
    }

    // 테이블 로드 대기 (최대 15초, 없으면 빈 배열)
    await page
      .waitForSelector('table tbody tr', { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(2_000);

    const stats = await page.evaluate((): ProductAdStat[] => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) return null;

          // 상품명: 첫 번째 셀 (또는 a 태그 텍스트)
          const nameEl = row.querySelector('a') ?? cells[0];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          const allText = row.textContent ?? '';

          // 광고비: "N원" 또는 숫자+원 패턴
          const spendMatch = allText.match(/([0-9,]+)\s*원/);
          const adSpend = spendMatch
            ? parseInt(spendMatch[1].replace(/,/g, ''), 10)
            : 0;

          // ROAS: "N%" 패턴
          const roasMatch = allText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
          const adRoas = roasMatch ? parseFloat(roasMatch[1]) : 0;

          // 전환 주문수: 마지막 숫자 셀에서
          const orderMatch = allText.match(/전환[^0-9]*([0-9]+)/);
          const adOrders = orderMatch ? parseInt(orderMatch[1], 10) : 0;

          return { name, adSpend, adRoas, adOrders } satisfies ProductAdStat;
        })
        .filter((s): s is ProductAdStat => s !== null && s.name.length > 0);
    });

    await page.close();
    return stats;
  } catch (err) {
    console.warn('[scraper] 상품별 광고 보고서 스크래핑 실패 (무시):', err);
    return [];
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: `scrapeAdData()` 에서 병렬 호출 + 상품별 매핑**

기존 `scrapeAdData()` 함수를 아래로 교체한다:

```typescript
export async function scrapeAdData(): Promise<CollectedData> {
  const [products, campaigns, adStats] = await Promise.all([
    scrapeWingProducts(),
    scrapeAdsCampaigns(),
    scrapeAdProductReport(),
  ]);

  // 상품명 부분 매칭으로 광고 성과 주입
  for (const product of products) {
    const stat = adStats.find(
      (s) =>
        product.name.includes(s.name) ||
        s.name.includes(product.name) ||
        levenshteinSimilar(product.name, s.name),
    );
    if (stat) {
      product.adSpend = stat.adSpend;
      product.adRoas = stat.adRoas;
      product.adOrders = stat.adOrders;
    }
  }

  return { products, campaigns, collectedAt: new Date().toISOString() };
}

/** 두 문자열이 70% 이상 유사하면 true (앞 10자 기준 단순 비교) */
function levenshteinSimilar(a: string, b: string): boolean {
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  const prefix = short.slice(0, 10);
  return long.includes(prefix);
}
```

- [ ] **Step 3: 빌드 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep "scraper" | head -10
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/ad-strategy/scraper.ts
git commit -m "feat(ad-strategy): 광고센터 상품별 보고서 스크래핑 + 상품 매핑"
```

---

## Task 5: analyzer-prompt.ts — 광고비/ROAS 데이터 프롬프트 반영

**Files:**
- Modify: `src/lib/ad-strategy/analyzer-prompt.ts`

`ProductAdGrade`에 `adSpend`, `adRoas` 필드가 추가됐으므로, AI가 이를 출력 JSON에 포함하도록 프롬프트를 업데이트한다.

- [ ] **Step 1: `buildAdStrategyUserPrompt` 출력 스키마에 adSpend/adRoas 추가**

`analyzer-prompt.ts`의 `buildAdStrategyUserPrompt` 함수 내 JSON 스키마 부분에서 `productAdRanking` 배열 항목을 아래로 교체한다:

```typescript
// 기존
`    {
      "name": "상품명",
      "grade": "A | B | C | HOLD",
      "isItemWinner": true,
      "monthlySales": 8,
      "stock": 23,
      "currentPrice": 29900,
      "reason": "등급 이유 1문장",
      "suggestedDailyBudget": 5000
    }`

// 교체 후
`    {
      "name": "상품명",
      "grade": "A | B | C | HOLD",
      "isItemWinner": true,
      "monthlySales": 8,
      "stock": 23,
      "currentPrice": 29900,
      "reason": "등급 이유 1문장",
      "suggestedDailyBudget": 5000,
      "adSpend": 45000,
      "adRoas": 320
    }`
```

`AD_STRATEGY_SYSTEM_PROMPT` 에도 아래 규칙을 추가한다 (기존 `# 출력 규칙` 뒤):

```
8. **adSpend/adRoas 반영**: 수집 데이터에 adSpend가 있으면 productAdRanking에 그대로 포함. 없으면 생략(null 아닌 omit).
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep "analyzer-prompt" | head -5
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/ad-strategy/analyzer-prompt.ts
git commit -m "feat(ad-strategy): 프롬프트에 상품별 adSpend/adRoas 반영"
```

---

## Task 6: ProductAdTable.tsx — 순이익 컬럼 + 원가 인라인 입력

**Files:**
- Modify: `src/components/ad-strategy/ProductAdTable.tsx`

순이익 계산에 필요한 원가를 각 상품 행 안에서 직접 입력할 수 있게 한다. 수수료율은 전역 기본값(10.8%)을 쓰되 행별로 오버라이드 가능.

- [ ] **Step 1: ProductAdTable 전체 교체**

`src/components/ad-strategy/ProductAdTable.tsx` 전체를 아래로 교체한다:

```tsx
'use client';

import React, { useState } from 'react';
import type { ProductAdGrade, AdGrade } from '@/lib/ad-strategy/types';
import { useCostStore } from '@/lib/ad-strategy/use-cost-store';
import {
  calcMarginPerUnit,
  calcBreakEvenRoas,
  calcNetProfit,
} from '@/lib/ad-strategy/net-profit';

const GRADE_COLOR: Record<AdGrade, string> = {
  A: '#059669',
  B: '#2563eb',
  C: '#d97706',
  HOLD: '#6b7280',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

function ProfitCell({ value, monthly }: { value: number; monthly: number }) {
  const color = value >= 0 ? '#059669' : '#dc2626';
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 700, color, fontSize: '13px' }}>
        {value >= 0 ? '+' : ''}{fmt(value)}원
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
        월 {monthly >= 0 ? '+' : ''}{fmt(monthly)}원
      </div>
    </div>
  );
}

function RoasCell({ actual, breakEven }: { actual?: number; breakEven: number }) {
  if (!actual) return <span style={{ color: '#9ca3af' }}>-</span>;
  const ok = actual >= breakEven;
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 700, color: ok ? '#059669' : '#dc2626', fontSize: '13px' }}>
        {fmt(actual)}%
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af' }}>손익 {fmt(Math.round(breakEven))}%</div>
    </div>
  );
}

function CostInput({
  productName,
  initialCost,
  onSave,
}: {
  productName: string;
  initialCost?: number;
  onSave: (cost: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialCost ? String(initialCost) : '');

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          background: 'none',
          border: '1px dashed #d1d5db',
          borderRadius: '4px',
          padding: '3px 8px',
          fontSize: '12px',
          color: initialCost ? '#374151' : '#9ca3af',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {initialCost ? `${fmt(initialCost)}원` : '원가 입력'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = parseInt(draft, 10);
            if (!isNaN(v) && v > 0) { onSave(v); setEditing(false); }
          }
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="VAT포함 원가"
        style={{
          width: '90px',
          padding: '3px 6px',
          fontSize: '12px',
          border: '1px solid #6366f1',
          borderRadius: '4px',
          outline: 'none',
        }}
      />
      <button
        onClick={() => {
          const v = parseInt(draft, 10);
          if (!isNaN(v) && v > 0) { onSave(v); setEditing(false); }
        }}
        style={{
          padding: '3px 8px',
          fontSize: '11px',
          background: '#6366f1',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        저장
      </button>
    </div>
  );
}

export default function ProductAdTable({ products }: { products: ProductAdGrade[] }) {
  const { get, upsert, DEFAULT_FEE_RATE } = useCostStore();

  if (products.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>등급 데이터 없음</p>;
  }

  const headers = [
    '등급', '상품명', '위너', '30일 판매', '재고',
    '원가 입력', '건당 순이익', '실ROAS/손익기준', '권장 일예산', '이유',
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const entry = get(p.name);
            const costPrice = entry?.costPrice;
            const feeRate = entry?.feeRate ?? DEFAULT_FEE_RATE;

            let profitCell: React.ReactNode = (
              <span style={{ color: '#9ca3af', fontSize: '12px' }}>원가 입력 후 계산</span>
            );
            let roasCell: React.ReactNode = <span style={{ color: '#9ca3af' }}>-</span>;

            if (costPrice !== undefined) {
              const margin = calcMarginPerUnit(p.currentPrice, costPrice, feeRate);
              const breakEven = calcBreakEvenRoas(p.currentPrice, margin);
              const { perUnit, monthly } = calcNetProfit({
                monthlySales: p.monthlySales,
                monthlyAdSpend: p.adSpend ?? 0,
                marginPerUnit: margin,
              });
              profitCell = <ProfitCell value={perUnit} monthly={monthly} />;
              roasCell = <RoasCell actual={p.adRoas} breakEven={breakEven} />;
            }

            return (
              <tr
                key={p.name + i}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                }}
              >
                <td style={{ padding: '10px 12px' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: GRADE_COLOR[p.grade],
                      background: `${GRADE_COLOR[p.grade]}18`,
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    {p.grade}
                  </span>
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: '#111',
                    fontWeight: 500,
                    maxWidth: '200px',
                    wordBreak: 'keep-all',
                  }}
                >
                  {p.name}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: p.isItemWinner ? '#059669' : '#dc2626',
                    fontWeight: 600,
                  }}
                >
                  {p.isItemWinner ? 'O' : 'X'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.monthlySales}건</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock}개</td>
                <td style={{ padding: '10px 12px' }}>
                  <CostInput
                    productName={p.name}
                    initialCost={costPrice}
                    onSave={(cost) => upsert(p.name, cost)}
                  />
                </td>
                <td style={{ padding: '10px 12px' }}>{profitCell}</td>
                <td style={{ padding: '10px 12px' }}>{roasCell}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {p.suggestedDailyBudget ? fmt(p.suggestedDailyBudget) + '원' : '-'}
                </td>
                <td style={{ padding: '10px 12px', color: '#6b7280', maxWidth: '220px' }}>
                  {p.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ProductAdTable" | head -10
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/ad-strategy/ProductAdTable.tsx
git commit -m "feat(ad-strategy): 순이익 컬럼 + 원가 인라인 입력 UI"
```

---

## Task 7: AdStrategyPanel.tsx — 전역 수수료율 설정 UI

**Files:**
- Modify: `src/components/ad-strategy/AdStrategyPanel.tsx`

분석 완료 후 "수수료율 기본값 설정" 토글 UI를 헤더 영역 아래에 추가한다. 설정값은 `useCostStore`의 `setFeeRate`와는 별개로, 전역 override용 `localStorage` 키(`ad_strategy_global_fee_rate`)로 관리한다. `ProductAdTable`은 이미 `useCostStore`에서 `DEFAULT_FEE_RATE`(0.108)를 사용하므로, 여기서는 사용자에게 전역 수수료율을 표시하는 정보 배너만 추가한다.

- [ ] **Step 1: 수수료율 배너 추가**

`AdStrategyPanel.tsx`의 `{/* 빈 상태 */}` 섹션 바로 위에 아래 JSX를 삽입한다:

```tsx
{/* 순이익 계산 안내 배너 */}
<div
  style={{
    padding: '12px 16px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#1d4ed8',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  }}
>
  <span style={{ fontWeight: 600 }}>순이익 계산 방법:</span>
  <span>
    상품별 <strong>원가(VAT포함)</strong>를 테이블에서 직접 입력하면
    건당 순이익 · 월 순이익 · 손익분기점 ROAS가 자동 계산됩니다.
  </span>
  <span style={{ color: '#6b7280', fontSize: '12px' }}>
    수수료율 기본값: 10.8% (로켓그로스) | 원가는 브라우저에 저장됩니다
  </span>
</div>
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npx next build 2>&1 | tail -10
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/ad-strategy/AdStrategyPanel.tsx
git commit -m "feat(ad-strategy): 순이익 계산 안내 배너 추가"
```

---

## Task 8: 통합 확인 및 최종 빌드

- [ ] **Step 1: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/lib/ad-strategy/ 2>&1 | tail -15
```

Expected: net-profit.test.ts 5 passed (기존 analyzer-prompt.test.ts는 pre-existing 오류)

- [ ] **Step 2: 전체 빌드**

```bash
npx next build 2>&1 | tail -15
```

Expected: `/ad-strategy` 경로 빌드 성공

- [ ] **Step 3: 개발 서버에서 수동 확인 체크리스트**

```bash
npx next dev
```

1. `/ad-strategy` 접속
2. "분석 시작" 클릭 → 수집·분석 완료 후 테이블 렌더링 확인
3. 상품 행의 **원가 입력** 버튼 클릭 → 숫자 입력 → Enter → 값 저장 확인
4. 건당 순이익 / 월 순이익 / 실ROAS/손익기준 컬럼 값 확인
5. 페이지 새로고침 후 원가값 복원 확인 (localStorage)
6. 광고비 없는 상품(adSpend=undefined) → 순이익 = 마진만 표시 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat(ad-strategy): 상품별 순이익 계산 기능 완성 (B안 자동화)"
```

---

## Self-Review

### Spec 커버리지 확인

| 요구사항 | 구현 태스크 |
|---|---|
| Wing 판매량 스크래핑 | collect/route.ts가 이미 CoupangClient 주문 API로 처리 → 별도 태스크 불필요 |
| 광고센터 상품별 ROAS/광고비 | Task 4 (scraper.ts 확장) |
| 원가 입력 UI | Task 6 (ProductAdTable CostInput) |
| 순이익 계산 공식 | Task 2 (net-profit.ts) |
| 손익분기점 ROAS | Task 2 (calcBreakEvenRoas) |
| 부가세 보정 포함 | Task 2 (×1.1 공식) |
| 데이터 영속성 | Task 3 (useCostStore localStorage) |
| UI 표시 (건당/월 순이익, ROAS 비교) | Task 6 (ProfitCell, RoasCell) |

### 타입 일관성 확인

- `CostEntry` — Task 1에서 정의, Task 3·6에서 사용 ✓
- `calcMarginPerUnit / calcBreakEvenRoas / calcNetProfit` — Task 2에서 정의, Task 6에서 import ✓
- `useCostStore` — Task 3에서 정의, Task 6에서 import ✓
- `ProductAdGrade.adSpend / adRoas` — Task 1에서 정의, Task 5·6에서 사용 ✓
- `RawProduct.adSpend / adRoas / adOrders` — Task 1에서 정의, Task 4 스크래퍼에서 주입 ✓
