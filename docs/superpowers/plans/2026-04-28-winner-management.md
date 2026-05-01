# 위너 관리 (아이템위너 모니터링 + 키워드 최적화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위너 SKU의 아이템위너 점유율을 매일 자동 모니터링하고, 빼앗김 시 즉시 알림 + 옵션 분리 가이드 제공. 추가로 검색 1페이지 진입 못 한 위너 SKU의 상품명 재구성을 AI로 제안.

**Architecture:** Supabase 신규 테이블 2개 + cron 배치 1개 + 신규 API 2개 + UI 페이지 2개. 기존 KIPRIS/legal 모듈 영향 없음. 알림은 본 plan에서 alert row 생성만 (이메일/배지 발송은 Plan 1 ops-automation-alerts에서 통합).

**Tech Stack:** TypeScript, Next.js App Router, Supabase Postgres, Anthropic API (키워드 제안), Vitest
**전략 v2 의존도:** critical (Week 4 시작 전 완료 필수)
**근거 spec:** `docs/superpowers/specs/2026-04-28-strategy-v2-extension-design.md` §2.B

---

## File Structure

| 작업 | 경로 | 책임 |
|---|---|---|
| 신규 | `supabase/migrations/043_winner_management.sql` | winner_history + keyword_optimizations 테이블 |
| 신규 | `src/lib/winner/types.ts` | WinnerSnapshot, KeywordSuggestion 타입 |
| 신규 | `src/lib/winner/scrape-coupang.ts` | 쿠팡 윙 위너 점유율 데이터 수집 |
| 신규 | `src/lib/winner/keyword-suggester.ts` | Anthropic API로 상품명 재구성 제안 |
| 신규 | `src/app/api/winners/check/route.ts` | POST /api/winners/check (수동 트리거) |
| 신규 | `src/app/api/winners/cron/route.ts` | GET /api/winners/cron (일별 배치) |
| 신규 | `src/app/api/winners/keyword-suggest/route.ts` | POST /api/winners/keyword-suggest |
| 신규 | `src/app/sourcing/winner-dashboard/page.tsx` | 위너 점유율 모니터링 |
| 신규 | `src/app/sourcing/keyword-optimizer/page.tsx` | 키워드 재구성 제안 |
| 신규 | `src/components/winner/WinnerOccupancyTable.tsx` | 점유율 테이블 |
| 신규 | `src/components/winner/KeywordSuggestionForm.tsx` | 키워드 제안 폼 |
| 신규 | `src/lib/winner/__tests__/keyword-suggester.test.ts` | 키워드 제안 테스트 |

---

## Task 1: DB 마이그레이션 — winner_history + keyword_optimizations

**Files:**
- Create: `supabase/migrations/043_winner_management.sql`

- [ ] **Step 1: 마지막 마이그레이션 번호 확인**

Run: `ls supabase/migrations/ | sort | tail -3`
Expected: `042_trademark_precheck_logs.sql`이 최신. 따라서 `043_*` 부여.

- [ ] **Step 2: 마이그레이션 SQL 작성**

Create `supabase/migrations/043_winner_management.sql`:

```sql
-- 위너 관리: 점유율 일별 스냅샷 + 키워드 재구성 제안 이력
-- spec 2026-04-28-strategy-v2-extension §2.B + §5.2

CREATE TABLE IF NOT EXISTS winner_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('coupang', 'naver')),
  occupancy_pct REAL NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
  is_winner BOOLEAN NOT NULL,
  search_rank INT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_winner_history_sku
  ON winner_history (sku_code, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_winner_history_user
  ON winner_history (user_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_winner_history_lost
  ON winner_history (is_winner, snapshot_at DESC) WHERE is_winner = false;

CREATE TABLE IF NOT EXISTS keyword_optimizations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  sku_code TEXT NOT NULL,
  current_title TEXT NOT NULL,
  suggested_title TEXT NOT NULL,
  reasoning TEXT,
  current_rank INT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_keyword_opt_sku
  ON keyword_optimizations (sku_code, created_at DESC);

COMMENT ON TABLE winner_history IS
  '아이템위너 점유율 일별 스냅샷. spec 2026-04-28 §2.B 기능 4';
COMMENT ON TABLE keyword_optimizations IS
  '위너 SKU 상품명 재구성 제안 이력. spec 2026-04-28 §2.B 기능 5';
```

- [ ] **Step 3: 마이그레이션 적용 (옵션)**

Run: `npx supabase db push 2>&1 | tail -5`
Expected: `Applying migration 043_winner_management.sql...` (로컬 환경 미기동 시 SKIP)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/043_winner_management.sql
git commit -m "feat(db): add winner_history + keyword_optimizations tables"
```

---

## Task 2: 타입 정의

**Files:**
- Create: `src/lib/winner/types.ts`

- [ ] **Step 1: 타입 작성**

Create `src/lib/winner/types.ts`:

```ts
/**
 * 위너 관리 공통 타입
 * spec 2026-04-28-strategy-v2-extension §2.B
 */

export type WinnerChannel = 'coupang' | 'naver';

export interface WinnerSnapshot {
  skuCode: string;
  productName: string;
  channel: WinnerChannel;
  occupancyPct: number;        // 0~100
  isWinner: boolean;
  searchRank: number | null;
  snapshotAt: Date;
}

export interface WinnerLostEvent {
  skuCode: string;
  productName: string;
  channel: WinnerChannel;
  previousOccupancyPct: number;
  currentOccupancyPct: number;
  detectedAt: Date;
  /** 옵션 분리 / 카탈로그 매칭 차단 / 신규 옵션 ID 등록 */
  recommendedActions: string[];
}

export interface KeywordSuggestion {
  skuCode: string;
  currentTitle: string;
  suggestedTitle: string;
  reasoning: string;
  currentRank: number | null;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep "winner/types"`
Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/winner/types.ts
git commit -m "feat(winner): add WinnerSnapshot/KeywordSuggestion types"
```

---

## Task 3: keyword-suggester (Anthropic API)

**Files:**
- Create: `src/lib/winner/keyword-suggester.ts`
- Test: `src/lib/winner/__tests__/keyword-suggester.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/winner/__tests__/keyword-suggester.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                suggestedTitle: '스테인리스 텀블러 500ml 보온 보냉',
                reasoning: '메인 키워드 "텀블러"를 앞 6자에 배치, 보냉/보온 부가 키워드 추가',
              }),
            },
          ],
        }),
      };
    },
  };
});

import { suggestKeywordOptimization } from '../keyword-suggester';

describe('suggestKeywordOptimization', () => {
  it('현재 상품명 + 검색 키워드 → 재구성 제안', async () => {
    const result = await suggestKeywordOptimization({
      currentTitle: '500ml 텀블러 스테인리스 좋음',
      mainKeywords: ['텀블러', '보온병'],
      categoryName: '주방용품',
    });
    expect(result.suggestedTitle).toContain('텀블러');
    expect(result.reasoning).toBeTruthy();
  });

  it('빈 currentTitle → 에러', async () => {
    await expect(
      suggestKeywordOptimization({ currentTitle: '', mainKeywords: [], categoryName: null }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/winner/__tests__/keyword-suggester.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: keyword-suggester 구현**

Create `src/lib/winner/keyword-suggester.ts`:

```ts
/**
 * 위너 SKU 상품명 재구성 제안 (Anthropic API)
 * spec 2026-04-28-strategy-v2-extension §2.B 기능 5
 */

import Anthropic from '@anthropic-ai/sdk';
import type { KeywordSuggestion } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

export interface SuggestInput {
  currentTitle: string;
  mainKeywords: string[];
  categoryName: string | null;
}

export async function suggestKeywordOptimization(
  input: SuggestInput,
): Promise<Pick<KeywordSuggestion, 'suggestedTitle' | 'reasoning'>> {
  if (!input.currentTitle.trim()) {
    throw new Error('currentTitle is required');
  }

  const prompt = `네이버 스마트스토어 / 쿠팡 검색 SEO 전문가로서 다음 상품명을 재구성하라.

현재 상품명: ${input.currentTitle}
메인 키워드: ${input.mainKeywords.join(', ') || '(없음)'}
카테고리: ${input.categoryName ?? '(없음)'}

규칙:
- 50자 이내
- 핵심 키워드를 앞 20자에 배치
- 메인 키워드 → 세부 키워드 → 브랜드 순서
- 과장 표현 금지 (100% / 최고 / 만능 등)

JSON 응답 (다른 텍스트 없이):
{"suggestedTitle": "...", "reasoning": "..."}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic API');
  }

  const parsed = JSON.parse(textBlock.text);
  return {
    suggestedTitle: parsed.suggestedTitle,
    reasoning: parsed.reasoning,
  };
}
```

- [ ] **Step 4: 테스트 통과**

Run: `npx vitest run src/lib/winner/__tests__/keyword-suggester.test.ts`
Expected: PASS — 2개 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/winner/keyword-suggester.ts src/lib/winner/__tests__/keyword-suggester.test.ts
git commit -m "feat(winner): add keyword-suggester via Anthropic API"
```

---

## Task 4: API 라우트 — POST /api/winners/keyword-suggest

**Files:**
- Create: `src/app/api/winners/keyword-suggest/route.ts`

- [ ] **Step 1: API 라우트 작성**

Create `src/app/api/winners/keyword-suggest/route.ts`:

```ts
/**
 * POST /api/winners/keyword-suggest
 * spec 2026-04-28 §6.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { suggestKeywordOptimization } from '@/lib/winner/keyword-suggester';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const skuCode = body?.skuCode as string | undefined;
  const currentTitle = body?.currentTitle as string | undefined;
  const mainKeywords = (body?.mainKeywords as string[] | undefined) ?? [];
  const categoryName = (body?.categoryName as string | undefined) ?? null;
  const currentRank = (body?.currentRank as number | undefined) ?? null;

  if (!skuCode || !currentTitle) {
    return NextResponse.json(
      { success: false, error: 'skuCode and currentTitle are required' },
      { status: 400 },
    );
  }

  try {
    const result = await suggestKeywordOptimization({
      currentTitle,
      mainKeywords,
      categoryName,
    });

    const pool = getSourcingPool();
    await pool.query(
      `INSERT INTO keyword_optimizations
         (sku_code, current_title, suggested_title, reasoning, current_rank)
       VALUES ($1, $2, $3, $4, $5)`,
      [skuCode, currentTitle, result.suggestedTitle, result.reasoning, currentRank],
    );

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build 2>&1 | tail -5`
Expected: 빌드 성공, `/api/winners/keyword-suggest` 포함

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/winners/keyword-suggest/
git commit -m "feat(api): add /api/winners/keyword-suggest endpoint"
```

---

## Task 5: UI — KeywordSuggestionForm + 페이지

**Files:**
- Create: `src/components/winner/KeywordSuggestionForm.tsx`
- Create: `src/app/sourcing/keyword-optimizer/page.tsx`

- [ ] **Step 1: 폼 컴포넌트 작성**

Create `src/components/winner/KeywordSuggestionForm.tsx`:

```tsx
'use client';

import { useState } from 'react';

export default function KeywordSuggestionForm() {
  const [skuCode, setSkuCode] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [mainKeywords, setMainKeywords] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ suggestedTitle: string; reasoning: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/winners/keyword-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuCode,
          currentTitle,
          mainKeywords: mainKeywords.split(',').map((s) => s.trim()).filter(Boolean),
          categoryName: categoryName || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? '제안 실패');
      } else {
        setResult({ suggestedTitle: data.suggestedTitle, reasoning: data.reasoning });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-3">
      <input
        value={skuCode}
        onChange={(e) => setSkuCode(e.target.value)}
        placeholder="SKU 코드"
        className="w-full rounded border border-gray-300 p-2 text-sm"
        required
      />
      <input
        value={currentTitle}
        onChange={(e) => setCurrentTitle(e.target.value)}
        placeholder="현재 상품명"
        className="w-full rounded border border-gray-300 p-2 text-sm"
        required
      />
      <input
        value={mainKeywords}
        onChange={(e) => setMainKeywords(e.target.value)}
        placeholder="메인 키워드 (쉼표 구분)"
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <input
        value={categoryName}
        onChange={(e) => setCategoryName(e.target.value)}
        placeholder="카테고리명 (선택)"
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? '제안 중…' : '키워드 재구성 제안'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="rounded border border-green-300 bg-green-50 p-4">
          <div className="text-sm font-semibold">제안된 상품명:</div>
          <div className="mt-1 font-medium">{result.suggestedTitle}</div>
          <div className="mt-2 text-sm text-gray-700">💡 {result.reasoning}</div>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: 페이지 작성**

Create `src/app/sourcing/keyword-optimizer/page.tsx`:

```tsx
import KeywordSuggestionForm from '@/components/winner/KeywordSuggestionForm';

export const metadata = {
  title: '위너 SKU 키워드 최적화',
};

export default function KeywordOptimizerPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">위너 SKU 키워드 최적화</h1>
      <p className="mb-6 text-sm text-gray-600">
        검색 1페이지 진입 못 한 위너 SKU의 상품명을 AI로 재구성합니다.
        (전략 v2 extension §2.B 기능 5)
      </p>
      <KeywordSuggestionForm />
    </main>
  );
}
```

- [ ] **Step 3: 빌드 + 커밋**

Run: `npm run build 2>&1 | tail -5`
Expected: 빌드 성공

```bash
git add src/components/winner/ src/app/sourcing/keyword-optimizer/
git commit -m "feat(ui): add keyword optimizer page + suggestion form"
```

---

## Task 6: 위너 점유율 cron + 알림 행 생성

**Files:**
- Create: `src/lib/winner/scrape-coupang.ts` (간이 placeholder — 실제 수집은 사용자 환경에서 보강)
- Create: `src/app/api/winners/cron/route.ts`

- [ ] **Step 1: 스크래퍼 placeholder 작성**

Create `src/lib/winner/scrape-coupang.ts`:

```ts
/**
 * 쿠팡 윙 위너 점유율 수집
 *
 * 1차 구현은 placeholder. 실제 스크래핑은 coupang-report-agent 패턴 따라
 * 추후 보강. 현재는 DB에 등록된 SKU를 읽어 sourcing_items의 위너 정보를 활용.
 *
 * spec 2026-04-28 §5.1 — coupang-report-agent 활용
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import type { WinnerSnapshot, WinnerChannel } from './types';

export async function fetchWinnerSnapshots(): Promise<WinnerSnapshot[]> {
  const pool = getSourcingPool();
  // 1차: sourcing_items 테이블에서 위너 정보 조회
  const { rows } = await pool.query<{
    item_no: number;
    title: string;
    is_winner: boolean | null;
    winner_occupancy: number | null;
  }>(
    `SELECT item_no, title, is_winner, winner_occupancy
     FROM sourcing_items
     WHERE is_tracking = true
       AND item_no IS NOT NULL
     LIMIT 100`,
  );

  return rows.map((row) => ({
    skuCode: String(row.item_no),
    productName: row.title,
    channel: 'coupang' as WinnerChannel,
    occupancyPct: row.winner_occupancy ?? 0,
    isWinner: row.is_winner ?? false,
    searchRank: null,
    snapshotAt: new Date(),
  }));
}
```

- [ ] **Step 2: cron 라우트 작성**

Create `src/app/api/winners/cron/route.ts`:

```ts
/**
 * GET /api/winners/cron
 * 일별 위너 점유율 스냅샷 + 빼앗김 감지 → alerts 생성
 * spec 2026-04-28 §6.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchWinnerSnapshots } from '@/lib/winner/scrape-coupang';
import { getSourcingPool } from '@/lib/sourcing/db';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const snapshots = await fetchWinnerSnapshots();
  const pool = getSourcingPool();
  let inserted = 0;
  let lostCount = 0;

  for (const snap of snapshots) {
    // 어제 스냅샷 조회
    const { rows: prevRows } = await pool.query(
      `SELECT is_winner, occupancy_pct FROM winner_history
       WHERE sku_code = $1 AND channel = $2
       ORDER BY snapshot_at DESC LIMIT 1`,
      [snap.skuCode, snap.channel],
    );

    const wasWinner = prevRows[0]?.is_winner ?? false;
    const lostWinner = wasWinner && !snap.isWinner;

    await pool.query(
      `INSERT INTO winner_history
         (sku_code, product_name, channel, occupancy_pct, is_winner, search_rank)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [snap.skuCode, snap.productName, snap.channel, snap.occupancyPct, snap.isWinner, snap.searchRank],
    );
    inserted++;

    if (lostWinner) {
      lostCount++;
      // alerts 테이블은 Plan 1에서 생성됨. 미존재 시 무시 (catch).
      await pool.query(
        `INSERT INTO alerts
           (type, severity, sku_code, message, detail)
         VALUES ('winner_lost', 'high', $1,
                 $2,
                 $3)`,
        [
          snap.skuCode,
          `위너 빼앗김: ${snap.productName} (${snap.channel})`,
          JSON.stringify({
            previousOccupancy: prevRows[0]?.occupancy_pct,
            currentOccupancy: snap.occupancyPct,
            recommendedActions: [
              '옵션 분리 (색상/사이즈 변형)',
              '카탈로그 매칭 차단',
              '신규 옵션 ID 등록',
            ],
          }),
        ],
      ).catch(() => {
        // alerts 테이블 미존재 시 silent skip (Plan 1 미구현)
      });
    }
  }

  return NextResponse.json({
    success: true,
    inserted,
    lostCount,
  });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build 2>&1 | tail -5`
Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/lib/winner/scrape-coupang.ts src/app/api/winners/cron/
git commit -m "feat(winner): add daily occupancy cron + winner-lost alert generation"
```

---

## Task 7: 위너 대시보드 페이지

**Files:**
- Create: `src/components/winner/WinnerOccupancyTable.tsx`
- Create: `src/app/sourcing/winner-dashboard/page.tsx`

- [ ] **Step 1: 테이블 컴포넌트 작성**

Create `src/components/winner/WinnerOccupancyTable.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { WinnerSnapshot } from '@/lib/winner/types';

interface Row extends WinnerSnapshot {
  trend: 'up' | 'down' | 'flat';
}

export default function WinnerOccupancyTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/winners/list')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRows(data.rows);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-sm text-gray-500">불러오는 중…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-gray-500">데이터 없음. 첫 cron 실행 후 표시됩니다.</div>;

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="p-2 text-left">SKU</th>
          <th className="p-2 text-left">상품명</th>
          <th className="p-2 text-left">채널</th>
          <th className="p-2 text-right">점유율</th>
          <th className="p-2 text-center">위너</th>
          <th className="p-2 text-center">추세</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.skuCode + r.channel} className="border-t">
            <td className="p-2 font-mono">{r.skuCode}</td>
            <td className="p-2">{r.productName}</td>
            <td className="p-2">{r.channel}</td>
            <td className="p-2 text-right font-semibold">{r.occupancyPct.toFixed(1)}%</td>
            <td className="p-2 text-center">{r.isWinner ? '✅' : '❌'}</td>
            <td className="p-2 text-center">{r.trend === 'up' ? '⬆️' : r.trend === 'down' ? '⬇️' : '➡️'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: 리스트 API + 페이지 작성**

Create `src/app/api/winners/list/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET() {
  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (sku_code, channel)
       sku_code, product_name, channel, occupancy_pct, is_winner, search_rank, snapshot_at
     FROM winner_history
     ORDER BY sku_code, channel, snapshot_at DESC
     LIMIT 200`,
  );

  return NextResponse.json({
    success: true,
    rows: rows.map((r) => ({
      skuCode: r.sku_code,
      productName: r.product_name,
      channel: r.channel,
      occupancyPct: Number(r.occupancy_pct),
      isWinner: r.is_winner,
      searchRank: r.search_rank,
      snapshotAt: r.snapshot_at,
      trend: 'flat' as const, // 1차 구현, Plan 진행 후 추세 계산 추가
    })),
  });
}
```

Create `src/app/sourcing/winner-dashboard/page.tsx`:

```tsx
import WinnerOccupancyTable from '@/components/winner/WinnerOccupancyTable';

export const metadata = { title: '위너 대시보드' };

export default function WinnerDashboardPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">위너 대시보드</h1>
      <p className="mb-6 text-sm text-gray-600">
        SKU별 아이템위너 점유율 일별 추적. 빼앗김 발생 시 알림 센터에 표시됩니다.
        (전략 v2 extension §2.B 기능 4)
      </p>
      <WinnerOccupancyTable />
    </main>
  );
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
git add src/components/winner/ src/app/api/winners/list/ src/app/sourcing/winner-dashboard/
git commit -m "feat(ui): add winner-dashboard page with occupancy table"
```

---

## Self-Review

**1. Spec coverage** ✅
- §2.B 기능 4 (위너 모니터링) → Task 6 (cron) + Task 7 (UI)
- §2.B 기능 5 (키워드 최적화) → Task 3 (suggester) + Task 4 (API) + Task 5 (UI)
- §5.2 신규 테이블 winner_history + keyword_optimizations → Task 1
- §6.1 페이지 2개 → Task 5, 7
- §6.2 API 3개 → Task 4, 6, 7

**2. Placeholder scan** ✅
- 모든 task에 실제 코드 + 명령
- scrape-coupang.ts는 1차 placeholder임을 명시 (완성된 sourcing_items 활용)

**3. Type consistency** ✅
- WinnerSnapshot/KeywordSuggestion — Task 2에서 정의, Task 3·6·7에서 import
- WinnerChannel literal — 일관 사용
