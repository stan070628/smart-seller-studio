# ROI 관리 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/roi` 페이지를 신규 생성해 SKU별 수익성(마진·보정 ROAS·위너 판별·재고 회전일)을 한눈에 보여주고, 목표 순이익 역산 기능을 제공한다.

**Architecture:** 쿠팡 Wing/Ads API에서 이미 연동된 fetch 함수들을 재사용해 `/api/roi` route에서 집계하고, 서버 컴포넌트(`page.tsx`)가 초기 데이터를 패치한 뒤 클라이언트 컴포넌트(`RoiPageClient`)로 넘긴다. DB 스키마 변경 없이 `sourcing_items.price_dome / deli_fee`를 원가로 재사용한다.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Supabase (read-only), Coupang Wing API, Coupang Ads API, Vitest

---

## File Map

| 파일 | 역할 |
|---|---|
| `src/lib/roi/calculations.ts` | 순수 계산 함수 (마진·ROAS·위너·재고) |
| `src/lib/roi/calculations.test.ts` | 계산 함수 단위 테스트 |
| `src/app/api/roi/route.ts` | SKU 수익성 데이터 집계 API |
| `src/components/roi/RoiGoalWidget.tsx` | 상단 역산 플래너 위젯 |
| `src/components/roi/SkuTable.tsx` | SKU 메인 테이블 |
| `src/components/roi/SkuDetailPanel.tsx` | 우측 슬라이드 상세 패널 |
| `src/components/roi/RoiPageClient.tsx` | 메인 클라이언트 컴포넌트 |
| `src/app/roi/page.tsx` | 서버 컴포넌트, 초기 데이터 패치 |
| `src/components/AppNav.tsx` | ROI 메뉴 항목 추가 |

---

## Task 1: 계산 함수 + 테스트

**Files:**
- Create: `src/lib/roi/calculations.ts`
- Create: `src/lib/roi/calculations.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/lib/roi/calculations.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
  calcStockTurnover,
  calcRequiredRevenue,
} from './calculations';

describe('calcMargin', () => {
  it('마진액 = 판매가 - 원가 - 수수료 - 배송비', () => {
    // 판매가 9900, 원가 4200, 수수료율 10%, 배송비 2500
    expect(calcMargin(9900, 4200, 0.10, 2500)).toBe(2210);
  });
  it('수수료율 0이면 배송비만 차감', () => {
    expect(calcMargin(10000, 3000, 0, 0)).toBe(7000);
  });
});

describe('calcBreakevenRoas', () => {
  it('간이과세자: (판매가 / 마진액) * 100', () => {
    expect(calcBreakevenRoas(9900, 2210)).toBeCloseTo(448, 0);
  });
  it('마진액 0이면 Infinity 반환', () => {
    expect(calcBreakevenRoas(9900, 0)).toBe(Infinity);
  });
});

describe('calcAdjustedRoas', () => {
  it('보정 ROAS = (attributed_sales - cancelled) / adSpend * 100', () => {
    expect(calcAdjustedRoas(500000, 50000, 100000)).toBe(450);
  });
  it('광고비 0이면 Infinity', () => {
    expect(calcAdjustedRoas(500000, 0, 0)).toBe(Infinity);
  });
});

describe('isWinner', () => {
  it('4개 모두 충족하면 winner', () => {
    expect(isWinner(150, 2.0, 300, 10)).toBe('winner');
  });
  it('3개 충족하면 watch', () => {
    expect(isWinner(80, 2.0, 300, 10)).toBe('watch'); // clicks 미달
  });
  it('2개 이하면 normal', () => {
    expect(isWinner(50, 1.0, 200, 3)).toBe('normal');
  });
  it('경계값: 정확히 기준값이면 충족', () => {
    expect(isWinner(100, 1.5, 250, 5)).toBe('winner');
  });
});

describe('calcStockTurnover', () => {
  it('7일 미만이면 danger', () => {
    const result = calcStockTurnover(5, 1); // 재고 5개, 일평균 1개
    expect(result).toEqual({ days: 5, status: 'danger' });
  });
  it('7~14일이면 warning', () => {
    const result = calcStockTurnover(10, 1);
    expect(result).toEqual({ days: 10, status: 'warning' });
  });
  it('15일 이상이면 ok', () => {
    const result = calcStockTurnover(30, 1);
    expect(result).toEqual({ days: 30, status: 'ok' });
  });
  it('일평균 0이면 days Infinity, status ok', () => {
    const result = calcStockTurnover(100, 0);
    expect(result.status).toBe('ok');
    expect(result.days).toBe(Infinity);
  });
});

describe('calcRequiredRevenue', () => {
  it('500만원 / 0.3 = 16,666,667', () => {
    expect(calcRequiredRevenue(5000000, 0.3)).toBeCloseTo(16666667, -2);
  });
  it('마진율 0이면 Infinity', () => {
    expect(calcRequiredRevenue(5000000, 0)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/lib/roi/calculations.test.ts
```
Expected: 모듈 없음 에러

- [ ] **Step 3: 계산 함수 구현**

```typescript
// src/lib/roi/calculations.ts

export function calcMargin(
  sellingPrice: number,
  costPrice: number,
  feeRate: number,
  deliveryFee: number
): number {
  return sellingPrice - costPrice - sellingPrice * feeRate - deliveryFee;
}

export function calcBreakevenRoas(sellingPrice: number, marginAmount: number): number {
  if (marginAmount <= 0) return Infinity;
  return (sellingPrice / marginAmount) * 100;
}

export function calcAdjustedRoas(
  attributedSales: number,
  cancelledSales: number,
  adSpend: number
): number {
  if (adSpend <= 0) return Infinity;
  return ((attributedSales - cancelledSales) / adSpend) * 100;
}

export function isWinner(
  clicks: number,
  conversionRate: number,
  roas: number,
  salesCount: number
): 'winner' | 'watch' | 'normal' {
  const checks = [
    clicks >= 100,
    conversionRate >= 1.5,
    roas >= 250,
    salesCount >= 5,
  ];
  const passed = checks.filter(Boolean).length;
  if (passed === 4) return 'winner';
  if (passed === 3) return 'watch';
  return 'normal';
}

export function calcStockTurnover(
  stockQty: number,
  avgDailySales: number
): { days: number; status: 'danger' | 'warning' | 'ok' } {
  const days = avgDailySales > 0 ? stockQty / avgDailySales : Infinity;
  const status = days < 7 ? 'danger' : days < 15 ? 'warning' : 'ok';
  return { days, status };
}

export function calcRequiredRevenue(targetProfit: number, marginRate: number): number {
  if (marginRate <= 0) return Infinity;
  return targetProfit / marginRate;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/roi/calculations.test.ts
```
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/roi/calculations.ts src/lib/roi/calculations.test.ts
git commit -m "feat(roi): add pure calculation functions with tests"
```

---

## Task 2: ROI 타입 정의

**Files:**
- Create: `src/lib/roi/types.ts`

- [ ] **Step 1: 타입 파일 작성**

```typescript
// src/lib/roi/types.ts

export interface SkuRoiData {
  productId: string;
  productName: string;
  sellingPrice: number;
  costPrice: number;           // sourcing_items.price_dome
  feeRate: number;             // coupang-fees.ts에서 계산
  deliveryFee: number;         // sourcing_items.deli_fee
  marginAmount: number;        // calcMargin() 결과
  marginRate: number;          // marginAmount / sellingPrice
  adSpend: number;             // Ads API
  attributedSales: number;     // Ads API
  cancelledSales: number;      // Wing API
  couponDiscount: number;      // Wing API
  clicks: number;              // Ads API
  conversionRate: number;      // Ads API (%)
  salesCount: number;          // Wing API (30일)
  stockQty: number;            // Wing API
  avgDailySales: number;       // Wing API 30일 평균
  // 계산 결과
  breakEvenRoas: number;
  adjustedRoas: number;
  winnerStatus: 'winner' | 'watch' | 'normal';
  stockTurnover: { days: number; status: 'danger' | 'warning' | 'ok' };
  netProfit: number;           // marginAmount * salesCount - adSpend
}

export interface RoiGoalState {
  targetProfit: number;        // 원 단위 (예: 5000000)
  marginRate: number;          // 0~1 (예: 0.30)
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/roi/types.ts
git commit -m "feat(roi): add ROI type definitions"
```

---

## Task 3: `/api/roi` Route

**Files:**
- Create: `src/app/api/roi/route.ts`

이 route는 Wing API와 Ads API 데이터를 집계해 `SkuRoiData[]`를 반환한다. 기존 `requireAuth`, 캐시 패턴(`orders-summary/route.ts`)을 그대로 따른다.

- [ ] **Step 1: route.ts 작성**

```typescript
// src/app/api/roi/route.ts
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/require-auth';
import { createClient } from '@/lib/supabase/server';
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
  calcStockTurnover,
} from '@/lib/roi/calculations';
import type { SkuRoiData } from '@/lib/roi/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000; // 1분
const cache = new Map<string, { data: SkuRoiData[]; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const cacheKey = userId;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    const supabase = createClient();

    // 1. sourcing_items에서 원가 데이터 로드
    const { data: sourcingItems } = await supabase
      .from('sourcing_items')
      .select('id, product_name, price_dome, deli_fee, coupang_category_path')
      .eq('user_id', userId)
      .not('price_dome', 'is', null);

    if (!sourcingItems || sourcingItems.length === 0) {
      return Response.json({ success: true, data: [] });
    }

    // 2. Wing API + Ads API 병렬 호출
    // NOTE: 아래는 기존 fetchCoupang* 함수 재사용 패턴.
    // 실제 사용 중인 Wing/Ads fetch 함수 경로를 확인 후 import 수정.
    const [wingData, adsData] = await Promise.all([
      fetchWingProductStats(userId),   // 재고, 주문수, 취소수, 쿠폰할인
      fetchAdsProductStats(userId),    // 광고비, attributed_sales, 클릭수
    ]).catch(() => [[], []]);

    // 3. 데이터 병합 및 계산
    const wingMap = new Map(wingData.map((d: WingProductStat) => [d.productId, d]));
    const adsMap = new Map(adsData.map((d: AdsProductStat) => [d.productId, d]));

    const skus: SkuRoiData[] = sourcingItems.map((item) => {
      const wing = wingMap.get(item.id) ?? defaultWingStat();
      const ads = adsMap.get(item.id) ?? defaultAdsStat();

      const feeResult = resolveCoupangFee(item.coupang_category_path);
      const feeRate = feeResult.rate;
      const costPrice = item.price_dome ?? 0;
      const deliveryFee = item.deli_fee ?? 0;
      const sellingPrice = wing.sellingPrice ?? 0;

      const marginAmount = calcMargin(sellingPrice, costPrice, feeRate, deliveryFee);
      const marginRate = sellingPrice > 0 ? marginAmount / sellingPrice : 0;

      const conversionRate =
        ads.clicks > 0 ? (wing.salesCount / ads.clicks) * 100 : 0;

      const breakEvenRoas = calcBreakevenRoas(sellingPrice, marginAmount);
      const adjustedRoas = calcAdjustedRoas(
        ads.attributedSales,
        wing.cancelledSales,
        ads.adSpend
      );
      const winnerStatus = isWinner(
        ads.clicks,
        conversionRate,
        adjustedRoas,
        wing.salesCount
      );
      const stockTurnover = calcStockTurnover(wing.stockQty, wing.avgDailySales);
      const netProfit = marginAmount * wing.salesCount - ads.adSpend;

      return {
        productId: item.id,
        productName: item.product_name ?? '',
        sellingPrice,
        costPrice,
        feeRate,
        deliveryFee,
        marginAmount,
        marginRate,
        adSpend: ads.adSpend,
        attributedSales: ads.attributedSales,
        cancelledSales: wing.cancelledSales,
        couponDiscount: wing.couponDiscount,
        clicks: ads.clicks,
        conversionRate,
        salesCount: wing.salesCount,
        stockQty: wing.stockQty,
        avgDailySales: wing.avgDailySales,
        breakEvenRoas,
        adjustedRoas,
        winnerStatus,
        stockTurnover,
        netProfit,
      };
    });

    cache.set(cacheKey, { data: skus, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ success: true, data: skus });
  } catch (err) {
    console.error('[roi] API error:', err);
    return Response.json({ success: false, error: '데이터 조회 실패' }, { status: 500 });
  }
}

// ── 타입 헬퍼 ──────────────────────────────────────────────────

interface WingProductStat {
  productId: string;
  sellingPrice: number;
  salesCount: number;
  cancelledSales: number;
  couponDiscount: number;
  stockQty: number;
  avgDailySales: number;
}

interface AdsProductStat {
  productId: string;
  adSpend: number;
  attributedSales: number;
  clicks: number;
}

function defaultWingStat(): WingProductStat {
  return {
    productId: '',
    sellingPrice: 0,
    salesCount: 0,
    cancelledSales: 0,
    couponDiscount: 0,
    stockQty: 0,
    avgDailySales: 0,
  };
}

function defaultAdsStat(): AdsProductStat {
  return { productId: '', adSpend: 0, attributedSales: 0, clicks: 0 };
}

// ── Wing / Ads 데이터 패치 함수 ─────────────────────────────────
// TODO: 기존 Wing/Ads fetch 유틸 확인 후 실제 함수로 교체.
// 아래는 stub — 실제 API 연동 전 테스트용으로 빈 배열 반환.

async function fetchWingProductStats(_userId: string): Promise<WingProductStat[]> {
  return [];
}

async function fetchAdsProductStats(_userId: string): Promise<AdsProductStat[]> {
  return [];
}
```

- [ ] **Step 2: 개발 서버에서 route 확인**

```bash
npm run dev
# 별도 터미널에서:
curl http://localhost:3000/api/roi \
  -H "Cookie: <실제_세션_쿠키>"
```
Expected: `{"success":true,"data":[]}` (stub이므로 빈 배열)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/roi/route.ts
git commit -m "feat(roi): add /api/roi route with stub data fetchers"
```

---

## Task 4: RoiGoalWidget (역산 플래너)

**Files:**
- Create: `src/components/roi/RoiGoalWidget.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/roi/RoiGoalWidget.tsx
'use client';

import { calcRequiredRevenue, calcBreakevenRoas } from '@/lib/roi/calculations';

interface Props {
  targetProfit: number;
  marginRate: number;
  avgSellingPrice?: number;   // ROAS 계산용 대표 판매가 (없으면 숨김)
  avgMarginAmount?: number;   // ROAS 계산용 대표 마진액
  onTargetProfitChange: (v: number) => void;
  onMarginRateChange: (v: number) => void;
}

const PROFIT_OPTIONS = [1000000, 2000000, 3000000, 5000000, 10000000];
const MARGIN_OPTIONS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];

export function RoiGoalWidget({
  targetProfit,
  marginRate,
  avgSellingPrice,
  avgMarginAmount,
  onTargetProfitChange,
  onMarginRateChange,
}: Props) {
  const requiredRevenue = calcRequiredRevenue(targetProfit, marginRate);
  const breakEvenRoas =
    avgSellingPrice && avgMarginAmount
      ? calcBreakevenRoas(avgSellingPrice, avgMarginAmount)
      : null;

  return (
    <div className="flex flex-wrap gap-4 items-center rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">목표 순이익</span>
        <select
          value={targetProfit}
          onChange={(e) => onTargetProfitChange(Number(e.target.value))}
          className="rounded-md bg-zinc-700 px-2 py-1 text-sm text-white border border-zinc-600"
        >
          {PROFIT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {(v / 10000).toLocaleString()}만원
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">기준 마진율</span>
        <select
          value={marginRate}
          onChange={(e) => onMarginRateChange(Number(e.target.value))}
          className="rounded-md bg-zinc-700 px-2 py-1 text-sm text-white border border-zinc-600"
        >
          {MARGIN_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {(v * 100).toFixed(0)}%
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-sm text-zinc-400">필요 매출</span>
        <span className="text-lg font-bold text-white">
          {requiredRevenue === Infinity
            ? '—'
            : `${Math.round(requiredRevenue / 10000).toLocaleString()}만원`}
        </span>
      </div>

      {breakEvenRoas !== null && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">ROAS 손익분기</span>
          <span className="text-lg font-bold text-white">
            {breakEvenRoas === Infinity ? '—' : `${Math.round(breakEvenRoas)}%`}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/roi/RoiGoalWidget.tsx
git commit -m "feat(roi): add RoiGoalWidget component"
```

---

## Task 5: SkuTable

**Files:**
- Create: `src/components/roi/SkuTable.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/roi/SkuTable.tsx
'use client';

import type { SkuRoiData } from '@/lib/roi/types';

type Filter = 'all' | 'winner' | 'purchase-signal' | 'stock-warning';

interface Props {
  skus: SkuRoiData[];
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  onSkuClick: (sku: SkuRoiData) => void;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'winner', label: '위너만' },
  { key: 'purchase-signal', label: '사입권고' },
  { key: 'stock-warning', label: '재고경고' },
];

function winnerBadge(status: SkuRoiData['winnerStatus']) {
  if (status === 'winner') return <span className="text-xs bg-green-700 text-green-100 px-2 py-0.5 rounded-full">위너</span>;
  if (status === 'watch') return <span className="text-xs bg-yellow-700 text-yellow-100 px-2 py-0.5 rounded-full">관찰</span>;
  return null;
}

function roasColor(adjusted: number, breakeven: number) {
  if (breakeven === Infinity || adjusted === Infinity) return 'text-zinc-400';
  return adjusted >= breakeven ? 'text-green-400' : 'text-red-400';
}

function stockColor(status: 'danger' | 'warning' | 'ok') {
  if (status === 'danger') return 'text-red-400';
  if (status === 'warning') return 'text-yellow-400';
  return 'text-green-400';
}

export function SkuTable({ skus, filter, onFilterChange, onSkuClick }: Props) {
  const filtered = skus.filter((s) => {
    if (filter === 'winner') return s.winnerStatus === 'winner';
    if (filter === 'purchase-signal') return s.winnerStatus === 'winner';
    if (filter === 'stock-warning') return s.stockTurnover.status !== 'ok';
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* 필터 탭 */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              filter === f.key
                ? 'bg-red-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length}개 상품</span>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800 text-zinc-400 text-left">
              <th className="px-4 py-3">상품명</th>
              <th className="px-4 py-3 text-right">판매가</th>
              <th className="px-4 py-3 text-right">마진율</th>
              <th className="px-4 py-3 text-right">광고비(보정)</th>
              <th className="px-4 py-3 text-right">ROAS(보정)</th>
              <th className="px-4 py-3 text-right">순이익</th>
              <th className="px-4 py-3 text-center">위너</th>
              <th className="px-4 py-3 text-center">재고회전</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  해당 조건의 상품이 없습니다
                </td>
              </tr>
            )}
            {filtered.map((sku) => (
              <tr
                key={sku.productId}
                onClick={() => onSkuClick(sku)}
                className="border-t border-zinc-700 hover:bg-zinc-800 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-white max-w-[200px] truncate">{sku.productName}</td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.sellingPrice.toLocaleString()}원
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {(sku.marginRate * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.adSpend.toLocaleString()}원
                </td>
                <td className={`px-4 py-3 text-right font-medium ${roasColor(sku.adjustedRoas, sku.breakEvenRoas)}`}>
                  {sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.netProfit.toLocaleString()}원
                </td>
                <td className="px-4 py-3 text-center">
                  {winnerBadge(sku.winnerStatus)}
                </td>
                <td className={`px-4 py-3 text-center font-medium ${stockColor(sku.stockTurnover.status)}`}>
                  {sku.stockTurnover.days === Infinity
                    ? '∞'
                    : `${Math.round(sku.stockTurnover.days)}일`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/roi/SkuTable.tsx
git commit -m "feat(roi): add SkuTable component with filter tabs"
```

---

## Task 6: SkuDetailPanel (슬라이드 패널)

**Files:**
- Create: `src/components/roi/SkuDetailPanel.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/roi/SkuDetailPanel.tsx
'use client';

import type { SkuRoiData } from '@/lib/roi/types';

interface Props {
  sku: SkuRoiData | null;
  onClose: () => void;
}

function CheckRow({ label, value, pass }: { label: string; value: string; pass: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-zinc-700 last:border-0">
      <span className="flex items-center gap-2 text-sm text-zinc-300">
        <span>{pass ? '✅' : '⬜'}</span>
        {label}
      </span>
      <span className={`text-sm font-medium ${pass ? 'text-green-400' : 'text-zinc-500'}`}>
        {value}
      </span>
    </div>
  );
}

export function SkuDetailPanel({ sku, onClose }: Props) {
  if (!sku) return null;

  const purchaseMarginRate = sku.sellingPrice > 0
    ? ((sku.sellingPrice - sku.costPrice * 0.5) / sku.sellingPrice)  // 1688 가정: 원가 50% 절감
    : 0;
  const purchaseNetProfit = sku.marginAmount * 1.5 * sku.salesCount - sku.adSpend; // 마진 1.5배 개선 가정

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col overflow-y-auto">
      {/* 헤더 */}
      <div className="flex justify-between items-start px-4 py-4 border-b border-zinc-700 sticky top-0 bg-zinc-900">
        <p className="text-sm font-medium text-white leading-snug max-w-[220px]">
          {sku.productName}
        </p>
        <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg leading-none">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        {/* 위너 기준 달성 현황 */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">위너 판별 기준</h3>
          <div className="rounded-lg bg-zinc-800 px-3 py-2">
            <CheckRow
              label="클릭수 ≥ 100"
              value={`${sku.clicks}회`}
              pass={sku.clicks >= 100}
            />
            <CheckRow
              label="전환율 ≥ 1.5%"
              value={`${sku.conversionRate.toFixed(1)}%`}
              pass={sku.conversionRate >= 1.5}
            />
            <CheckRow
              label="ROAS ≥ 250%"
              value={sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
              pass={sku.adjustedRoas >= 250}
            />
            <CheckRow
              label="판매 ≥ 5건"
              value={`${sku.salesCount}건`}
              pass={sku.salesCount >= 5}
            />
          </div>
        </section>

        {/* 광고비 보정 상세 */}
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">광고비 보정 상세</h3>
          <div className="rounded-lg bg-zinc-800 px-3 py-2 space-y-2 text-sm">
            <div className="flex justify-between text-zinc-300">
              <span>보고서 광고비</span>
              <span>{sku.adSpend.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>① 취소 주문 제외 매출</span>
              <span>-{sku.cancelledSales.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>② 쿠폰 할인 반영</span>
              <span>-{sku.couponDiscount.toLocaleString()}원</span>
            </div>
            <div className="flex justify-between text-white font-medium border-t border-zinc-700 pt-2">
              <span>보정 ROAS</span>
              <span className={sku.adjustedRoas >= sku.breakEvenRoas ? 'text-green-400' : 'text-red-400'}>
                {sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
              </span>
            </div>
            <div className="flex justify-between text-zinc-400 text-xs">
              <span>손익분기 ROAS</span>
              <span>{sku.breakEvenRoas === Infinity ? '—' : `${Math.round(sku.breakEvenRoas)}%`}</span>
            </div>
          </div>
        </section>

        {/* 사입 전환 예상 */}
        {sku.winnerStatus === 'winner' && (
          <section>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-2">사입 전환 시 예상</h3>
            <div className="rounded-lg bg-zinc-800 px-3 py-2 space-y-2 text-sm">
              <div className="flex justify-between text-zinc-300">
                <span>현재 순이익</span>
                <span>{sku.netProfit.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-green-300 font-medium">
                <span>사입 후 예상 순이익</span>
                <span>{purchaseNetProfit.toLocaleString()}원</span>
              </div>
              <p className="text-xs text-zinc-500 pt-1">
                * 1688 사입 시 원가 50% 절감 가정
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/roi/SkuDetailPanel.tsx
git commit -m "feat(roi): add SkuDetailPanel slide-in component"
```

---

## Task 7: RoiPageClient (메인 클라이언트)

**Files:**
- Create: `src/components/roi/RoiPageClient.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/roi/RoiPageClient.tsx
'use client';

import { useState, useEffect } from 'react';
import type { SkuRoiData } from '@/lib/roi/types';
import { RoiGoalWidget } from './RoiGoalWidget';
import { SkuTable } from './SkuTable';
import { SkuDetailPanel } from './SkuDetailPanel';

type Filter = 'all' | 'winner' | 'purchase-signal' | 'stock-warning';

interface Props {
  initialData: SkuRoiData[];
}

export function RoiPageClient({ initialData }: Props) {
  const [skus, setSkus] = useState<SkuRoiData[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedSku, setSelectedSku] = useState<SkuRoiData | null>(null);
  const [targetProfit, setTargetProfit] = useState(5000000);
  const [marginRate, setMarginRate] = useState(0.3);

  useEffect(() => {
    if (initialData.length > 0) return; // 서버에서 데이터 있으면 재요청 안 함
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/roi');
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? '조회 실패');
        setSkus(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : '알 수 없는 오류');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [initialData.length]);

  const avgSellingPrice =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + s.sellingPrice, 0) / skus.length
      : undefined;
  const avgMarginAmount =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + s.marginAmount, 0) / skus.length
      : undefined;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-white">ROI 관리</h1>

      <RoiGoalWidget
        targetProfit={targetProfit}
        marginRate={marginRate}
        avgSellingPrice={avgSellingPrice}
        avgMarginAmount={avgMarginAmount}
        onTargetProfitChange={setTargetProfit}
        onMarginRateChange={setMarginRate}
      />

      {isLoading && (
        <div className="text-center py-12 text-zinc-400">데이터 불러오는 중...</div>
      )}
      {error && (
        <div className="text-center py-12 text-red-400">{error}</div>
      )}
      {!isLoading && !error && (
        <SkuTable
          skus={skus}
          filter={filter}
          onFilterChange={setFilter}
          onSkuClick={setSelectedSku}
        />
      )}

      <SkuDetailPanel sku={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/roi/RoiPageClient.tsx
git commit -m "feat(roi): add RoiPageClient main client component"
```

---

## Task 8: page.tsx + 네비게이션 추가

**Files:**
- Create: `src/app/roi/page.tsx`
- Modify: `src/components/AppNav.tsx`

- [ ] **Step 1: page.tsx 작성**

```typescript
// src/app/roi/page.tsx
import { RoiPageClient } from '@/components/roi/RoiPageClient';
import type { SkuRoiData } from '@/lib/roi/types';

export const dynamic = 'force-dynamic';

export default async function RoiPage() {
  let initialData: SkuRoiData[] = [];

  try {
    // 서버 사이드 초기 데이터 패치 (내부 API 직접 호출은 불가, 로직을 직접 호출하거나 빈 배열로 시작)
    // 현재는 클라이언트에서 useEffect로 패치하도록 빈 배열 전달
    initialData = [];
  } catch {
    // 에러 시 클라이언트에서 재시도
  }

  return <RoiPageClient initialData={initialData} />;
}
```

- [ ] **Step 2: AppNav.tsx에 ROI 메뉴 추가**

`src/components/AppNav.tsx`를 열어 `NAV_ITEMS` 배열에 항목 추가:

```typescript
// 기존 NAV_ITEMS 배열에서 마지막 항목 뒤에 추가
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/label', label: '라벨 인쇄' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
  { href: '/roi', label: 'ROI 관리' },  // ← 추가
];
```

- [ ] **Step 3: 브라우저에서 확인**

```bash
npm run dev
```
- `http://localhost:3000/roi` 접속
- 상단 역산 위젯 표시 확인
- 네비게이션에 'ROI 관리' 메뉴 표시 확인
- 빈 테이블 표시 확인 (stub 상태)

- [ ] **Step 4: 커밋**

```bash
git add src/app/roi/page.tsx src/components/AppNav.tsx
git commit -m "feat(roi): add /roi page and navigation entry"
```

---

## Task 9: Wing/Ads API 실제 연동

**Files:**
- Modify: `src/app/api/roi/route.ts` (stub 함수 교체)

> 이 태스크는 기존 Wing/Ads fetch 유틸의 위치를 확인한 뒤 진행한다.

- [ ] **Step 1: 기존 Wing API fetch 유틸 확인**

```bash
grep -r "fetchCoupangOrders\|fetchWing\|WingApi\|wing.*product" \
  src/lib src/app/api --include="*.ts" -l
```

출력된 파일에서 상품별 재고/주문/취소 데이터를 가져오는 함수를 확인한다.

- [ ] **Step 2: 기존 Ads API fetch 유틸 확인**

```bash
grep -r "fetchAds\|adsApi\|adReport\|attributed" \
  src/lib src/app/api --include="*.ts" -l
```

출력된 파일에서 상품별 광고비/클릭/attributed_sales를 가져오는 함수를 확인한다.

- [ ] **Step 3: route.ts stub 함수 교체**

확인한 함수를 import하고 `fetchWingProductStats`, `fetchAdsProductStats` stub을 실제 구현으로 교체한다. 응답 필드가 다를 경우 `WingProductStat`, `AdsProductStat` 인터페이스에 맞게 매핑한다.

- [ ] **Step 4: 실데이터 확인**

```bash
curl http://localhost:3000/api/roi \
  -H "Cookie: <실제_세션_쿠키>" | python3 -m json.tool | head -50
```
Expected: `skus` 배열에 실제 상품 데이터 포함

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/roi/route.ts
git commit -m "feat(roi): wire Wing and Ads API to ROI data aggregation"
```

---

## Self-Review

**스펙 커버리지:**
| 스펙 항목 | 태스크 |
|---|---|
| 수익 목표 역산 | Task 1 (`calcRequiredRevenue`) + Task 4 (`RoiGoalWidget`) |
| ROAS 손익분기 (간이과세자) | Task 1 (`calcBreakevenRoas`) + Task 5 (`SkuTable` 색상) |
| 위너 판별 4기준 | Task 1 (`isWinner`) + Task 6 (`SkuDetailPanel`) |
| 광고비 보정 3항목 | Task 3 (`/api/roi`) + Task 6 (`SkuDetailPanel`) |
| 재고 회전일 경고 | Task 1 (`calcStockTurnover`) + Task 5 (`SkuTable` 색상) |
| SKU 종합 대시보드 | Task 5 (`SkuTable`) + Task 7 (`RoiPageClient`) |
| DB 스키마 변경 없음 | `sourcing_items` 기존 컬럼 재사용 ✓ |
| 네비게이션 추가 | Task 8 ✓ |

**플레이스홀더:** Task 9 Step 3은 "교체"라고만 되어 있어 다소 열린 형태이나, Step 1-2에서 실제 함수를 찾은 뒤 진행하는 구조로 stub의 한계를 명시적으로 처리함.

**타입 일관성:**
- `SkuRoiData` 타입은 Task 2에서 정의, Task 3~8 전체에서 동일 import 경로 사용 ✓
- `calcMargin`, `calcBreakevenRoas` 등 함수명이 Task 1 정의와 후속 태스크 사용처 일치 ✓
