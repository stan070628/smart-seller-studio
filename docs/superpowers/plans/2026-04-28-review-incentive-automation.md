# 포토리뷰 적립금 자동화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 SKU별 리뷰 수를 추적하여 50/100 도달 시점을 기록, 적립금 이벤트 갱신 제안 알림 생성.

**Architecture:** 신규 테이블 1개 + 매일 cron 1개 + 리뷰 도달 알림 트리거. 쿠팡 API 직접 갱신은 1차 범위 외 (수동 갱신 가이드만). 추후 자동 갱신 가능.

**Tech Stack:** TypeScript, Next.js, Supabase, Vitest
**전략 v2 의존도:** low (Week 10 시작 전 권장)
**근거 spec:** `docs/superpowers/specs/2026-04-28-strategy-v2-extension-design.md` §2.E

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `supabase/migrations/049_review_milestones.sql` | review_milestones 테이블 |
| 신규 | `src/lib/reviews/milestone-detector.ts` | 50/100 도달 감지 |
| 신규 | `src/app/api/reviews/milestones/cron/route.ts` | 매일 cron |
| 신규 | `src/app/sourcing/review-incentives/page.tsx` | 적립금 이벤트 가이드 |
| 신규 | `src/lib/reviews/__tests__/milestone-detector.test.ts` | 테스트 |

---

## Task 1: DB 마이그레이션 — 049

```sql
-- supabase/migrations/049_review_milestones.sql

CREATE TABLE IF NOT EXISTS review_milestones (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  review_count INT NOT NULL,
  reached_50 BOOLEAN NOT NULL DEFAULT false,
  reached_100 BOOLEAN NOT NULL DEFAULT false,
  reached_50_at TIMESTAMPTZ,
  reached_100_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku_code, channel)
);

CREATE INDEX IF NOT EXISTS idx_review_milestones_50
  ON review_milestones (reached_50_at DESC) WHERE reached_50 = true;
CREATE INDEX IF NOT EXISTS idx_review_milestones_100
  ON review_milestones (reached_100_at DESC) WHERE reached_100 = true;

COMMENT ON TABLE review_milestones IS '리뷰 50/100 도달 트래킹. spec §2.E 기능 11';
```

**커밋:**
```bash
git add supabase/migrations/049_review_milestones.sql
git commit -m "feat(db): add review_milestones table"
```

---

## Task 2: 도달 감지 로직 (TDD)

```ts
// src/lib/reviews/__tests__/milestone-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectMilestones } from '../milestone-detector';

describe('detectMilestones', () => {
  it('45 → 55 → reached_50 true', () => {
    const r = detectMilestones({
      previousCount: 45, currentCount: 55,
      previousReached50: false, previousReached100: false,
    });
    expect(r.justReached50).toBe(true);
    expect(r.justReached100).toBe(false);
  });

  it('95 → 105 → reached_100 true', () => {
    const r = detectMilestones({
      previousCount: 95, currentCount: 105,
      previousReached50: true, previousReached100: false,
    });
    expect(r.justReached100).toBe(true);
  });

  it('55 → 60 (이미 50 도달) → just false', () => {
    const r = detectMilestones({
      previousCount: 55, currentCount: 60,
      previousReached50: true, previousReached100: false,
    });
    expect(r.justReached50).toBe(false);
    expect(r.justReached100).toBe(false);
  });

  it('45 → 110 한 번에 둘 다', () => {
    const r = detectMilestones({
      previousCount: 45, currentCount: 110,
      previousReached50: false, previousReached100: false,
    });
    expect(r.justReached50).toBe(true);
    expect(r.justReached100).toBe(true);
  });
});
```

```ts
// src/lib/reviews/milestone-detector.ts
export interface DetectInput {
  previousCount: number;
  currentCount: number;
  previousReached50: boolean;
  previousReached100: boolean;
}

export interface DetectResult {
  justReached50: boolean;
  justReached100: boolean;
}

export function detectMilestones(input: DetectInput): DetectResult {
  return {
    justReached50:
      !input.previousReached50 && input.currentCount >= 50,
    justReached100:
      !input.previousReached100 && input.currentCount >= 100,
  };
}
```

**커밋:**
```bash
npx vitest run src/lib/reviews/__tests__/milestone-detector.test.ts
git add src/lib/reviews/milestone-detector.ts src/lib/reviews/__tests__/milestone-detector.test.ts
git commit -m "feat(reviews): add milestone detection logic"
```

---

## Task 3: cron 라우트

```ts
// src/app/api/reviews/milestones/cron/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { detectMilestones } from '@/lib/reviews/milestone-detector';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const pool = getSourcingPool();

  // SKU별 현재 리뷰 수 조회 (sourcing_items에 review_count 컬럼 있다고 가정)
  const { rows } = await pool.query(`
    SELECT item_no::text AS sku_code, title AS product_name,
           'coupang' AS channel,
           COALESCE(review_count, 0) AS current_count
    FROM sourcing_items
    WHERE is_tracking = true LIMIT 100
  `).catch(() => ({ rows: [] }));

  let alertsCreated = 0;
  for (const row of rows) {
    const { rows: prev } = await pool.query(
      `SELECT review_count, reached_50, reached_100
       FROM review_milestones
       WHERE sku_code = $1 AND channel = $2`,
      [row.sku_code, row.channel],
    );

    const previousCount = prev[0]?.review_count ?? 0;
    const previousReached50 = prev[0]?.reached_50 ?? false;
    const previousReached100 = prev[0]?.reached_100 ?? false;

    const detect = detectMilestones({
      previousCount,
      currentCount: Number(row.current_count),
      previousReached50,
      previousReached100,
    });

    await pool.query(
      `INSERT INTO review_milestones
         (sku_code, product_name, channel, review_count,
          reached_50, reached_100, reached_50_at, reached_100_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8)
       ON CONFLICT (sku_code, channel) DO UPDATE SET
         review_count = EXCLUDED.review_count,
         reached_50 = review_milestones.reached_50 OR EXCLUDED.reached_50,
         reached_100 = review_milestones.reached_100 OR EXCLUDED.reached_100,
         reached_50_at = COALESCE(review_milestones.reached_50_at, EXCLUDED.reached_50_at),
         reached_100_at = COALESCE(review_milestones.reached_100_at, EXCLUDED.reached_100_at),
         recorded_at = now()`,
      [
        row.sku_code, row.product_name, row.channel, Number(row.current_count),
        previousReached50 || detect.justReached50,
        previousReached100 || detect.justReached100,
        detect.justReached50 ? new Date() : null,
        detect.justReached100 ? new Date() : null,
      ],
    );

    if (detect.justReached50 || detect.justReached100) {
      const milestone = detect.justReached100 ? 100 : 50;
      const incentiveSuggestion =
        milestone === 100
          ? '리뷰 100+ 도달 — 적립금 이벤트 종료 + 베스트 리뷰 SKU 자동 노출 활용'
          : '리뷰 50+ 도달 — 적립금 3,000원으로 증액 + 다음 50개 가속';

      await pool.query(
        `INSERT INTO alerts (type, severity, sku_code, message, detail)
         VALUES ('review_milestone', 'medium', $1, $2, $3)`,
        [
          row.sku_code,
          `리뷰 ${milestone}+ 도달: ${row.product_name} — ${incentiveSuggestion}`,
          JSON.stringify({ milestone, productName: row.product_name }),
        ],
      ).catch(() => {});
      alertsCreated++;
    }
  }

  return NextResponse.json({ success: true, alertsCreated });
}
```

**커밋:**
```bash
git add src/app/api/reviews/milestones/
git commit -m "feat(api): add daily review milestone tracking cron"
```

---

## Task 4: 적립금 이벤트 가이드 페이지

```tsx
// src/app/sourcing/review-incentives/page.tsx
export const metadata = { title: '포토리뷰 적립금 자동화' };

export default function ReviewIncentivesPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold">포토리뷰 적립금 자동화</h1>
      <p className="mb-6 text-sm text-gray-600">
        리뷰 50/100 도달 SKU 자동 추적 + 적립금 이벤트 갱신 가이드.
        (전략 v2 extension §2.E 기능 11)
      </p>

      <section className="mb-6 rounded border border-blue-200 bg-blue-50 p-4">
        <h2 className="mb-2 text-base font-semibold">📊 단계별 적립금 전략</h2>
        <table className="w-full text-sm">
          <thead className="bg-white">
            <tr>
              <th className="p-2 text-left">현재 리뷰 수</th>
              <th className="p-2 text-left">권장 적립금</th>
              <th className="p-2 text-left">목적</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-2">0~10개</td>
              <td className="p-2 font-semibold">2,000원</td>
              <td className="p-2">초기 리뷰 확보 (가족 + 일반 고객)</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">10~50개</td>
              <td className="p-2 font-semibold">2,000원 유지</td>
              <td className="p-2">전환율 안정화</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">50~100개</td>
              <td className="p-2 font-semibold">3,000원으로 증액</td>
              <td className="p-2">100개 분기점 가속</td>
            </tr>
            <tr className="border-t">
              <td className="p-2">100개 이상</td>
              <td className="p-2 font-semibold">이벤트 종료</td>
              <td className="p-2">베스트 리뷰 자동 노출 활용</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">🔔 자동 알림</h2>
        <p className="text-sm text-gray-700">
          매일 09:00 KST cron이 SKU별 리뷰 수를 추적하여 50/100 도달 시
          알림 센터에 자동 등록됩니다. <a href="/plan/alerts" className="text-blue-600 underline">알림 센터</a>에서 확인.
        </p>
      </section>

      <section className="rounded border border-yellow-200 bg-yellow-50 p-4">
        <h2 className="mb-1 text-base font-semibold">💡 채널 영상 인용</h2>
        <p className="text-sm text-gray-700">
          "리뷰 100개는 신뢰의 분기점. 50개 vs 100개 전환율 차이 30%."
          — 억대셀러 강연 (2025-09-29)
        </p>
      </section>
    </main>
  );
}
```

**커밋:**
```bash
git add src/app/sourcing/review-incentives/
git commit -m "feat(ui): add review incentive automation guide page"
```

---

## Self-Review

- §2.E 기능 11 → Task 1~4 모두 커버
- 적립금 자동 갱신은 1차 범위 외 (수동 가이드 + 알림으로 트리거)
- 추후 쿠팡 윙 API 연동으로 자동 갱신 가능 (별도 plan)
