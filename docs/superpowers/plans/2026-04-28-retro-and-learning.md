# 회고/학습 (회송 추적 + CS 패턴 + 채널 분배) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회송 사례를 SKU/셀러/원인별로 누적하여 다음 발주 시 자동 경고. CS 문의 TOP 5 자동 추출. 채널별 매출 분배(50/25/25) 일별 추적 + 편차 시 광고 재분배 제안.

**Architecture:** 신규 테이블 3개 + 회송 등록 폼 + CS 패턴 cron + 채널 분배 모니터링 페이지. 모두 Plan 1 alerts 테이블 활용.

**Tech Stack:** TypeScript, Next.js, Supabase, Vitest
**전략 v2 의존도:** medium (Week 8 시작 전 권장)
**근거 spec:** `docs/superpowers/specs/2026-04-28-strategy-v2-extension-design.md` §2.D

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `supabase/migrations/046_retro_learning.sql` | inbound_returns + cs_inquiries + channel_distribution |
| 신규 | `src/lib/retro/inbound-return-warning.ts` | 같은 셀러 재발주 시 경고 로직 |
| 신규 | `src/lib/retro/cs-pattern-extractor.ts` | TOP 5 질문 추출 |
| 신규 | `src/app/api/retro/inbound-returns/route.ts` | POST 회송 등록 |
| 신규 | `src/app/api/retro/cs-patterns/route.ts` | GET CS 패턴 |
| 신규 | `src/app/api/retro/channel-distribution/route.ts` | GET 채널 분배 |
| 신규 | `src/app/plan/retro/page.tsx` | 회고 대시보드 |
| 신규 | `src/components/retro/InboundReturnForm.tsx` | 회송 등록 폼 |
| 신규 | `src/components/retro/ChannelDistChart.tsx` | 채널 분배 차트 |
| 신규 | `src/lib/retro/__tests__/cs-pattern-extractor.test.ts` | 패턴 추출 테스트 |

---

## Task 1: DB 마이그레이션 — 046

```sql
-- supabase/migrations/046_retro_learning.sql

CREATE TABLE IF NOT EXISTS inbound_returns (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  seller_name TEXT,
  reason TEXT NOT NULL CHECK (reason IN
    ('packaging', 'size', 'barcode', 'damage', 'mismatch', 'other')),
  return_cost_krw INT,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returns_sku
  ON inbound_returns (sku_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_seller
  ON inbound_returns (seller_name, occurred_at DESC) WHERE seller_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS cs_inquiries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  sku_code TEXT,
  question_text TEXT NOT NULL,
  category TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_user_recent
  ON cs_inquiries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_distribution (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  recorded_date DATE NOT NULL,
  coupang_grocery_krw INT NOT NULL DEFAULT 0,
  coupang_general_krw INT NOT NULL DEFAULT 0,
  naver_krw INT NOT NULL DEFAULT 0,
  total_krw INT GENERATED ALWAYS AS
    (coupang_grocery_krw + coupang_general_krw + naver_krw) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_channel_dist_recent
  ON channel_distribution (user_id, recorded_date DESC);

COMMENT ON TABLE inbound_returns IS '회송 사례 누적. spec §2.D 기능 8';
COMMENT ON TABLE cs_inquiries IS 'CS 문의 누적. spec §2.D 기능 9';
COMMENT ON TABLE channel_distribution IS '채널별 일일 매출 분배. spec §2.D 기능 10';
```

**커밋:**
```bash
git add supabase/migrations/046_retro_learning.sql
git commit -m "feat(db): add inbound_returns + cs_inquiries + channel_distribution"
```

---

## Task 2: 회송 경고 로직 (TDD)

```ts
// src/lib/retro/__tests__/inbound-return-warning.test.ts
import { describe, it, expect } from 'vitest';
import { shouldWarnReorder } from '../inbound-return-warning';

describe('shouldWarnReorder', () => {
  it('같은 셀러 회송 2건 이상 → warn', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [
        { sellerName: 'X', reason: 'packaging', occurredAt: new Date('2026-04-01') },
        { sellerName: 'X', reason: 'size', occurredAt: new Date('2026-04-15') },
      ],
    })).toMatchObject({ warn: true, count: 2 });
  });

  it('같은 셀러 1건 → no warn', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [{ sellerName: 'X', reason: 'packaging', occurredAt: new Date() }],
    }).warn).toBe(false);
  });

  it('다른 셀러는 무관', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [
        { sellerName: 'Y', reason: 'packaging', occurredAt: new Date() },
        { sellerName: 'Z', reason: 'size', occurredAt: new Date() },
      ],
    }).warn).toBe(false);
  });
});
```

```ts
// src/lib/retro/inbound-return-warning.ts
export interface PastReturn {
  sellerName: string;
  reason: string;
  occurredAt: Date;
}

export function shouldWarnReorder(input: {
  sellerName: string;
  pastReturns: PastReturn[];
}): { warn: boolean; count: number; reasons: string[] } {
  const sameSellerReturns = input.pastReturns.filter(
    (r) => r.sellerName === input.sellerName,
  );
  return {
    warn: sameSellerReturns.length >= 2,
    count: sameSellerReturns.length,
    reasons: sameSellerReturns.map((r) => r.reason),
  };
}
```

**커밋:**
```bash
git add src/lib/retro/inbound-return-warning.ts src/lib/retro/__tests__/inbound-return-warning.test.ts
git commit -m "feat(retro): add reorder warning logic for same seller returns"
```

---

## Task 3: 회송 등록 API + 폼

```ts
// src/app/api/retro/inbound-returns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { shouldWarnReorder } from '@/lib/retro/inbound-return-warning';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { skuCode, sellerName, reason, returnCostKrw, detail } = body ?? {};

  if (!skuCode || !reason) {
    return NextResponse.json(
      { success: false, error: 'skuCode and reason required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  await pool.query(
    `INSERT INTO inbound_returns (sku_code, seller_name, reason, return_cost_krw, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [skuCode, sellerName, reason, returnCostKrw, detail],
  );

  // 같은 셀러 누적 점검
  if (sellerName) {
    const { rows: past } = await pool.query(
      `SELECT seller_name AS "sellerName", reason, occurred_at AS "occurredAt"
       FROM inbound_returns WHERE seller_name = $1`,
      [sellerName],
    );
    const warn = shouldWarnReorder({
      sellerName,
      pastReturns: past.map((p) => ({ ...p, occurredAt: new Date(p.occurredAt) })),
    });
    if (warn.warn) {
      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail)
         VALUES ('inbound_return_warning', 'high', $1, $2, $3)`,
        [skuCode,
         `같은 셀러 ${sellerName} 회송 ${warn.count}회 누적 — 다음 발주 시 변경 권장`,
         JSON.stringify({ sellerName, count: warn.count, reasons: warn.reasons })],
      ).catch(() => {});
    }
  }

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const sku = request.nextUrl.searchParams.get('sku');
  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT id, sku_code, seller_name, reason, return_cost_krw, detail, occurred_at
     FROM inbound_returns
     ${sku ? 'WHERE sku_code = $1' : ''}
     ORDER BY occurred_at DESC LIMIT 100`,
    sku ? [sku] : [],
  );
  return NextResponse.json({ success: true, rows });
}
```

```tsx
// src/components/retro/InboundReturnForm.tsx
'use client';

import { useState } from 'react';

export default function InboundReturnForm() {
  const [skuCode, setSkuCode] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [reason, setReason] = useState('packaging');
  const [returnCost, setReturnCost] = useState('');
  const [detail, setDetail] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/retro/inbound-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode, sellerName, reason,
        returnCostKrw: returnCost ? Number(returnCost) : null,
        detail,
      }),
    });
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      <input className="w-full rounded border p-2 text-sm" placeholder="SKU 코드"
             value={skuCode} onChange={(e) => setSkuCode(e.target.value)} required />
      <input className="w-full rounded border p-2 text-sm" placeholder="셀러명 (1688)"
             value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      <select className="w-full rounded border p-2 text-sm"
              value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="packaging">포장 (회송 1편)</option>
        <option value="size">사이즈 (회송 2편)</option>
        <option value="barcode">바코드 (회송 3편)</option>
        <option value="damage">손상</option>
        <option value="mismatch">사양 불일치</option>
        <option value="other">기타</option>
      </select>
      <input className="w-full rounded border p-2 text-sm" type="number"
             placeholder="회송 비용 (원)" value={returnCost}
             onChange={(e) => setReturnCost(e.target.value)} />
      <textarea className="w-full rounded border p-2 text-sm" rows={3}
                placeholder="상세 내용" value={detail}
                onChange={(e) => setDetail(e.target.value)} />
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
        회송 등록
      </button>
      {done && <span className="ml-2 text-sm text-green-700">✅ 등록됨</span>}
    </form>
  );
}
```

**커밋:**
```bash
git add src/app/api/retro/inbound-returns/ src/components/retro/InboundReturnForm.tsx
git commit -m "feat(retro): add inbound return registration + reorder warning trigger"
```

---

## Task 4: CS 패턴 추출 + 채널 분배 페이지

```ts
// src/lib/retro/cs-pattern-extractor.ts
/**
 * CS 문의 TOP 5 패턴 자동 추출
 * 단순 키워드 카운팅 (1차) — 추후 임베딩 클러스터링 고도화 가능
 */

const KEYWORD_BUCKETS = {
  '배송조회': ['배송', '언제', '도착', '운송장', '발송'],
  '반품/교환': ['반품', '교환', '환불', '취소'],
  '사이즈': ['사이즈', '크기', '치수', '둘레'],
  '색상/디자인': ['색상', '컬러', '디자인', '모양'],
  '상품 문의': ['재질', '소재', '성분', '사양', '스펙'],
};

export interface CsPattern {
  category: string;
  count: number;
  examples: string[];
}

export function extractTopPatterns(
  inquiries: Array<{ questionText: string }>,
  topN = 5,
): CsPattern[] {
  const counts: Record<string, { count: number; examples: string[] }> = {};

  for (const i of inquiries) {
    const text = i.questionText.toLowerCase();
    for (const [cat, keywords] of Object.entries(KEYWORD_BUCKETS)) {
      if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
        counts[cat] = counts[cat] ?? { count: 0, examples: [] };
        counts[cat].count++;
        if (counts[cat].examples.length < 3) {
          counts[cat].examples.push(i.questionText);
        }
        break;
      }
    }
  }

  return Object.entries(counts)
    .map(([category, v]) => ({ category, count: v.count, examples: v.examples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
```

```ts
// src/app/api/retro/cs-patterns/route.ts
import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { extractTopPatterns } from '@/lib/retro/cs-pattern-extractor';

export async function GET() {
  const pool = getSourcingPool();
  const { rows } = await pool.query<{ questionText: string }>(
    `SELECT question_text AS "questionText" FROM cs_inquiries
     WHERE created_at > now() - INTERVAL '28 days'`,
  ).catch(() => ({ rows: [] }));

  const patterns = extractTopPatterns(rows);
  return NextResponse.json({ success: true, total: rows.length, patterns });
}
```

```ts
// src/app/api/retro/channel-distribution/route.ts
import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET() {
  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT recorded_date, coupang_grocery_krw, coupang_general_krw, naver_krw, total_krw
     FROM channel_distribution
     WHERE recorded_date > current_date - INTERVAL '30 days'
     ORDER BY recorded_date ASC`,
  ).catch(() => ({ rows: [] }));

  // 평균 비중 + 목표(50/25/25) 편차
  const totals = rows.reduce(
    (acc, r) => ({
      grocery: acc.grocery + Number(r.coupang_grocery_krw),
      general: acc.general + Number(r.coupang_general_krw),
      naver: acc.naver + Number(r.naver_krw),
    }),
    { grocery: 0, general: 0, naver: 0 },
  );
  const sum = totals.grocery + totals.general + totals.naver || 1;
  const distribution = {
    coupang_grocery_pct: (totals.grocery / sum) * 100,
    coupang_general_pct: (totals.general / sum) * 100,
    naver_pct: (totals.naver / sum) * 100,
    target: { grocery: 50, general: 25, naver: 25 },
  };

  return NextResponse.json({ success: true, rows, distribution });
}
```

```tsx
// src/app/plan/retro/page.tsx
import InboundReturnForm from '@/components/retro/InboundReturnForm';

export const metadata = { title: '회고 + 학습' };

export default function RetroPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="mb-2 text-2xl font-bold">회고 + 학습 대시보드</h1>
      <p className="mb-6 text-sm text-gray-600">
        회송 사례 / CS 패턴 / 채널 분배 누적 분석. (전략 v2 extension §2.D)
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">회송 사례 등록</h2>
        <InboundReturnForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">CS 패턴 TOP 5</h2>
        <CsPatternsView />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">채널별 분배 (지난 30일)</h2>
        <ChannelDistView />
      </section>
    </main>
  );
}

async function CsPatternsView() {
  // 실제로는 useEffect 클라이언트 컴포넌트 변환 권장. 여기선 간이 SSR 형태 placeholder.
  return <div className="text-sm text-gray-600">/api/retro/cs-patterns 데이터 표시 예정 (클라 컴포넌트로 분리)</div>;
}

async function ChannelDistView() {
  return <div className="text-sm text-gray-600">/api/retro/channel-distribution 데이터 표시 예정 (클라 컴포넌트로 분리)</div>;
}
```

**커밋:**
```bash
git add src/lib/retro/cs-pattern-extractor.ts src/app/api/retro/cs-patterns/ src/app/api/retro/channel-distribution/ src/app/plan/retro/
git commit -m "feat(retro): add CS pattern extractor + channel distribution + retro page"
```

---

## Self-Review

- §2.D 기능 8 (회송 추적) → Task 2·3 (경고 로직 + 등록 API/폼)
- §2.D 기능 9 (CS 패턴) → Task 4 cs-pattern-extractor + API
- §2.D 기능 10 (채널 분배) → Task 4 API
- §6.1 `/plan/retro` → Task 4 페이지

**Note**: CSPatternsView / ChannelDistView는 1차 placeholder. 운영 후 클라이언트 컴포넌트로 분리 보강.
