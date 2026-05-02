# 광고 전략 자동 분석 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 버튼 하나로 쿠팡 윙스 + 광고센터 데이터를 수집하고, 돈버는하마 노하우 기반으로 Claude AI가 상품별 광고 우선순위·즉시 실행 항목·소싱 경보를 생성하는 청연코퍼레이션 전용 내부 툴.

**Architecture:** Next.js App Router. `/api/ad-strategy/collect` 가 Playwright(Wing) + 쿠키 fetch(광고센터) 로 데이터 수집, `/api/ad-strategy/analyze` 가 Claude sonnet-4-6 에 하마 노하우 프롬프트로 JSON 리포트 생성. Supabase `ad_strategy_cache` 에 24h TTL 캐시.

**Tech Stack:** Next.js 15 App Router, Playwright (devDeps), Claude claude-sonnet-4-6 (`getAnthropicClient()`), Supabase (`getSupabaseServerClient()`), React (no state library — prop drilling 충분)

---

## 파일 구조

| 역할 | 경로 |
|------|------|
| 타입 | `src/lib/ad-strategy/types.ts` |
| Playwright 스크래퍼 | `src/lib/ad-strategy/scraper.ts` |
| Claude 프롬프트 | `src/lib/ad-strategy/analyzer-prompt.ts` |
| 수집 API | `src/app/api/ad-strategy/collect/route.ts` |
| 분석 API | `src/app/api/ad-strategy/analyze/route.ts` |
| 메인 패널 | `src/components/ad-strategy/AdStrategyPanel.tsx` |
| 즉시 실행 카드 | `src/components/ad-strategy/UrgentActionCard.tsx` |
| 상품 등급 테이블 | `src/components/ad-strategy/ProductAdTable.tsx` |
| 소싱 경보 | `src/components/ad-strategy/SourcingAlertList.tsx` |
| 페이지 | `src/app/ad-strategy/page.tsx` |
| 수정: 내비게이션 | `src/components/dashboard/DashboardClient.tsx` |
| 수정: Supabase 마이그레이션 | `supabase/migrations/20260502_ad_strategy_cache.sql` |

---

### Task 1: 공유 타입 정의

**Files:**
- Create: `src/lib/ad-strategy/types.ts`

- [ ] **Step 1: 타입 파일 작성**

```typescript
// src/lib/ad-strategy/types.ts

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

// 수집 레이어가 반환하는 raw 데이터
export interface RawProduct {
  name: string;
  sellerProductId: string;
  isItemWinner: boolean;
  stock: number;
  salePrice: number;
  monthlySales: number;
  imageViolation: boolean;
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
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "ad-strategy/types" || echo "OK — no type errors"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ad-strategy/types.ts
git commit -m "feat(ad-strategy): 공유 타입 정의"
```

---

### Task 2: Playwright 스크래퍼

**Files:**
- Create: `src/lib/ad-strategy/scraper.ts`

Wing 벤더 인벤토리 페이지와 광고센터 대시보드를 Playwright로 스크래핑한다. Wing은 HMAC 쿠키 없이 브라우저 세션(로컬 프로파일)을 재사용하고, 광고센터는 `COUPANG_ADS_COOKIE` env var 를 Authorization 헤더로 주입한다.

- [ ] **Step 1: 스크래퍼 작성**

```typescript
// src/lib/ad-strategy/scraper.ts
import { chromium } from 'playwright';
import type { CollectedData, RawProduct, RawCampaign } from './types';

const WING_INVENTORY_URL =
  'https://wing.coupang.com/vendor-inventory/list?statusSearch=VALID';
const ADS_DASHBOARD_URL =
  'https://advertising.coupang.com/api/v1/report/campaign-performance';

/**
 * Wing 벤더 인벤토리 + 광고센터 캠페인 데이터를 수집한다.
 * Wing은 이미 로그인된 Chromium 프로파일을 재사용.
 * 광고센터는 COUPANG_ADS_COOKIE env var 사용.
 */
export async function scrapeAdData(): Promise<CollectedData> {
  const [products, campaigns] = await Promise.all([
    scrapeWingProducts(),
    scrapeAdsCampaigns(),
  ]);
  return { products, campaigns, collectedAt: new Date().toISOString() };
}

async function scrapeWingProducts(): Promise<RawProduct[]> {
  // Wing은 로그인 상태 유지가 필요 → userDataDir 재사용
  // 로컬 개발 내부 툴이므로 headless 실행
  const userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR || '/tmp/pw-wing';
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(WING_INVENTORY_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // 로그인 페이지로 리다이렉트되면 에러
    if (page.url().includes('login') || page.url().includes('sign-in')) {
      throw new Error('Wing 세션이 만료되었습니다. PLAYWRIGHT_USER_DATA_DIR를 확인하세요.');
    }

    // 상품 목록 파싱 — Wing 인벤토리 테이블
    const products = await page.evaluate((): RawProduct[] => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const name = cells[1]?.textContent?.trim() ?? '';
        const sellerProductId = cells[0]?.textContent?.trim() ?? '';
        const isItemWinner =
          row.querySelector('.item-winner-badge, [class*="winner"]') !== null ||
          cells.some((c) => c.textContent?.includes('아이템위너'));
        const stockText = cells.find((c) =>
          c.getAttribute('data-label')?.includes('재고'),
        )?.textContent ?? '0';
        const stock = parseInt(stockText.replace(/[^0-9]/g, ''), 10) || 0;
        const priceText = cells.find((c) =>
          c.getAttribute('data-label')?.includes('판매가'),
        )?.textContent ?? '0';
        const salePrice = parseInt(priceText.replace(/[^0-9]/g, ''), 10) || 0;
        const imageViolation =
          row.querySelector('[class*="violation"], [class*="block"]') !== null;
        return {
          name,
          sellerProductId,
          isItemWinner,
          stock,
          salePrice,
          monthlySales: 0, // 주문 API에서 보완
          imageViolation,
        } as RawProduct;
      }).filter((p) => p.name);
    });

    await page.close();
    return products;
  } finally {
    await browser.close();
  }
}

async function scrapeAdsCampaigns(): Promise<RawCampaign[]> {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) return []; // 쿠키 없으면 광고 데이터 없이 진행

  // 광고센터는 React SPA — Playwright로 인증 후 데이터 추출
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext();
    // 저장된 쿠키 주입
    const cookiePairs = cookie.split(';').map((c) => {
      const [name, ...rest] = c.trim().split('=');
      return {
        name: name.trim(),
        value: rest.join('=').trim(),
        domain: '.advertising.coupang.com',
        path: '/',
      };
    });
    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto('https://advertising.coupang.com/marketing/dashboard/sales', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // 세션 만료 확인
    if (page.url().includes('login') || page.url().includes('sign-in')) {
      throw new Error('광고센터 세션이 만료되었습니다. COUPANG_ADS_COOKIE를 갱신해 주세요.');
    }

    // 캠페인 테이블에서 데이터 파싱
    await page.waitForSelector('table, [class*="campaign"]', { timeout: 15_000 }).catch(() => null);

    const campaigns = await page.evaluate((): RawCampaign[] => {
      const rows = Array.from(
        document.querySelectorAll('table tbody tr, [class*="campaign-row"]'),
      );
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td, [class*="cell"]'));
        const name = cells[0]?.textContent?.trim() ?? '';
        const campaignId = row.getAttribute('data-campaign-id') ?? String(Math.random());
        const statusText = cells.find((c) =>
          ['활성', '일시중지', '종료', 'ACTIVE', 'PAUSED'].some((s) =>
            c.textContent?.includes(s),
          ),
        )?.textContent ?? '';
        const status: RawCampaign['status'] = statusText.includes('활성') || statusText.includes('ACTIVE')
          ? 'ACTIVE'
          : statusText.includes('종료') || statusText.includes('ENDED')
          ? 'ENDED'
          : 'PAUSED';

        const budgetText = cells.find((c) => c.getAttribute('data-key') === 'budget' || c.textContent?.match(/\d+,\d+원/))?.textContent ?? '0';
        const dailyBudget = parseInt(budgetText.replace(/[^0-9]/g, ''), 10) || 0;

        const roasText = cells.find((c) => c.textContent?.includes('%') && parseFloat(c.textContent) > 0)?.textContent ?? '0';
        const roas = parseFloat(roasText.replace(/[^0-9.]/g, '')) || 0;

        const ctrText = cells.find((c) => c.textContent?.match(/\d+\.\d+%/))?.textContent ?? '0';
        const ctr = parseFloat(ctrText.replace(/[^0-9.]/g, '')) || 0;

        return { campaignId, name, status, dailyBudget, roas, ctr } as RawCampaign;
      }).filter((c) => c.name);
    });

    await page.close();
    return campaigns;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "scraper" || echo "OK"
```

Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/ad-strategy/scraper.ts
git commit -m "feat(ad-strategy): Playwright Wing + 광고센터 스크래퍼"
```

---

### Task 3: Claude 프롬프트 + 출력 파서

**Files:**
- Create: `src/lib/ad-strategy/analyzer-prompt.ts`

- [ ] **Step 1: 프롬프트 파일 작성**

```typescript
// src/lib/ad-strategy/analyzer-prompt.ts
import type { CollectedData, AdStrategyReport } from './types';

export const AD_STRATEGY_SYSTEM_PROMPT = `당신은 한국 쿠팡 셀러 광고 전략 전문가입니다.
아래 원칙(돈버는하마 노하우)을 반드시 지키세요.

# 광고 집행 7원칙

1. **아이템위너 없는 상품 광고 원칙**: 위너 없으면 기본 HOLD. 단 2주 클릭 100+ / 전환율 1.5% 이상이면 C등급 소액 테스트 허용.
2. **ROAS 기준 예산 조정**: 350% 이상 → 예산 2배 확대 권장. 200% 미만 → 30% 삭감.
3. **코스트코 사입 재고 주의**: 재고 7일치 이하(일평균 판매 × 7)로 내려가면 광고 강도 50% 축소.
4. **예산 최소선**: 아이템위너 보유 상품은 일 5,000원(주 35,000원) 이상 유지.
5. **계절 판단**: 입력 날짜 기준 시즌 자동 판단. 5~8월(여름) = 반팔티셔츠·선풍기·비치백 광고 집중.
6. **위너 분리 우선**: 브랜드 병행수입 상품은 광고 전 카탈로그 분리 시도 먼저 권장.
7. **이미지 위반 최우선**: IMAGE_FIX 항목은 urgentActions 배열 맨 앞에 위치.

# 등급 기준
- A: 아이템위너 있음 + 최근 30일 판매 1건 이상 → 즉시 광고
- B: 아이템위너 있음 + 판매 0건 → 위너 확보 후 광고 (또는 카탈로그 분리)
- C: 위너 없음 + 클릭 100+ + 전환율 1.5%+ → 소액 테스트 (일 3,000원)
- HOLD: 위너 없음 + 조건 미달 → 광고 금지

# 출력 규칙
반드시 아래 JSON 스키마만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 절대 금지.
숫자는 원(KRW) 단위 정수, ROAS는 % 정수.`;

export function buildAdStrategyUserPrompt(data: CollectedData, today: string): string {
  return `오늘 날짜: ${today}

## 상품 목록 (${data.products.length}개)
${JSON.stringify(data.products, null, 2)}

## 캠페인 현황 (${data.campaigns.length}개)
${JSON.stringify(data.campaigns, null, 2)}

위 데이터를 분석하여 아래 JSON을 출력하세요:

{
  "collectedAt": "${data.collectedAt}",
  "urgentActions": [
    {
      "type": "IMAGE_FIX | BUDGET_INCREASE | CAMPAIGN_EXTEND | RESTOCK | CAMPAIGN_CREATE",
      "product": "상품명",
      "reason": "구체적 이유 (예: 4월 16일부터 광고 차단됨)",
      "action": "즉시 실행 지침 (예: 지금 이미지 교체 후 검수 요청)",
      "deepLink": "선택적 딥링크"
    }
  ],
  "productAdRanking": [
    {
      "name": "상품명",
      "grade": "A | B | C | HOLD",
      "isItemWinner": true,
      "monthlySales": 8,
      "stock": 23,
      "currentPrice": 29900,
      "reason": "등급 이유 1문장",
      "suggestedDailyBudget": 5000
    }
  ],
  "sourcingAlerts": [
    {
      "product": "상품명",
      "issue": "LOW_STOCK | NO_WINNER | CAMPAIGN_ENDING | ZERO_SALES_30D",
      "detail": "재고 5개 — 긴급 재입고 필요",
      "action": "행동 지침"
    }
  ],
  "campaignSummary": {
    "totalBudget": 10000,
    "totalRoas": 0,
    "activeCampaigns": 1,
    "blockedProducts": 2
  },
  "summary": "핵심 상황 1문장 요약"
}`;
}

export function parseAdStrategyResponse(raw: string): AdStrategyReport {
  // Claude가 JSON 외 텍스트를 추가했을 경우 중괄호 추출
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 파싱할 수 없습니다.');
  return JSON.parse(match[0]) as AdStrategyReport;
}
```

- [ ] **Step 2: parseAdStrategyResponse 단위 테스트 작성**

```typescript
// src/__tests__/lib/ad-strategy/analyzer-prompt.test.ts
import { parseAdStrategyResponse } from '@/lib/ad-strategy/analyzer-prompt';

const VALID_JSON = JSON.stringify({
  collectedAt: '2026-05-02T00:00:00.000Z',
  urgentActions: [],
  productAdRanking: [],
  sourcingAlerts: [],
  campaignSummary: { totalBudget: 0, totalRoas: 0, activeCampaigns: 0, blockedProducts: 0 },
  summary: '테스트',
});

describe('parseAdStrategyResponse', () => {
  it('순수 JSON을 파싱한다', () => {
    const result = parseAdStrategyResponse(VALID_JSON);
    expect(result.summary).toBe('테스트');
  });

  it('앞뒤에 텍스트가 있어도 JSON을 추출한다', () => {
    const result = parseAdStrategyResponse('Here is the result: ' + VALID_JSON + ' done.');
    expect(result.summary).toBe('테스트');
  });

  it('JSON이 없으면 에러를 던진다', () => {
    expect(() => parseAdStrategyResponse('no json here')).toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/ad-strategy/analyzer-prompt.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '@/lib/ad-strategy/analyzer-prompt'`

- [ ] **Step 4: 구현 후 테스트 통과 확인**

파일은 이미 Step 1에서 작성됨.

```bash
npx vitest run src/__tests__/lib/ad-strategy/analyzer-prompt.test.ts 2>&1 | tail -10
```

Expected: 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/ad-strategy/analyzer-prompt.ts src/__tests__/lib/ad-strategy/analyzer-prompt.test.ts
git commit -m "feat(ad-strategy): Claude 프롬프트 + 파서 (with tests)"
```

---

### Task 4: 데이터 수집 API 라우트

**Files:**
- Create: `src/app/api/ad-strategy/collect/route.ts`

Wing 스크래퍼 + CoupangClient 주문 API를 결합해 30일 판매 수량을 각 상품에 매핑한다.

- [ ] **Step 1: 수집 API 작성**

```typescript
// src/app/api/ad-strategy/collect/route.ts
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { scrapeAdData } from '@/lib/ad-strategy/scraper';
import type { CollectedData } from '@/lib/ad-strategy/types';

const CACHE_HOURS = 24;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const supabase = getSupabaseServerClient();

  // 캐시 확인 (force=false 이고 24h 이내이면 캐시 반환)
  if (!force) {
    const cutoff = new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('ad_strategy_cache')
      .select('collected_data, collected_at')
      .gte('collected_at', cutoff)
      .order('collected_at', { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      return Response.json({
        success: true,
        data: cached.collected_data as CollectedData,
        fromCache: true,
      });
    }
  }

  try {
    // 1. Playwright 스크래핑 (Wing + 광고센터)
    const scraped = await scrapeAdData();

    // 2. CoupangClient 주문 API로 30일 판매 수량 보완
    const client = getCoupangClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    try {
      const ordersRes = await client.getOrders({
        createdAtFrom: thirtyDaysAgo,
        createdAtTo: today,
        maxPerPage: 100,
      });

      // 상품명 기준으로 판매 수량 집계
      const salesMap = new Map<string, number>();
      for (const order of ordersRes.data ?? []) {
        for (const item of order.orderItems ?? []) {
          const name = item.sellerProductName ?? '';
          salesMap.set(name, (salesMap.get(name) ?? 0) + (item.shippingCount ?? 1));
        }
      }

      // scraped.products에 monthlySales 주입
      for (const product of scraped.products) {
        product.monthlySales = salesMap.get(product.name) ?? 0;
      }
    } catch (orderErr) {
      console.warn('[ad-strategy/collect] 주문 API 실패 (무시):', orderErr);
    }

    // 3. Supabase 캐시 저장 (upsert)
    await supabase.from('ad_strategy_cache').upsert({
      user_id: 'cheong-yeon', // 단일 계정 고정
      collected_data: scraped,
      collected_at: scraped.collectedAt,
    });

    return Response.json({ success: true, data: scraped, fromCache: false });
  } catch (err) {
    console.error('[ad-strategy/collect]', err);
    const message = err instanceof Error ? err.message : '수집 실패';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ad-strategy/collect" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ad-strategy/collect/route.ts
git commit -m "feat(ad-strategy): 데이터 수집 API 라우트"
```

---

### Task 5: AI 분석 API 라우트

**Files:**
- Create: `src/app/api/ad-strategy/analyze/route.ts`

- [ ] **Step 1: 분석 API 작성**

```typescript
// src/app/api/ad-strategy/analyze/route.ts
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  AD_STRATEGY_SYSTEM_PROMPT,
  buildAdStrategyUserPrompt,
  parseAdStrategyResponse,
} from '@/lib/ad-strategy/analyzer-prompt';
import type { CollectedData, AdStrategyReport } from '@/lib/ad-strategy/types';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  let body: { data?: CollectedData };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 본문 파싱 실패' }, { status: 400 });
  }

  if (!body.data) {
    return Response.json({ success: false, error: 'data 필드가 필요합니다.' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = buildAdStrategyUserPrompt(body.data, today);

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: AD_STRATEGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const report = parseAdStrategyResponse(rawText);

    // Supabase에 리포트 캐시 저장
    const supabase = getSupabaseServerClient();
    await supabase.from('ad_strategy_cache').upsert({
      user_id: 'cheong-yeon',
      report_json: report,
      collected_at: body.data.collectedAt,
    });

    return Response.json({ success: true, report });
  } catch (err) {
    console.error('[ad-strategy/analyze]', err);
    const message = err instanceof Error ? err.message : 'AI 분석 실패';
    return Response.json(
      { success: false, error: message, rawData: body.data },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ad-strategy/analyze" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ad-strategy/analyze/route.ts
git commit -m "feat(ad-strategy): Claude AI 분석 API 라우트"
```

---

### Task 6: UI 서브컴포넌트 3종

**Files:**
- Create: `src/components/ad-strategy/UrgentActionCard.tsx`
- Create: `src/components/ad-strategy/ProductAdTable.tsx`
- Create: `src/components/ad-strategy/SourcingAlertList.tsx`

- [ ] **Step 1: UrgentActionCard 작성**

```tsx
// src/components/ad-strategy/UrgentActionCard.tsx
'use client';

import React from 'react';
import type { UrgentAction, UrgentActionType } from '@/lib/ad-strategy/types';

const TYPE_LABEL: Record<UrgentActionType, string> = {
  IMAGE_FIX: '이미지 수정',
  BUDGET_INCREASE: '예산 증액',
  CAMPAIGN_EXTEND: '캠페인 연장',
  RESTOCK: '긴급 재입고',
  CAMPAIGN_CREATE: '신규 캠페인',
};

const TYPE_COLOR: Record<UrgentActionType, string> = {
  IMAGE_FIX: '#dc2626',
  BUDGET_INCREASE: '#2563eb',
  CAMPAIGN_EXTEND: '#d97706',
  RESTOCK: '#7c3aed',
  CAMPAIGN_CREATE: '#059669',
};

export default function UrgentActionCard({ action }: { action: UrgentAction }) {
  const color = TYPE_COLOR[action.type] ?? '#6b7280';
  return (
    <div
      style={{
        border: `1px solid ${color}33`,
        borderLeft: `4px solid ${color}`,
        borderRadius: '8px',
        padding: '14px 16px',
        background: '#fff',
        minWidth: '220px',
        flex: '1 1 220px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color,
            background: `${color}18`,
            padding: '2px 8px',
            borderRadius: '4px',
          }}
        >
          {TYPE_LABEL[action.type]}
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111' }}>{action.product}</span>
      </div>
      <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#6b7280' }}>{action.reason}</p>
      <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#374151', fontWeight: 500 }}>
        {action.action}
      </p>
      {action.deepLink && (
        <a
          href={action.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '12px',
            color,
            textDecoration: 'none',
            border: `1px solid ${color}44`,
            borderRadius: '4px',
            padding: '4px 10px',
          }}
        >
          바로가기 →
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: ProductAdTable 작성**

```tsx
// src/components/ad-strategy/ProductAdTable.tsx
'use client';

import React from 'react';
import type { ProductAdGrade, AdGrade } from '@/lib/ad-strategy/types';

const GRADE_COLOR: Record<AdGrade, string> = {
  A: '#059669',
  B: '#2563eb',
  C: '#d97706',
  HOLD: '#6b7280',
};

export default function ProductAdTable({ products }: { products: ProductAdGrade[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            {['등급', '상품명', '위너', '30일 판매', '재고', '권장 일예산', '이유'].map((h) => (
              <th
                key={h}
                style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr
              key={p.name + i}
              style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
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
              <td style={{ padding: '10px 12px', color: '#111', fontWeight: 500, maxWidth: '240px' }}>
                {p.name}
              </td>
              <td style={{ padding: '10px 12px', color: p.isItemWinner ? '#059669' : '#dc2626' }}>
                {p.isItemWinner ? 'O' : 'X'}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.monthlySales}건</td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock}개</td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                {p.suggestedDailyBudget
                  ? p.suggestedDailyBudget.toLocaleString('ko-KR') + '원'
                  : '-'}
              </td>
              <td style={{ padding: '10px 12px', color: '#6b7280', maxWidth: '260px' }}>{p.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: SourcingAlertList 작성**

```tsx
// src/components/ad-strategy/SourcingAlertList.tsx
'use client';

import React from 'react';
import type { SourcingAlert } from '@/lib/ad-strategy/types';

const ISSUE_LABEL: Record<SourcingAlert['issue'], string> = {
  LOW_STOCK: '재고 부족',
  NO_WINNER: '위너 없음',
  CAMPAIGN_ENDING: '캠페인 종료 임박',
  ZERO_SALES_30D: '30일 무판매',
};

export default function SourcingAlertList({ alerts }: { alerts: SourcingAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>소싱 경보 없음</p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {alerts.map((a, i) => (
        <div
          key={a.product + i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '10px 14px',
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#b45309',
              background: '#fef3c7',
              padding: '2px 8px',
              borderRadius: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            {ISSUE_LABEL[a.issue]}
          </span>
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: '13px', color: '#111' }}>
              {a.product}
            </p>
            <p style={{ margin: '0 0 2px', fontSize: '12px', color: '#6b7280' }}>{a.detail}</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#374151' }}>{a.action}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ad-strategy" || echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ad-strategy/UrgentActionCard.tsx src/components/ad-strategy/ProductAdTable.tsx src/components/ad-strategy/SourcingAlertList.tsx
git commit -m "feat(ad-strategy): UI 서브컴포넌트 3종 (카드·테이블·경보)"
```

---

### Task 7: 메인 AdStrategyPanel 컴포넌트

**Files:**
- Create: `src/components/ad-strategy/AdStrategyPanel.tsx`

- [ ] **Step 1: 패널 컴포넌트 작성**

```tsx
// src/components/ad-strategy/AdStrategyPanel.tsx
'use client';

import React, { useState, useCallback } from 'react';
import type { AdStrategyReport, CollectedData } from '@/lib/ad-strategy/types';
import UrgentActionCard from './UrgentActionCard';
import ProductAdTable from './ProductAdTable';
import SourcingAlertList from './SourcingAlertList';

type Status = 'idle' | 'collecting' | 'analyzing' | 'done' | 'error';

const STATUS_MSG: Record<Status, string> = {
  idle: '',
  collecting: '상품 목록 및 광고 현황 수집 중...',
  analyzing: 'AI 전략 분석 중...',
  done: '분석 완료',
  error: '',
};

export default function AdStrategyPanel() {
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<AdStrategyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);

  const handleAnalyze = useCallback(async (force = false) => {
    setStatus('collecting');
    setError(null);

    try {
      // 1. 수집
      const collectRes = await fetch('/api/ad-strategy/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const collectJson = (await collectRes.json()) as
        | { success: true; data: CollectedData; fromCache: boolean }
        | { success: false; error: string };

      if (!collectJson.success) throw new Error(collectJson.error);

      // 2. 분석
      setStatus('analyzing');
      const analyzeRes = await fetch('/api/ad-strategy/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: collectJson.data }),
      });
      const analyzeJson = (await analyzeRes.json()) as
        | { success: true; report: AdStrategyReport }
        | { success: false; error: string };

      if (!analyzeJson.success) throw new Error(analyzeJson.error);

      setReport(analyzeJson.report);
      setLastAnalyzedAt(new Date().toLocaleString('ko-KR'));
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
      setStatus('error');
    }
  }, []);

  const isLoading = status === 'collecting' || status === 'analyzing';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '24px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111' }}>
            광고 전략 분석
          </h1>
          {lastAnalyzedAt && (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
              마지막 분석: {lastAnalyzedAt}
            </p>
          )}
        </div>
        <button
          onClick={() => handleAnalyze(true)}
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            background: isLoading ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? STATUS_MSG[status] : '분석 시작'}
        </button>
      </div>

      {/* 에러 */}
      {status === 'error' && error && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            color: '#b91c1c',
            fontSize: '13px',
          }}
        >
          {error.includes('쿠키') || error.includes('세션') ? (
            <>
              <strong>세션 오류:</strong> {error}
              <br />
              <small>
                Wing: PLAYWRIGHT_USER_DATA_DIR 경로의 세션을 갱신하세요.
                광고센터: .env.local의 COUPANG_ADS_COOKIE를 갱신하세요.
              </small>
            </>
          ) : (
            error
          )}
        </div>
      )}

      {/* 빈 상태 */}
      {status === 'idle' && !report && (
        <div
          style={{
            padding: '48px',
            textAlign: 'center',
            color: '#9ca3af',
            border: '2px dashed #e5e7eb',
            borderRadius: '12px',
          }}
        >
          <p style={{ margin: 0, fontSize: '15px' }}>
            "분석 시작" 버튼을 클릭하면 쿠팡 윙스 + 광고센터 데이터를 수집하고
            <br />
            돈버는하마 노하우 기반 AI 전략을 생성합니다.
          </p>
        </div>
      )}

      {/* 결과 */}
      {report && (
        <>
          {/* 캠페인 요약 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
            }}
          >
            {[
              { label: '주간 광고비', value: report.campaignSummary.totalBudget.toLocaleString('ko-KR') + '원' },
              { label: '전체 ROAS', value: report.campaignSummary.totalRoas + '%' },
              { label: '운영 캠페인', value: report.campaignSummary.activeCampaigns + '개' },
              { label: '이미지 차단', value: report.campaignSummary.blockedProducts + '개', alert: report.campaignSummary.blockedProducts > 0 },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: '16px',
                  background: item.alert ? '#fee2e2' : '#f9fafb',
                  border: `1px solid ${item.alert ? '#fca5a5' : '#e5e7eb'}`,
                  borderRadius: '8px',
                }}
              >
                <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#6b7280' }}>{item.label}</p>
                <p style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: item.alert ? '#b91c1c' : '#111' }}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* AI 한 줄 요약 */}
          <div
            style={{
              padding: '14px 18px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              fontSize: '14px',
              color: '#1d4ed8',
            }}
          >
            {report.summary}
          </div>

          {/* 즉시 실행 */}
          {report.urgentActions.length > 0 && (
            <section>
              <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#dc2626' }}>
                즉시 실행 {report.urgentActions.length}건
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {report.urgentActions.map((a, i) => (
                  <UrgentActionCard key={i} action={a} />
                ))}
              </div>
            </section>
          )}

          {/* 상품별 광고 등급 */}
          <section>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#374151' }}>
              상품별 광고 등급
            </h2>
            <ProductAdTable products={report.productAdRanking} />
          </section>

          {/* 소싱 경보 */}
          <section>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: '#374151' }}>
              소싱 경보
            </h2>
            <SourcingAlertList alerts={report.sourcingAlerts} />
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "AdStrategyPanel" || echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ad-strategy/AdStrategyPanel.tsx
git commit -m "feat(ad-strategy): 메인 AdStrategyPanel 컴포넌트"
```

---

### Task 8: 페이지 + 내비게이션 연결

**Files:**
- Create: `src/app/ad-strategy/page.tsx`
- Modify: `src/components/dashboard/DashboardClient.tsx`

- [ ] **Step 1: 페이지 작성**

```tsx
// src/app/ad-strategy/page.tsx
import AdStrategyPanel from '@/components/ad-strategy/AdStrategyPanel';

export default function AdStrategyPage() {
  return <AdStrategyPanel />;
}
```

- [ ] **Step 2: DashboardClient.tsx NAV_ITEMS에 광고전략 추가**

`src/components/dashboard/DashboardClient.tsx` 의 line 20–27:

```typescript
// 변경 전
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

// 변경 후
const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
  { href: '/ad-strategy', label: '광고전략' },
];
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "ad-strategy" || echo "OK"
```

- [ ] **Step 4: 개발 서버 실행 후 브라우저에서 확인**

```bash
npm run dev &
sleep 5
open http://localhost:3000/ad-strategy
```

확인 항목:
- "광고전략" 내비게이션 탭 표시
- 빈 상태 UI ("분석 시작" 버튼 + 안내 문구)
- "분석 시작" 버튼 클릭 → 로딩 메시지 표시

- [ ] **Step 5: Commit**

```bash
git add src/app/ad-strategy/page.tsx src/components/dashboard/DashboardClient.tsx
git commit -m "feat(ad-strategy): 페이지 + 내비게이션 연결"
```

---

### Task 9: Supabase 마이그레이션

**Files:**
- Create: `supabase/migrations/20260502_ad_strategy_cache.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- supabase/migrations/20260502_ad_strategy_cache.sql

create table if not exists ad_strategy_cache (
  id          bigint generated always as identity primary key,
  user_id     text not null default 'cheong-yeon',
  collected_data jsonb,
  report_json    jsonb,
  collected_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- 가장 최신 캐시를 빠르게 조회하기 위한 인덱스
create index if not exists idx_ad_strategy_cache_collected_at
  on ad_strategy_cache (collected_at desc);

-- 24시간 초과 레코드를 정리하는 주석 (cron job or 수동 실행)
-- delete from ad_strategy_cache where collected_at < now() - interval '24 hours';

comment on table ad_strategy_cache is
  '광고 전략 수집/분석 캐시 (단일 계정, 24h TTL)';
```

- [ ] **Step 2: Supabase 로컬 또는 대시보드에서 마이그레이션 실행**

로컬 Supabase가 실행 중이면:
```bash
npx supabase db push 2>&1 | tail -10
```

로컬 미실행 시 Supabase 대시보드 SQL 에디터에서 위 SQL을 직접 실행.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502_ad_strategy_cache.sql
git commit -m "feat(ad-strategy): Supabase ad_strategy_cache 테이블 마이그레이션"
```

---

### Task 10: 환경변수 + 통합 테스트

- [ ] **Step 1: .env.local에 필요한 환경변수 확인**

`.env.local`에 아래 두 항목이 있는지 확인 (없으면 추가):

```
# Wing 로그인 세션을 저장할 Chromium 프로파일 디렉토리
PLAYWRIGHT_USER_DATA_DIR=/Users/seungminlee/.pw-wing

# advertising.coupang.com 세션 쿠키 (만료 시 브라우저에서 복사)
COUPANG_ADS_COOKIE=your_session_cookie_here
```

- [ ] **Step 2: Wing 프로파일 초기화 (최초 1회)**

Wing에 로그인된 프로파일이 없으면 아래 스크립트로 브라우저를 열어 수동 로그인:

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const ctx = await chromium.launchPersistentContext(
    process.env.PLAYWRIGHT_USER_DATA_DIR || '/Users/seungminlee/.pw-wing',
    { headless: false }
  );
  const page = await ctx.newPage();
  await page.goto('https://wing.coupang.com/vendor-inventory/list?statusSearch=VALID');
  console.log('로그인 후 Enter 키를 누르세요...');
  await new Promise(r => process.stdin.once('data', r));
  await ctx.close();
})();
"
```

- [ ] **Step 3: 전체 플로우 수동 테스트**

1. 개발 서버 실행: `npm run dev`
2. `http://localhost:3000/ad-strategy` 접속
3. "분석 시작" 클릭
4. 수집 → 분석 메시지 순서 확인
5. 리포트 렌더링 확인:
   - 캠페인 요약 4개 수치
   - AI 한 줄 요약
   - 즉시 실행 카드 (있으면)
   - 상품별 등급 테이블
   - 소싱 경보

- [ ] **Step 4: 캐시 동작 확인**

두 번째 "분석 시작" 클릭 → 빠르게 결과 반환 (캐시 재사용)

네트워크 탭에서 `/api/ad-strategy/collect` 응답의 `fromCache: true` 확인.

- [ ] **Step 5: 최종 Commit**

```bash
git add .env.local.example 2>/dev/null || true
git commit -m "feat(ad-strategy): 광고 전략 분석 기능 완성

- Playwright Wing + 광고센터 스크래퍼
- Claude claude-sonnet-4-6 + 돈버는하마 노하우 프롬프트
- 수집/분석 API 라우트
- UI: 즉시 실행 카드 + 상품 등급 테이블 + 소싱 경보
- Supabase 24h 캐시
- 내비게이션 연결"
```

---

## 자체 검토

**스펙 커버리지:**
- ✅ 수집: Wing 스크래퍼 + 광고센터 쿠키 + CoupangClient 주문
- ✅ 분석: Claude + 하마 노하우 7원칙 프롬프트
- ✅ 캐시: Supabase 24h TTL
- ✅ UI: 즉시 실행 / 등급 테이블 / 소싱 경보 / 캠페인 요약
- ✅ 에러: 쿠키 만료 / 세션 만료 안내
- ✅ 내비게이션 통합
- ✅ YAGNI: 다중 셀러·히스토리·자동 캠페인 생성 제외

**플레이스홀더 없음:** 모든 스텝에 실제 코드 포함.

**타입 일관성:** `CollectedData`, `RawProduct`, `RawCampaign`, `AdStrategyReport` 등 모든 타입을 `types.ts`에서 가져와 사용.
