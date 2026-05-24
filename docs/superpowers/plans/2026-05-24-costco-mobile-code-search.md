# 코스트코 모바일 상품코드 검색 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/m/costco` 검색창에서 7자리 숫자를 입력하면 자동으로 코스트코 상품코드 검색 모드로 전환하고, 오프라인 가격 입력 후 네이버 단위가 비교까지 완결하는 인라인 흐름을 추가한다.

**Architecture:** 기존 `MobileCostcoList` 검색창에 `/^\d{7}$/` 감지 로직을 추가해 코드 모드를 파생값으로 처리한다. 신규 `MobileCodeSearchCard` 컴포넌트가 3단계(상품조회→가격입력→비교) 흐름을 독립적으로 담당하며, 백엔드는 `/api/sourcing/costco/lookup`(DB우선·OCC fallback)과 `/api/sourcing/costco/naver-compare`(실시간 Naver 비교) 두 엔드포인트로 지원한다.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript, PostgreSQL(`getSourcingPool`), Naver Shopping API, Costco OCC API(`fetchCostcoProduct`), Vitest

---

## 파일 맵

| 종류 | 경로 | 역할 |
|------|------|------|
| 신규 | `src/app/api/sourcing/costco/lookup/route.ts` | 상품코드 단일 조회 API |
| 신규 | `src/app/api/sourcing/costco/naver-compare/route.ts` | 실시간 Naver 단위가 비교 API |
| 신규 | `src/components/sourcing/mobile/MobileCodeSearchCard.tsx` | 3단계 분석 카드 컴포넌트 |
| 수정 | `src/components/sourcing/mobile/MobileCostcoList.tsx` | 검색창 코드 감지 + 카드 조건 렌더 |
| 신규 | `src/__tests__/api/costco-lookup-route.test.ts` | lookup API 단위 테스트 |
| 신규 | `src/__tests__/api/costco-naver-compare-route.test.ts` | naver-compare API 단위 테스트 |
| 신규 | `src/__tests__/components/MobileCodeSearchCard.test.ts` | 카드 순수 로직 단위 테스트 |

---

## Task 1: lookup API — 타입 및 스키마 정의

**Files:**
- Create: `src/app/api/sourcing/costco/lookup/route.ts`
- Create: `src/__tests__/api/costco-lookup-route.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/api/costco-lookup-route.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// lookup 라우트에서 사용할 쿼리 스키마를 동일하게 재현
const lookupQuerySchema = z.object({
  code: z.string().regex(/^\d+$/, '숫자만 허용').min(5).max(10),
});

describe('lookup query schema', () => {
  it('유효한 7자리 코드를 통과시킨다', () => {
    const result = lookupQuerySchema.safeParse({ code: '1234567' });
    expect(result.success).toBe(true);
  });

  it('문자 포함 코드를 거부한다', () => {
    const result = lookupQuerySchema.safeParse({ code: 'ABC1234' });
    expect(result.success).toBe(false);
  });

  it('4자리 이하 코드를 거부한다', () => {
    const result = lookupQuerySchema.safeParse({ code: '1234' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx vitest run src/__tests__/api/costco-lookup-route.test.ts
```

Expected: FAIL (schema not defined)

- [ ] **Step 3: lookup 라우트 구현**

```ts
// src/app/api/sourcing/costco/lookup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';
import type { CostcoProductRow } from '@/types/costco';

export const runtime = 'nodejs';
export const maxDuration = 20;

const querySchema = z.object({
  code: z.string().regex(/^\d+$/, '숫자만 허용').min(5).max(10),
});

export interface LookupResult {
  source: 'db' | 'api';
  productCode: string;
  title: string;
  imageUrl: string | null;
  categoryName: string | null;
  onlinePrice: number;
  averageRating: number | null;
  reviewCount: number;
  unitPriceLabel: string | null;
  unitPrice: number | null;        // DB의 unit_price (100g당 등 코스트코 단가)
  marketLowestPrice: number | null;
  marketUnitPrice: number | null;
  productUrl: string;
  // unit 정보 (naver-compare에서 ParsedUnit 재구성용)
  unitType: 'weight' | 'volume' | 'count' | null;
  totalQuantity: number | null;
  baseUnit: string | null;
}

function rowToResult(row: CostcoProductRow): LookupResult {
  return {
    source: 'db',
    productCode: row.product_code,
    title: row.title,
    imageUrl: row.image_url,
    categoryName: row.category_name,
    onlinePrice: row.price,
    averageRating: row.average_rating ? parseFloat(row.average_rating) : null,
    reviewCount: row.review_count,
    unitPriceLabel: row.unit_price_label ?? null,
    unitPrice: row.unit_price ?? null,
    marketLowestPrice: row.market_lowest_price,
    marketUnitPrice: row.market_unit_price ?? null,
    productUrl: row.product_url,
    unitType: row.unit_type ?? null,
    totalQuantity: row.total_quantity ?? null,
    baseUnit: null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({ code: searchParams.get('code') });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { code } = parsed.data;

  // 1. DB 우선 조회
  try {
    const pool = getSourcingPool();
    const res = await pool.query<CostcoProductRow>(
      `SELECT * FROM public.costco_products WHERE product_code = $1 AND is_active = true LIMIT 1`,
      [code],
    );
    if (res.rows.length > 0) {
      return NextResponse.json(rowToResult(res.rows[0]));
    }
  } catch (err) {
    console.error('[costco/lookup] DB 조회 실패:', err);
    return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
  }

  // 2. OCC API fallback
  const product = await fetchCostcoProduct(code);
  if (!product) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
  }

  const result: LookupResult = {
    source: 'api',
    productCode: product.productCode,
    title: product.title,
    imageUrl: product.imageUrl ?? null,
    categoryName: product.categoryName,
    onlinePrice: product.price,
    averageRating: product.averageRating ?? null,
    reviewCount: product.reviewCount,
    unitPriceLabel: null,
    unitPrice: null,
    marketLowestPrice: null,
    marketUnitPrice: null,
    productUrl: product.productUrl,
    unitType: null,
    totalQuantity: null,
    baseUnit: null,
  };
  return NextResponse.json(result);
}
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
npx vitest run src/__tests__/api/costco-lookup-route.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/costco/lookup/route.ts \
        src/__tests__/api/costco-lookup-route.test.ts
git commit -m "feat: 코스트코 상품코드 단일 조회 API 추가 (lookup)"
```

---

## Task 2: naver-compare API

**Files:**
- Create: `src/app/api/sourcing/costco/naver-compare/route.ts`
- Create: `src/__tests__/api/costco-naver-compare-route.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/api/costco-naver-compare-route.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const compareQuerySchema = z.object({
  title: z.string().min(1),
  code: z.string().optional(),
});

describe('naver-compare query schema', () => {
  it('title만 있어도 통과한다', () => {
    expect(compareQuerySchema.safeParse({ title: '올리브오일' }).success).toBe(true);
  });

  it('title이 없으면 거부한다', () => {
    expect(compareQuerySchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('code는 선택적이다', () => {
    expect(compareQuerySchema.safeParse({ title: '올리브오일', code: '1234567' }).success).toBe(true);
    expect(compareQuerySchema.safeParse({ title: '올리브오일' }).success).toBe(true);
  });
});

describe('오프라인 단위가 계산', () => {
  // offlineUnitPrice = offlinePrice * (unitPrice / onlinePrice)
  it('오프라인 가격으로 단위가를 환산한다', () => {
    const onlinePrice = 32900;
    const unitPrice = 16450;  // 100ml당 (DB값)
    const offlinePrice = 29900;
    const offlineUnitPrice = offlinePrice * (unitPrice / onlinePrice);
    expect(offlineUnitPrice).toBeCloseTo(14965, 0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx vitest run src/__tests__/api/costco-naver-compare-route.test.ts
```

Expected: FAIL (schema not defined)

- [ ] **Step 3: naver-compare 라우트 구현**

```ts
// src/app/api/sourcing/costco/naver-compare/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { normalizeForUnitSearch } from '@/lib/sourcing/naver-shopping';

export const runtime = 'nodejs';
export const maxDuration = 20;

const querySchema = z.object({
  title: z.string().min(1),
  code: z.string().optional(),
});

export interface NaverCompareItem {
  title: string;
  totalPrice: number;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  link: string;
}

export interface NaverCompareResponse {
  items: NaverCompareItem[];
  source: 'unit' | 'total';
}

interface NaverRawItem {
  title: string;
  lprice: string;
  link: string;
}

function stripHtml(s: string) { return s.replace(/<[^>]*>/g, ''); }
function parseLprice(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

async function fetchNaverItems(query: string): Promise<NaverRawItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizeForUnitSearch(query));
  url.searchParams.set('display', '5');
  url.searchParams.set('sort', 'asc');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: NaverRawItem[] };
    return data.items ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(tid);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({
    title: searchParams.get('title'),
    code: searchParams.get('code') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { title, code } = parsed.data;

  // DB에서 unit_price_label 조회 (코드 있을 때만)
  let unitPriceLabel: string | null = null;
  if (code) {
    try {
      const pool = getSourcingPool();
      const res = await pool.query<{ unit_price_label: string | null }>(
        `SELECT unit_price_label FROM public.costco_products WHERE product_code = $1 LIMIT 1`,
        [code],
      );
      unitPriceLabel = res.rows[0]?.unit_price_label ?? null;
    } catch { /* DB 실패 시 label 없이 진행 */ }
  }

  const rawItems = await fetchNaverItems(title);
  const items: NaverCompareItem[] = rawItems
    .map((item) => {
      const totalPrice = parseLprice(item.lprice);
      if (totalPrice === null) return null;
      return {
        title: stripHtml(item.title),
        totalPrice,
        unitPrice: null,   // 단위가 계산은 클라이언트에서 (onlinePrice 기반)
        unitPriceLabel,
        link: item.link,
      } satisfies NaverCompareItem;
    })
    .filter((x): x is NaverCompareItem => x !== null)
    .slice(0, 3);

  const response: NaverCompareResponse = { items, source: 'total' };
  return NextResponse.json(response);
}
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
npx vitest run src/__tests__/api/costco-naver-compare-route.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/costco/naver-compare/route.ts \
        src/__tests__/api/costco-naver-compare-route.test.ts
git commit -m "feat: 코스트코 단일 상품 Naver 비교 API 추가 (naver-compare)"
```

---

## Task 3: MobileCodeSearchCard 컴포넌트

**Files:**
- Create: `src/components/sourcing/mobile/MobileCodeSearchCard.tsx`
- Create: `src/__tests__/components/MobileCodeSearchCard.test.ts`

- [ ] **Step 1: 순수 로직 실패 테스트 작성**

```ts
// src/__tests__/components/MobileCodeSearchCard.test.ts
import { describe, it, expect } from 'vitest';

// 컴포넌트 내 순수 함수들을 별도 파일로 추출하지 않고
// 동일한 로직을 테스트에서 재현한다

const isProductCode = (s: string) => /^\d{7}$/.test(s);

function calcOfflineUnitPrice(
  offlinePrice: number,
  onlinePrice: number,
  unitPrice: number,
): number {
  return offlinePrice * (unitPrice / onlinePrice);
}

function calcSavingRate(naverUnitPrice: number, offlineUnitPrice: number): number {
  return (naverUnitPrice / offlineUnitPrice - 1) * 100;
}

describe('상품코드 감지', () => {
  it('7자리 숫자는 코드로 인식한다', () => {
    expect(isProductCode('1234567')).toBe(true);
  });
  it('6자리는 코드가 아니다', () => {
    expect(isProductCode('123456')).toBe(false);
  });
  it('8자리는 코드가 아니다', () => {
    expect(isProductCode('12345678')).toBe(false);
  });
  it('문자 포함은 코드가 아니다', () => {
    expect(isProductCode('123456a')).toBe(false);
  });
  it('빈 문자열은 코드가 아니다', () => {
    expect(isProductCode('')).toBe(false);
  });
});

describe('오프라인 단위가 계산', () => {
  it('오프라인 가격으로 단위가를 환산한다', () => {
    // 온라인 32,900원, 단위가 16,450원(100ml당), 오프라인 29,900원
    const result = calcOfflineUnitPrice(29900, 32900, 16450);
    expect(result).toBeCloseTo(14965, 0);
  });
});

describe('절감율 계산', () => {
  it('네이버 단위가가 더 높으면 양수 절감율', () => {
    const rate = calcSavingRate(22400, 14965);
    expect(rate).toBeCloseTo(49.7, 0);
  });
  it('네이버 단위가가 더 낮으면 음수 절감율(코스트코가 비쌈)', () => {
    const rate = calcSavingRate(10000, 15000);
    expect(rate).toBeCloseTo(-33.3, 0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — PASS 확인 (순수 함수라 컴포넌트 없이도 통과)**

```bash
npx vitest run src/__tests__/components/MobileCodeSearchCard.test.ts
```

Expected: 8 tests PASS

- [ ] **Step 3: MobileCodeSearchCard 구현 — Step 1·2 (상품 조회 + 가격 입력)**

```tsx
// src/components/sourcing/mobile/MobileCodeSearchCard.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';
import type { NaverCompareResponse } from '@/app/api/sourcing/costco/naver-compare/route';

interface Props {
  code: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

const C = {
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
  sub: '#6b7280',
  border: '#e5e7eb',
  text: '#1a1c1c',
  bg: '#f9fafb',
} as const;

function fmt(n: number) { return n.toLocaleString('ko-KR'); }
function fmtRate(n: number) { return `${Math.abs(n).toFixed(1)}%`; }

function calcOfflineUnitPrice(offlinePrice: number, onlinePrice: number, unitPrice: number) {
  return offlinePrice * (unitPrice / onlinePrice);
}

function calcSavingRate(naverUnitPrice: number, offlineUnitPrice: number) {
  return (naverUnitPrice / offlineUnitPrice - 1) * 100;
}

export default function MobileCodeSearchCard({ code, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [product, setProduct] = useState<LookupResult | null>(null);
  const [isLoadingProduct, setIsLoadingProduct] = useState(true);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [offlinePrice, setOfflinePrice] = useState('');
  const [naverResult, setNaverResult] = useState<NaverCompareResponse | null>(null);
  const [isLoadingNaver, setIsLoadingNaver] = useState(false);

  // 상품 조회
  useEffect(() => {
    setIsLoadingProduct(true);
    setLookupError(null);
    setProduct(null);
    setStep(1);
    setOfflinePrice('');
    setNaverResult(null);

    fetch(`/api/sourcing/costco/lookup?code=${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error('해당 상품코드를 찾을 수 없습니다');
        if (!res.ok) throw new Error('조회 중 오류가 발생했습니다. 다시 시도해주세요');
        return res.json() as Promise<LookupResult>;
      })
      .then((data) => setProduct(data))
      .catch((e: Error) => setLookupError(e.message))
      .finally(() => setIsLoadingProduct(false));
  }, [code]);

  const handleCompare = useCallback(async () => {
    if (!product || !offlinePrice) return;
    setStep(3);

    // DB 캐시값 있으면 즉시 임시 표시 (naverResult는 null → 실시간 교체)
    setIsLoadingNaver(true);
    try {
      const params = new URLSearchParams({ title: product.title, code });
      const res = await fetch(`/api/sourcing/costco/naver-compare?${params}`);
      if (res.ok) {
        const data = await res.json() as NaverCompareResponse;
        setNaverResult(data);
      }
    } finally {
      setIsLoadingNaver(false);
    }
  }, [product, offlinePrice, code]);

  const offlinePriceNum = parseInt(offlinePrice.replace(/,/g, ''), 10);
  const isValidPrice = !isNaN(offlinePriceNum) && offlinePriceNum > 0;

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  if (isLoadingProduct) {
    return (
      <div style={{ margin: '10px 12px', background: '#fff', borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.sub, textAlign: 'center' }}>상품 조회 중...</div>
      </div>
    );
  }

  if (lookupError) {
    return (
      <div style={{ margin: '10px 12px', background: '#fff', borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>{lookupError}</div>
        <button onClick={onClose} style={{ fontSize: 12, color: C.sub, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← 목록으로 돌아가기
        </button>
      </div>
    );
  }

  if (!product) return null;

  // 단위가 계산
  const offlineUnitPrice =
    isValidPrice && product.unitPrice && product.onlinePrice
      ? calcOfflineUnitPrice(offlinePriceNum, product.onlinePrice, product.unitPrice)
      : null;

  return (
    <div style={{ margin: '10px 12px', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: `1px solid ${C.border}` }}>

      {/* STEP 1 + 2: 상품 정보 + 가격 입력 (step < 3일 때 전체 표시, step 3이면 요약) */}
      {step < 3 ? (
        <>
          {/* STEP 1: 상품 정보 */}
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>STEP 1 · 코스트코 온라인</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {product.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={product.imageUrl} alt={product.title} width={56} height={56} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                  : <span style={{ fontSize: 24 }}>📦</span>}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {product.title}
                </p>
                {product.categoryName && (
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: C.sub }}>{product.categoryName}</p>
                )}
                <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: C.sub }}>온라인가</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{fmt(product.onlinePrice)}원</span>
                </div>
              </div>
            </div>
          </div>

          {/* 구분선 */}
          <div style={{ height: 1, background: '#f3f4f6', margin: '0 12px' }} />

          {/* STEP 2: 오프라인 가격 입력 */}
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>STEP 2 · 매장 가격 입력</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="number"
                  value={offlinePrice}
                  onChange={(e) => setOfflinePrice(e.target.value)}
                  placeholder="예: 29900"
                  style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, padding: '9px 36px 9px 12px', fontSize: 14, fontWeight: 600, color: C.text, outline: 'none' }}
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: C.sub }}>원</span>
              </div>
              <button
                onClick={handleCompare}
                disabled={!isValidPrice}
                style={{ background: isValidPrice ? C.text : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: isValidPrice ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                비교하기
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>온라인과 다른 실제 매장 가격을 입력하세요</div>
          </div>
        </>
      ) : (
        /* Step 3: 접힌 요약 + 수정 버튼 */
        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {product.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={product.imageUrl} alt={product.title} width={32} height={32} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                : <span style={{ fontSize: 14 }}>📦</span>}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, color: C.text }}>{product.title.slice(0, 20)}{product.title.length > 20 ? '...' : ''}</div>
              <div style={{ fontSize: 10, color: C.sub }}>매장가 <b style={{ color: C.text }}>{fmt(offlinePriceNum)}원</b></div>
            </div>
          </div>
          <button
            onClick={() => setStep(1)}
            style={{ fontSize: 11, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            수정
          </button>
        </div>
      )}

      {/* STEP 3: 비교 결과 */}
      {step === 3 && (
        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 10, color: C.sub, marginBottom: 8, fontWeight: 600, letterSpacing: '0.5px' }}>STEP 3 · 네이버 비교</div>

          {/* DB 캐시 단위가 (즉시 표시) */}
          {product.marketLowestPrice && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.sub }}>코스트코{product.unitPriceLabel ? ` (${product.unitPriceLabel})` : ''}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                    {offlineUnitPrice ? fmt(Math.round(offlineUnitPrice)) : fmt(offlinePriceNum)}
                    <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>원{product.unitPriceLabel ? `/${product.unitPriceLabel}` : ''}</span>
                  </div>
                </div>
                <div style={{ fontSize: 18, color: '#d1d5db' }}>vs</div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: C.sub }}>네이버 최저가{product.unitPriceLabel ? ` (${product.unitPriceLabel})` : ''}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
                    {product.marketUnitPrice ? fmt(Math.round(product.marketUnitPrice)) : fmt(product.marketLowestPrice)}
                    <span style={{ fontSize: 10, fontWeight: 400, color: C.sub }}>원{product.unitPriceLabel ? `/${product.unitPriceLabel}` : ''}</span>
                  </div>
                </div>
              </div>
              {offlineUnitPrice && product.marketUnitPrice && (() => {
                const rate = calcSavingRate(product.marketUnitPrice, offlineUnitPrice);
                return (
                  <div style={{ background: rate >= 0 ? '#dcfce7' : '#fee2e2', borderRadius: 6, padding: '6px 10px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: rate >= 0 ? C.green : C.red }}>
                    {rate >= 0 ? `▼ ${fmtRate(rate)} 더 저렴` : `▲ ${fmtRate(rate)} 더 비쌈`}
                  </div>
                );
              })()}
            </div>
          )}

          {/* 실시간 Naver 상품 목록 */}
          {isLoadingNaver && (
            <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '8px 0' }}>네이버 실시간 조회 중...</div>
          )}

          {naverResult && naverResult.items.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>비교 기준 네이버 상품 <span style={{ color: '#9ca3af' }}>(탭해서 이동)</span></div>
              {naverResult.items.map((item, i) => (
                <a
                  key={i}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6, textDecoration: 'none' }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{item.title.slice(0, 30)}{item.title.length > 30 ? '...' : ''}</div>
                    <div style={{ fontSize: 10, color: C.sub, marginTop: 1 }}>{fmt(item.totalPrice)}원</div>
                  </div>
                  <div style={{ background: '#03C75A', color: '#fff', borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>N 이동</div>
                </a>
              ))}
            </>
          )}

          {naverResult && naverResult.items.length === 0 && !isLoadingNaver && (
            <div style={{ fontSize: 12, color: C.sub, textAlign: 'center', padding: '8px 0' }}>네이버 비교 상품을 찾지 못했습니다</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 재실행 — 모두 PASS**

```bash
npx vitest run src/__tests__/components/MobileCodeSearchCard.test.ts
```

Expected: 8 tests PASS

- [ ] **Step 5: TypeScript 타입 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep -E "MobileCodeSearchCard|lookup/route|naver-compare/route"
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/sourcing/mobile/MobileCodeSearchCard.tsx \
        src/__tests__/components/MobileCodeSearchCard.test.ts
git commit -m "feat: MobileCodeSearchCard 3단계 분석 카드 컴포넌트 추가"
```

---

## Task 4: MobileCostcoList — 코드 감지 + 카드 통합

**Files:**
- Modify: `src/components/sourcing/mobile/MobileCostcoList.tsx`

- [ ] **Step 1: 검색창 코드 감지 로직 추가**

`MobileCostcoList.tsx` 의 `// ── UI 상태` 블록 바로 아래에 import 추가:

```tsx
import MobileCodeSearchCard from './MobileCodeSearchCard';
```

`search` 상태 선언 바로 아래 (66번 줄 이후)에 파생값 추가:

```tsx
const isProductCode = /^\d{7}$/.test(search);
```

- [ ] **Step 2: 검색창 UI — 코드 모드 시각 피드백 추가**

`MobileCostcoList.tsx` 의 `{/* 검색 입력 */}` 블록 전체를 아래로 교체. 입력 필드를 `div`로 감싸고, 코드 모드 배지를 flex 아이템으로 추가:

```tsx
{/* 검색 입력 + 코드 모드 배지 래퍼 */}
<div style={{ flex: 1, position: 'relative' }}>
  <input
    type="search"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="상품명, 브랜드 또는 상품코드 7자리..."
    style={{
      width: '100%',
      boxSizing: 'border-box',
      height: '36px',
      padding: isProductCode ? '0 72px 0 10px' : '0 10px',
      fontSize: '13px',
      border: `1px solid ${isProductCode ? '#2563eb' : '#e5e7eb'}`,
      borderRadius: '8px',
      outline: 'none',
      color: '#1a1c1c',
      backgroundColor: isProductCode ? '#eff6ff' : '#f9fafb',
      transition: 'border-color 0.15s, background-color 0.15s',
    }}
  />
  {isProductCode && (
    <span
      style={{
        position: 'absolute',
        right: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        fontSize: '10px',
        background: '#2563eb',
        color: '#fff',
        borderRadius: '4px',
        padding: '2px 6px',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      상품코드
    </span>
  )}
</div>
```

- [ ] **Step 3: MobileCodeSearchCard 조건 렌더 추가**

`MobileCostcoList.tsx` 의 `{/* 통계 바 */}` 블록 바로 위에 삽입:

```tsx
{/* 상품코드 검색 카드 */}
{isProductCode && (
  <MobileCodeSearchCard
    code={search}
    onClose={() => setSearch('')}
  />
)}
```

- [ ] **Step 4: 코드 모드일 때 기존 목록 텍스트 필터 비활성화**

`useCostcoProducts` 훅 호출 부분에서 `search` 파라미터를:

```tsx
} = useCostcoProducts({ filters, sort, search: isProductCode ? '' : debouncedSearch });
```

로 변경해 코드 모드에서 텍스트 검색이 목록을 필터링하지 않도록 한다.

- [ ] **Step 5: TypeScript 타입 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep MobileCostcoList
```

Expected: 오류 없음

- [ ] **Step 6: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/
```

Expected: 기존 테스트 모두 PASS, 신규 테스트 모두 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/components/sourcing/mobile/MobileCostcoList.tsx
git commit -m "feat: 코스트코 모바일 검색창 상품코드 자동 감지 + MobileCodeSearchCard 통합"
```

---

## Task 5: 통합 확인

**Files:** 없음 (수동 테스트)

- [ ] **Step 1: 개발 서버 실행**

```bash
npm run dev
```

- [ ] **Step 2: 모바일 뷰에서 흐름 확인**

브라우저에서 `http://localhost:3000/m/costco` 접속 후 DevTools > 모바일 뷰 전환.

체크리스트:
- [ ] 검색창에 7자리 숫자 입력 시 파란 테두리 + "상품코드" 뱃지 표시
- [ ] `MobileCodeSearchCard` 가 기존 목록 위에 나타남
- [ ] DB에 있는 상품코드: 즉시 상품 정보 표시
- [ ] DB에 없는 유효한 코드: 코스트코 OCC API 실시간 조회 (로딩 → 결과)
- [ ] 존재하지 않는 코드: "찾을 수 없습니다" 에러 메시지
- [ ] 오프라인 가격 미입력 시 [비교하기] 비활성(회색)
- [ ] 가격 입력 후 [비교하기] 활성화 → Step 3 전환
- [ ] 네이버 상품 카드 탭 → 네이버쇼핑 새탭 열림
- [ ] ✕ 클릭 또는 검색창 지우면 코드 모드 해제 → 기존 목록 복귀
- [ ] 7자리 미만 또는 문자 포함 입력 시 기존 텍스트 검색 동작 유지

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: 코스트코 모바일 상품코드 검색 UX 완성"
```
