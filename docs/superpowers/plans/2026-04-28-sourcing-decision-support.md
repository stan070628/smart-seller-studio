# 사입 의사결정 지원 (자동 추천 + 1688 협상 가이드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매주 cron으로 위탁 SKU 전체에 대해 위탁 vs 1688 사입 마진을 자동 비교하고 사입 전환 후보를 추천. 또한 1688 발주 시 가격 협상 전략 체크리스트를 정적 페이지로 제공.

**Architecture:** 기존 margin-1688 모듈을 cron 배치에서 일괄 호출 + 결과를 sourcing_recommendations에 저장. 협상 가이드는 정적 데이터 + UI.

**Tech Stack:** TypeScript, Next.js, Supabase, 기존 margin-1688 모듈
**전략 v2 의존도:** medium (Week 8 시작 전 권장)
**근거 spec:** `docs/superpowers/specs/2026-04-28-strategy-v2-extension-design.md` §2.C

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `supabase/migrations/045_sourcing_decision.sql` | sourcing_recommendations + negotiation_logs |
| 신규 | `src/lib/sourcing/recommend-batch.ts` | 매주 일괄 추천 알고리즘 |
| 신규 | `src/app/api/sourcing/recommendations/cron/route.ts` | 매주 cron |
| 신규 | `src/app/api/sourcing/recommendations/route.ts` | GET 추천 목록 |
| 신규 | `src/app/sourcing/sourcing-recommendations/page.tsx` | 추천 결과 페이지 |
| 신규 | `src/lib/sourcing/negotiation-guide.ts` | 협상 가이드 정적 데이터 |
| 신규 | `src/app/sourcing/negotiation-guide/page.tsx` | 가이드 페이지 |
| 신규 | `src/lib/sourcing/__tests__/recommend-batch.test.ts` | 배치 알고리즘 테스트 |

---

## Task 1: DB 마이그레이션 — 045

```sql
-- supabase/migrations/045_sourcing_decision.sql

CREATE TABLE IF NOT EXISTS sourcing_recommendations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN
    ('buy_strong', 'buy', 'hold', 'wholesale_only', 'insufficient_data')),
  wholesale_margin_per_unit_krw INT,
  buy_margin_per_unit_krw INT,
  monthly_diff_krw INT,
  payback_months REAL,
  reason TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_rec_sku
  ON sourcing_recommendations (sku_code, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_rec_strong
  ON sourcing_recommendations (generated_at DESC) WHERE recommendation = 'buy_strong';

CREATE TABLE IF NOT EXISTS negotiation_logs (
  id BIGSERIAL PRIMARY KEY,
  sku_code TEXT NOT NULL,
  seller_name TEXT,
  initial_price_rmb REAL,
  final_price_rmb REAL,
  discount_pct REAL,
  notes TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sourcing_recommendations IS '위탁 vs 사입 자동 추천 배치 결과. spec §2.C 기능 6';
COMMENT ON TABLE negotiation_logs IS '1688 가격 협상 이력. spec §2.C 기능 7';
```

**커밋:**
```bash
git add supabase/migrations/045_sourcing_decision.sql
git commit -m "feat(db): add sourcing_recommendations + negotiation_logs"
```

---

## Task 2: 배치 알고리즘 (TDD)

**Files:**
- Create: `src/lib/sourcing/recommend-batch.ts`
- Test: `src/lib/sourcing/__tests__/recommend-batch.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/sourcing/__tests__/recommend-batch.test.ts
import { describe, it, expect } from 'vitest';
import { generateRecommendation } from '../recommend-batch';

describe('generateRecommendation', () => {
  it('월 30+ 판매 + 사입 마진 4000 + 위탁 1500 → buy', () => {
    const r = generateRecommendation({
      skuCode: 'A1', productName: 'X',
      wholesaleMarginPerUnitKrw: 1500,
      buyMarginPerUnitKrw: 4000,
      monthlySalesQty: 30,
      buyCapitalNeededKrw: 600000,
    });
    expect(r.recommendation).toBe('buy');
  });

  it('월 0건 → insufficient_data', () => {
    const r = generateRecommendation({
      skuCode: 'A1', productName: 'X',
      wholesaleMarginPerUnitKrw: 1000, buyMarginPerUnitKrw: 3000,
      monthlySalesQty: 0, buyCapitalNeededKrw: 500000,
    });
    expect(r.recommendation).toBe('insufficient_data');
  });
});
```

- [ ] **Step 2: 구현**

```ts
// src/lib/sourcing/recommend-batch.ts
import { compareWholesaleVsBuy, type CompareInput, type CompareResult } from './margin-1688';

export interface RecommendInput extends CompareInput {
  skuCode: string;
  productName: string;
}

export interface RecommendResult extends CompareResult {
  skuCode: string;
  productName: string;
}

export function generateRecommendation(input: RecommendInput): RecommendResult {
  const cmp = compareWholesaleVsBuy({
    wholesaleMarginPerUnitKrw: input.wholesaleMarginPerUnitKrw,
    buyMarginPerUnitKrw: input.buyMarginPerUnitKrw,
    monthlySalesQty: input.monthlySalesQty,
    buyCapitalNeededKrw: input.buyCapitalNeededKrw,
  });
  return {
    skuCode: input.skuCode,
    productName: input.productName,
    ...cmp,
  };
}
```

- [ ] **Step 3: 테스트 통과 + 커밋**

```bash
npx vitest run src/lib/sourcing/__tests__/recommend-batch.test.ts
git add src/lib/sourcing/recommend-batch.ts src/lib/sourcing/__tests__/recommend-batch.test.ts
git commit -m "feat(sourcing): add recommendation batch wrapper"
```

---

## Task 3: cron 라우트

```ts
// src/app/api/sourcing/recommendations/cron/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { generateRecommendation } from '@/lib/sourcing/recommend-batch';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const pool = getSourcingPool();

  // 위탁 SKU 중 월 판매 30개 이상만 — 사입 후보 풀
  const { rows } = await pool.query(`
    SELECT item_no::text AS sku_code, title AS product_name,
           COALESCE(margin_wholesale_krw, 0) AS wholesale,
           COALESCE(margin_buy_krw, 0) AS buy,
           COALESCE(monthly_sales_qty, 0) AS qty,
           COALESCE(buy_capital_needed_krw, 500000) AS capital
    FROM sourcing_items
    WHERE is_tracking = true
      AND COALESCE(monthly_sales_qty, 0) >= 30
    LIMIT 100
  `).catch(() => ({ rows: [] }));

  let created = 0, strongCount = 0;
  for (const row of rows) {
    const r = generateRecommendation({
      skuCode: row.sku_code,
      productName: row.product_name,
      wholesaleMarginPerUnitKrw: Number(row.wholesale),
      buyMarginPerUnitKrw: Number(row.buy),
      monthlySalesQty: Number(row.qty),
      buyCapitalNeededKrw: Number(row.capital),
    });

    await pool.query(
      `INSERT INTO sourcing_recommendations
         (sku_code, product_name, recommendation, wholesale_margin_per_unit_krw,
          buy_margin_per_unit_krw, monthly_diff_krw, payback_months, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.skuCode, r.productName, r.recommendation,
       Number(row.wholesale), Number(row.buy),
       r.monthlyDiffKrw, r.paybackMonths, r.reason],
    );
    created++;
    if (r.recommendation === 'buy_strong') strongCount++;
  }

  // buy_strong 알림 생성
  if (strongCount > 0) {
    await pool.query(
      `INSERT INTO alerts (type, severity, message, detail)
       VALUES ('sourcing_recommendation', 'high', $1, $2)`,
      [`사입 강력 권장 SKU ${strongCount}건 발견`,
       JSON.stringify({ strongCount, total: rows.length })],
    ).catch(() => {});
  }

  return NextResponse.json({ success: true, created, strongCount });
}
```

**커밋:**
```bash
git add src/app/api/sourcing/recommendations/
git commit -m "feat(api): add weekly sourcing recommendations cron"
```

---

## Task 4: 협상 가이드 정적 데이터 + 페이지

```ts
// src/lib/sourcing/negotiation-guide.ts
/** 1688 가격 협상 가이드 — 채널 영상 "1688 네고 흥정 팁 (2025-06-22)" 기반 */

export interface NegotiationStep {
  order: number;
  title: string;
  detail: string;
  tip?: string;
}

export const NEGOTIATION_STEPS: readonly NegotiationStep[] = [
  {
    order: 1,
    title: '셀러 3곳 비교 (가격보다 응대 속도 우선)',
    detail: '같은 디자인을 파는 셀러 최소 3곳을 찾아 가격 + 응대 속도를 비교한다. 가격 차이 5% 미만이면 응대 빠른 셀러 선택.',
    tip: '응대 빠른 셀러 = 회송/클레임 처리도 빠를 가능성 큼.',
  },
  {
    order: 2,
    title: '첫 메시지: 정중하지만 단도직입',
    detail: '인사 + 발주 의향 + 수량 + 가격 문의를 한 번에. 예: "안녕하세요, 텀블러 100개 발주 가능한지요? 단가 견적 부탁드립니다."',
  },
  {
    order: 3,
    title: '소량 테스트 발주는 협상 X (정가 수용)',
    detail: '첫 발주 50~100개는 정가로 진행. 협상 시도 시 거래 거절 리스크.',
  },
  {
    order: 4,
    title: '2차 발주부터 -5% 협상',
    detail: '1차 결과 좋으면 2차에서 "지난번 가격 -5% 가능한지" 직접 요청. 단, 수량을 늘려야 명분 확보 (100→200개).',
    tip: '같은 셀러 재발주는 신뢰 관계 형성 = 협상 강도 높일 수 있음.',
  },
  {
    order: 5,
    title: '3차 스케일 사입에서 -10% 목표',
    detail: '200~300개 발주 시 1·2차 가격 -10%까지 협상 가능. 다만 너무 강하게 누르면 품질 저하 위험.',
  },
  {
    order: 6,
    title: '검수 옵션 + 한국 배송대행',
    detail: '발주 시 "검수(QC) 진행" + "한국 배송대행지로 직접 발송" 명시. 비용은 +3~5% 정도.',
    tip: '검수 옵션은 회송 회피의 핵심. 1편(포장)에서 강조.',
  },
  {
    order: 7,
    title: '회송 발생 시 클레임 즉시',
    detail: '회송 사례를 영상/사진과 함께 셀러에게 송부. 다음 발주분 가격에 반영 또는 셀러 변경.',
    tip: '같은 셀러 2회 연속 회송 = 즉시 변경.',
  },
] as const;
```

```tsx
// src/app/sourcing/negotiation-guide/page.tsx
import { NEGOTIATION_STEPS } from '@/lib/sourcing/negotiation-guide';

export const metadata = { title: '1688 가격 협상 가이드' };

export default function NegotiationGuidePage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">1688 가격 협상 가이드</h1>
      <p className="mb-6 text-sm text-gray-600">
        채널 영상 "1688 네고 흥정 팁 (2025-06-22)" 기반.
        발주 단계별 협상 전략. (전략 v2 extension §2.C 기능 7)
      </p>
      <ol className="space-y-4">
        {NEGOTIATION_STEPS.map((step) => (
          <li key={step.order} className="rounded border border-gray-200 p-4">
            <h3 className="mb-1 text-base font-semibold">
              {step.order}. {step.title}
            </h3>
            <p className="text-sm text-gray-700">{step.detail}</p>
            {step.tip && (
              <div className="mt-2 rounded bg-yellow-50 border border-yellow-200 p-2 text-sm text-yellow-900">
                💡 {step.tip}
              </div>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
```

**커밋:**
```bash
git add src/lib/sourcing/negotiation-guide.ts src/app/sourcing/negotiation-guide/
git commit -m "feat(sourcing): add 1688 negotiation guide static page"
```

---

## Self-Review

- §2.C 기능 6 → Task 1·2·3 (DB + 알고리즘 + cron)
- §2.C 기능 7 → Task 4 (정적 가이드)
- §6.1, §6.2 페이지/API 모두 커버
